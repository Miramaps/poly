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
    for (const auto& t : subscribed_tokens_) {
        if (t == token_id) return;
    }
    subscribed_tokens_.push_back(token_id);
    if (connected_) {
        send_subscribe(token_id);
    }
}

void WebSocketPriceStream::unsubscribe(const std::string& token_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = std::find(subscribed_tokens_.begin(), subscribed_tokens_.end(), token_id);
    if (it != subscribed_tokens_.end()) {
        subscribed_tokens_.erase(it);
    }
}

void WebSocketPriceStream::clear_subscriptions() {
    std::lock_guard<std::mutex> lock(mutex_);
    subscribed_tokens_.clear();
}

void WebSocketPriceStream::reconnect() {
    if (ws_ && connected_) {
        try {
            ws_->close(websocket::close_code::normal);
        } catch (...) {}
    }
    connected_ = false;
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

void WebSocketPriceStream::run() {
    while (running_) {
        try {
            ioc_.restart();
            connect();
            if (connected_) {
                std::cout << "[WS] ✓ Connected to Polymarket" << std::endl;
                read_loop();
            }
        } catch (const std::exception& e) {
            std::cerr << "[WS] Error: " << e.what() << std::endl;
            connected_ = false;
        }
        if (running_) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
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
    
    if (!SSL_set_tlsext_host_name(ws_->next_layer().native_handle(), host.c_str())) {
        throw beast::system_error(
            beast::error_code(static_cast<int>(::ERR_get_error()), net::error::get_ssl_category()),
            "Failed to set SNI hostname"
        );
    }
    
    auto ep = net::connect(beast::get_lowest_layer(*ws_), results);
    ws_->next_layer().handshake(ssl::stream_base::client);
    
    ws_->set_option(websocket::stream_base::timeout::suggested(beast::role_type::client));
    ws_->set_option(websocket::stream_base::decorator(
        [](websocket::request_type& req) {
            req.set(http::field::user_agent, "PolyTrader/1.0");
        }
    ));
    
    std::string ws_host = host + ":" + std::to_string(ep.port());
    ws_->handshake(ws_host, target);
    
    connected_ = true;
    
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& token : subscribed_tokens_) {
        send_subscribe(token);
    }
}

void WebSocketPriceStream::send_subscribe(const std::string& token_id) {
    if (!connected_ || !ws_) return;
    try {
        nlohmann::json sub = {
            {"type", "subscribe"},
            {"channel", "market"},
            {"assets_ids", {token_id}}
        };
        ws_->write(net::buffer(sub.dump()));
        std::cout << "[WS] Subscribed: " << token_id.substr(0,20) << "..." << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[WS] Subscribe error: " << e.what() << std::endl;
    }
}

void WebSocketPriceStream::send_unsubscribe(const std::string&) {}

void WebSocketPriceStream::read_loop() {
    beast::flat_buffer buffer;
    int msg_count = 0;
    
    while (running_ && connected_) {
        try {
            buffer.clear();
            ws_->read(buffer);
            
            std::string msg = beast::buffers_to_string(buffer.data());
            msg_count++;
            
            if (msg_count <= 5) {
                std::cout << "[WS MSG #" << msg_count << "] " << msg.substr(0, 100) << "..." << std::endl;
            }
            
            try {
                auto j = nlohmann::json::parse(msg);
                
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
            } catch (...) {}
            
        } catch (const beast::system_error& e) {
            if (e.code() != websocket::error::closed) {
                std::cerr << "[WS] Read error: " << e.what() << std::endl;
            }
            break;
        }
    }
    
    connected_ = false;
}

} // namespace poly
