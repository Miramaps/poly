#include "websocket_client.hpp"
#include <iostream>
#include <sstream>

namespace poly {

WebSocketPriceStream::WebSocketPriceStream() {
    // Load SSL certificates
    ctx_.set_default_verify_paths();
    ctx_.set_verify_mode(ssl::verify_none); // For simplicity
}

WebSocketPriceStream::~WebSocketPriceStream() {
    stop();
}

void WebSocketPriceStream::set_callback(PriceCallback cb) {
    callback_ = std::move(cb);
}

void WebSocketPriceStream::subscribe(const std::string& token_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    subscribed_tokens_.push_back(token_id);
    if (connected_) {
        send_subscribe(token_id);
    }
}

void WebSocketPriceStream::unsubscribe(const std::string& token_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    subscribed_tokens_.erase(
        std::remove(subscribed_tokens_.begin(), subscribed_tokens_.end(), token_id),
        subscribed_tokens_.end()
    );
}

void WebSocketPriceStream::start() {
    if (running_.exchange(true)) return;
    worker_thread_ = std::thread(&WebSocketPriceStream::run, this);
}

void WebSocketPriceStream::stop() {
    running_ = false;
    if (ws_ && connected_) {
        try {
            ws_->close(websocket::close_code::normal);
        } catch (...) {}
    }
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
}

void WebSocketPriceStream::run() {
    while (running_) {
        try {
            connect();
            if (connected_) {
                read_loop();
            }
        } catch (const std::exception& e) {
            std::cerr << "[WS] Error: " << e.what() << std::endl;
            connected_ = false;
        }
        
        if (running_) {
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
    
    // Connect
    auto ep = net::connect(beast::get_lowest_layer(*ws_), results);
    
    // SSL handshake
    ws_->next_layer().handshake(ssl::stream_base::client);
    
    // Set a decorator to change the User-Agent
    ws_->set_option(websocket::stream_base::decorator(
        [](websocket::request_type& req) {
            req.set(http::field::user_agent, "PolyTrader/1.0");
        }
    ));
    
    // WebSocket handshake
    std::string ws_host = host + ":" + std::to_string(ep.port());
    ws_->handshake(ws_host, target);
    
    connected_ = true;
    std::cout << "[WS] Connected to Polymarket price stream" << std::endl;
    
    // Subscribe to all tokens
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& token : subscribed_tokens_) {
        send_subscribe(token);
    }
}

void WebSocketPriceStream::send_subscribe(const std::string& token_id) {
    if (!connected_ || !ws_) return;
    
    nlohmann::json sub_msg = {
        {"type", "subscribe"},
        {"channel", "price"},
        {"assets_ids", {token_id}}
    };
    
    try {
        ws_->write(net::buffer(sub_msg.dump()));
        std::cout << "[WS] Subscribed to " << token_id.substr(0, 20) << "..." << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[WS] Subscribe error: " << e.what() << std::endl;
    }
}

void WebSocketPriceStream::read_loop() {
    beast::flat_buffer buffer;
    
    while (running_ && connected_) {
        try {
            buffer.clear();
            ws_->read(buffer);
            
            std::string msg = beast::buffers_to_string(buffer.data());
            
            try {
                auto j = nlohmann::json::parse(msg);
                
                // Handle price updates
                if (j.contains("asset_id") && j.contains("price")) {
                    std::string token_id = j["asset_id"];
                    double price = 0.0;
                    
                    if (j["price"].is_string()) {
                        price = std::stod(j["price"].get<std::string>());
                    } else {
                        price = j["price"].get<double>();
                    }
                    
                    if (callback_) {
                        callback_(token_id, price);
                    }
                }
            } catch (...) {
                // Ignore parse errors for non-price messages
            }
            
        } catch (const beast::system_error& e) {
            if (e.code() != websocket::error::closed) {
                throw;
            }
            break;
        }
    }
    
    connected_ = false;
}

} // namespace poly
