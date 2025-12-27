#include "websocket_client.hpp"
#include <iostream>
#include <sstream>
#include <iomanip>

namespace poly {

WebSocketPriceStream::WebSocketPriceStream() {
    ctx_.set_default_verify_paths();
    ctx_.set_verify_mode(ssl::verify_none);
}

WebSocketPriceStream::~WebSocketPriceStream() {
    stop();
}

void WebSocketPriceStream::set_callback(PriceCallback cb) {
    callback_ = std::move(cb);
}

void WebSocketPriceStream::set_orderbook_callback(OrderbookCallback cb) {
    orderbook_callback_ = std::move(cb);
}

void WebSocketPriceStream::subscribe(const std::string& token_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    // Check if already subscribed
    for (const auto& t : subscribed_tokens_) {
        if (t == token_id) return;
    }
    
    subscribed_tokens_.push_back(token_id);
    
    // Send immediately if connected (for instant market switching)
    if (connected_ && ws_) {
        send_subscribe(token_id);
    }
}

void WebSocketPriceStream::unsubscribe(const std::string& token_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    auto it = std::find(subscribed_tokens_.begin(), subscribed_tokens_.end(), token_id);
    if (it != subscribed_tokens_.end()) {
        subscribed_tokens_.erase(it);
        if (connected_) {
            send_unsubscribe(token_id);
        }
    }
}

void WebSocketPriceStream::clear_subscriptions() {
    std::lock_guard<std::mutex> lock(mutex_);
    // Just clear the list - don't send unsubscribe (thread safety)
    // The reconnect will establish fresh subscriptions
    subscribed_tokens_.clear();
}

void WebSocketPriceStream::start() {
    if (running_.exchange(true)) return;
    worker_thread_ = std::thread(&WebSocketPriceStream::run, this);
}

void WebSocketPriceStream::stop() {
    running_ = false;
    
    if (ws_ && connected_) {
        try {
            beast::get_lowest_layer(*ws_).cancel();
        } catch (...) {}
    }
    
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
    
    connected_ = false;
}

void WebSocketPriceStream::reconnect() {
    std::cout << "[WS] Reconnect requested" << std::endl;
    
    // Set connected to false first to break read_loop
    connected_ = false;
    
    // Close existing connection if any
    if (ws_) {
        try {
            // Close the websocket gracefully first
            beast::error_code ec;
            ws_->close(websocket::close_code::normal, ec);
        } catch (...) {}
        
        try {
            // Then cancel any pending operations
            beast::get_lowest_layer(*ws_).cancel();
        } catch (...) {}
        
        try {
            // Close the underlying socket
            beast::get_lowest_layer(*ws_).close();
        } catch (...) {}
    }
    
    // The run loop will automatically reconnect after read_loop exits
}

void WebSocketPriceStream::run() {
    while (running_) {
        try {
            // Create fresh io_context for each connection attempt
            ioc_.restart();
            
            connect();
            if (connected_) {
                std::cout << "[WS] ✓ Connected to Polymarket real-time stream" << std::endl;
                read_loop();
            }
        } catch (const std::exception& e) {
            std::cerr << "[WS] Error: " << e.what() << std::endl;
            connected_ = false;
        }
        
        if (running_) {
            std::cout << "[WS] Reconnecting in 2s..." << std::endl;
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }
    }
}

void WebSocketPriceStream::connect() {
    const std::string host = "ws-subscriptions-clob.polymarket.com";
    const std::string port = "443";
    const std::string target = "/ws/market";
    
    tcp::resolver resolver(ioc_);
    auto const results = resolver.resolve(host, port);
    
    ws_ = std::make_unique<websocket::stream<beast::ssl_stream<tcp::socket>>>(ioc_, ctx_);
    
    // Set SNI hostname
    if (!SSL_set_tlsext_host_name(ws_->next_layer().native_handle(), host.c_str())) {
        throw beast::system_error(
            beast::error_code(static_cast<int>(::ERR_get_error()), net::error::get_ssl_category()),
            "Failed to set SNI hostname"
        );
    }
    
    // Connect TCP
    auto ep = net::connect(beast::get_lowest_layer(*ws_), results);
    
    // SSL handshake
    ws_->next_layer().handshake(ssl::stream_base::client);
    
    // Set WebSocket options
    ws_->set_option(websocket::stream_base::timeout::suggested(beast::role_type::client));
    ws_->set_option(websocket::stream_base::decorator(
        [](websocket::request_type& req) {
            req.set(http::field::user_agent, "PolyTrader/1.0");
        }
    ));
    
    // WebSocket handshake
    std::string ws_host = host + ":" + std::to_string(ep.port());
    ws_->handshake(ws_host, target);
    
    connected_ = true;
    
    // Subscribe to all pending tokens
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& token : subscribed_tokens_) {
        send_subscribe(token);
    }
}

void WebSocketPriceStream::send_subscribe(const std::string& token_id) {
    if (!connected_ || !ws_) return;
    
    try {
        // Subscribe to MARKET channel only (book channel doesn't work reliably)
        nlohmann::json market_sub = {
            {"type", "subscribe"},
            {"channel", "market"},
            {"assets_ids", {token_id}}
        };
        ws_->write(net::buffer(market_sub.dump()));
        
        std::cout << "[WS] Subscribed to market: " << token_id.substr(0, 20) << "..." << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[WS] Subscribe error: " << e.what() << std::endl;
    }
}

void WebSocketPriceStream::send_unsubscribe(const std::string& token_id) {
    if (!connected_ || !ws_) return;
    
    nlohmann::json unsub_msg = {
        {"type", "unsubscribe"},
        {"channel", "price"},
        {"assets_ids", {token_id}}
    };
    
    try {
        ws_->write(net::buffer(unsub_msg.dump()));
    } catch (...) {}
}

void WebSocketPriceStream::read_loop() {
    beast::flat_buffer buffer;
    int msg_count = 0;
    
    while (running_ && connected_) {
        try {
            buffer.clear();
            ws_->read(buffer);
            
            std::string msg = beast::buffers_to_string(buffer.data());
            msg_count++;
            
            // DEBUG: Show first 20 messages to see what we're getting
            if (msg_count <= 20) {
                std::cout << "[WS MSG #" << msg_count << "] " << msg.substr(0, 300) << "..." << std::endl;
            }
            
            try {
                auto j = nlohmann::json::parse(msg);
                
                // PRIORITY 1: Handle array format (initial snapshot)
                if (j.is_array() && !j.empty()) {
                    for (const auto& item : j) {
                        // Full orderbook snapshot (has bids/asks arrays + asset_id)
                        if (item.contains("asset_id") && (item.contains("bids") || item.contains("asks"))) {
                            OrderbookUpdate book_update;
                            book_update.token_id = item["asset_id"].get<std::string>();
                            
                            // Extract ALL asks
                            if (item.contains("asks") && item["asks"].is_array()) {
                                for (const auto& ask : item["asks"]) {
                                    if (ask.contains("price") && ask.contains("size")) {
                                        double price = std::stod(ask["price"].get<std::string>());
                                        double size = std::stod(ask["size"].get<std::string>());
                                        book_update.asks.push_back(std::make_pair(price, size));
                                    }
                                }
                            }
                            
                            // Extract ALL bids
                            if (item.contains("bids") && item["bids"].is_array()) {
                                for (const auto& bid : item["bids"]) {
                                    if (bid.contains("price") && bid.contains("size")) {
                                        double price = std::stod(bid["price"].get<std::string>());
                                        double size = std::stod(bid["size"].get<std::string>());
                                        book_update.bids.push_back(std::make_pair(price, size));
                                    }
                                }
                            }
                            
                            if (!book_update.asks.empty() || !book_update.bids.empty()) {
                                if (orderbook_callback_) {
                                    orderbook_callback_(book_update);
                                }
                            }
                        }
                    }
                }
                // PRIORITY 2: Single object with full orderbook
                else if (j.contains("asset_id") && (j.contains("bids") || j.contains("asks")) && !j.contains("price_changes")) {
                    // Full orderbook snapshot from WebSocket
                    OrderbookUpdate book_update;
                    book_update.token_id = j["asset_id"].get<std::string>();
                    
                    // Extract ALL asks from book
                    if (j.contains("asks") && j["asks"].is_array()) {
                        for (const auto& ask : j["asks"]) {
                            if (ask.contains("price") && ask.contains("size")) {
                                double price = std::stod(ask["price"].get<std::string>());
                                double size = std::stod(ask["size"].get<std::string>());
                                book_update.asks.push_back(std::make_pair(price, size));
                            }
                        }
                    }
                    
                    // Extract ALL bids from book
                    if (j.contains("bids") && j["bids"].is_array()) {
                        for (const auto& bid : j["bids"]) {
                            if (bid.contains("price") && bid.contains("size")) {
                                double price = std::stod(bid["price"].get<std::string>());
                                double size = std::stod(bid["size"].get<std::string>());
                                book_update.bids.push_back(std::make_pair(price, size));
                            }
                        }
                    }
                    
                    // Send to orderbook callback (FULL depth)
                    if (!book_update.asks.empty() || !book_update.bids.empty()) {
                        if (orderbook_callback_) {
                            orderbook_callback_(book_update);
                        }
                    }
                }
                // PRIORITY 2: Handle price_changes array (trades, price updates)
                else if (j.contains("price_changes") && j["price_changes"].is_array()) {
                    for (const auto& change : j["price_changes"]) {
                        PriceUpdate update;
                        update.token_id = change.value("asset_id", "");
                        
                        if (change.contains("price")) {
                            if (change["price"].is_string()) {
                                update.price = std::stod(change["price"].get<std::string>());
                            } else {
                                update.price = change["price"].get<double>();
                            }
                        }
                        
                        // Extract best_bid and best_ask for orderbook
                        double best_bid = 0.0, best_ask = 0.0;
                        if (change.contains("best_bid")) {
                            if (change["best_bid"].is_string()) {
                                best_bid = std::stod(change["best_bid"].get<std::string>());
                            } else if (change["best_bid"].is_number()) {
                                best_bid = change["best_bid"].get<double>();
                            }
                        }
                        if (change.contains("best_ask")) {
                            if (change["best_ask"].is_string()) {
                                best_ask = std::stod(change["best_ask"].get<std::string>());
                            } else if (change["best_ask"].is_number()) {
                                best_ask = change["best_ask"].get<double>();
                            }
                        }
                        
                        // Create simple orderbook from best_bid/best_ask
                        if (!update.token_id.empty() && (best_bid > 0 || best_ask > 0) && orderbook_callback_) {
                            OrderbookUpdate book_update;
                            book_update.token_id = update.token_id;
                            if (best_ask > 0) book_update.asks.push_back({best_ask, 100.0});
                            if (best_bid > 0) book_update.bids.push_back({best_bid, 100.0});
                            orderbook_callback_(book_update);
                        }
                        
                        if (!update.token_id.empty() && update.price > 0 && callback_) {
                            callback_(update);
                        }
                    }
                }
                // Handle event_type format
                else if (j.contains("event_type")) {
                    std::string event_type = j["event_type"];
                    
                    if (event_type == "price_change" && j.contains("asset_id")) {
                        PriceUpdate update;
                        update.token_id = j["asset_id"];
                        
                        if (j.contains("price")) {
                            if (j["price"].is_string()) {
                                update.price = std::stod(j["price"].get<std::string>());
                            } else {
                                update.price = j["price"].get<double>();
                            }
                        }
                        
                        if (j.contains("best_bid")) {
                            if (j["best_bid"].is_string()) {
                                update.best_bid = std::stod(j["best_bid"].get<std::string>());
                            } else {
                                update.best_bid = j["best_bid"].get<double>();
                            }
                        }
                        
                        if (j.contains("best_ask")) {
                            if (j["best_ask"].is_string()) {
                                update.best_ask = std::stod(j["best_ask"].get<std::string>());
                            } else {
                                update.best_ask = j["best_ask"].get<double>();
                            }
                        }
                        
                        if (callback_) {
                            callback_(update);
                        }
                    }
                }
                // Handle book snapshots (has asset_id + bids/asks arrays)
                else if (j.contains("asset_id") && (j.contains("bids") || j.contains("asks"))) {
                    // Full orderbook snapshot from WebSocket
                    OrderbookUpdate book_update;
                    book_update.token_id = j["asset_id"].get<std::string>();
                    
                    // Extract ALL asks from book
                    if (j.contains("asks") && j["asks"].is_array()) {
                        for (const auto& ask : j["asks"]) {
                            if (ask.contains("price") && ask.contains("size")) {
                                double price = std::stod(ask["price"].get<std::string>());
                                double size = std::stod(ask["size"].get<std::string>());
                                book_update.asks.push_back(std::make_pair(price, size));
                            }
                        }
                    }
                    
                    // Extract ALL bids from book
                    if (j.contains("bids") && j["bids"].is_array()) {
                        for (const auto& bid : j["bids"]) {
                            if (bid.contains("price") && bid.contains("size")) {
                                double price = std::stod(bid["price"].get<std::string>());
                                double size = std::stod(bid["size"].get<std::string>());
                                book_update.bids.push_back(std::make_pair(price, size));
                            }
                        }
                    }
                    
                    // Send to orderbook callback (FULL depth)
                    if (!book_update.asks.empty() || !book_update.bids.empty()) {
                        if (orderbook_callback_) {
                            orderbook_callback_(book_update);
                        }
                    }
                }
                // Handle last_trade_price updates
                else if (j.contains("type") && j["type"] == "last_trade_price") {
                    PriceUpdate update;
                    update.token_id = j.value("asset_id", "");
                    
                    if (j.contains("price")) {
                        if (j["price"].is_string()) {
                            update.price = std::stod(j["price"].get<std::string>());
                        } else {
                            update.price = j["price"].get<double>();
                        }
                    }
                    
                    if (!update.token_id.empty() && update.price > 0 && callback_) {
                        callback_(update);
                    }
                }
                // Also handle direct price updates (legacy format)
                else if (j.contains("asset_id") && j.contains("price")) {
                    PriceUpdate update;
                    update.token_id = j["asset_id"];
                    
                    if (j["price"].is_string()) {
                        update.price = std::stod(j["price"].get<std::string>());
                    } else {
                        update.price = j["price"].get<double>();
                    }
                    
                    if (callback_) {
                        callback_(update);
                    }
                }
                
            } catch (const nlohmann::json::exception& e) {
                // Ignore JSON parse errors for non-price messages
            }
            
        } catch (const beast::system_error& e) {
            if (e.code() != websocket::error::closed) {
                std::cerr << "[WS] Read error: " << e.what() << std::endl;
            }
            break;
        }
    }
    
    connected_ = false;
    std::cout << "[WS] Disconnected" << std::endl;
}

} // namespace poly
