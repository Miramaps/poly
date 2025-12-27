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
        // Subscribe using assets_ids array (Polymarket format)
        nlohmann::json market_sub = {
            {"type", "subscribe"},
            {"channel", "market"},
            {"assets_ids", {token_id}}
        };
        
        std::string sub_msg = market_sub.dump();
        ws_->write(net::buffer(sub_msg));
        
        std::cout << "[WS] Subscribed: " << sub_msg << std::endl;
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
            
            // DEBUG: Show first 10 messages to see what we're getting
            if (msg_count <= 10) {
                std::cout << "[WS MSG #" << msg_count << "] " << msg.substr(0, 150) << "..." << std::endl;
            }
            
            try {
                auto j = nlohmann::json::parse(msg);
                
                // Handle price_changes array (main format from Polymarket)
                if (j.contains("price_changes") && j["price_changes"].is_array()) {
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
                // Handle book update messages
                else if (j.contains("type") && j["type"] == "book" && j.contains("asset_id")) {
                    PriceUpdate update;
                    update.token_id = j["asset_id"];
                    
                    // Extract best ask from book
                    if (j.contains("asks") && j["asks"].is_array() && !j["asks"].empty()) {
                        auto& best_ask = j["asks"][0];
                        if (best_ask.contains("price")) {
                            std::string price_str = best_ask["price"].get<std::string>();
                            update.best_ask = std::stod(price_str);
                            update.price = update.best_ask;
                        }
                    }
                    
                    // Extract best bid from book
                    if (j.contains("bids") && j["bids"].is_array() && !j["bids"].empty()) {
                        auto& best_bid = j["bids"][0];
                        if (best_bid.contains("price")) {
                            std::string price_str = best_bid["price"].get<std::string>();
                            update.best_bid = std::stod(price_str);
                        }
                    }
                    
                    if (update.price > 0 && callback_) {
                        callback_(update);
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
