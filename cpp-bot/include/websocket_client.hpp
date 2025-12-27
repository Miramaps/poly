#pragma once

#include <boost/beast/core.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/websocket/ssl.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/ssl/stream.hpp>
#include <nlohmann/json.hpp>
#include <string>
#include <functional>
#include <thread>
#include <atomic>
#include <mutex>

namespace poly {

namespace beast = boost::beast;
namespace http = beast::http;
namespace websocket = beast::websocket;
namespace net = boost::asio;
namespace ssl = boost::asio::ssl;
using tcp = boost::asio::ip::tcp;

struct PriceUpdate {
    std::string token_id;
    double price = 0.0;
    double best_bid = 0.0;
    double best_ask = 0.0;
    uint64_t timestamp = 0;
};

class WebSocketPriceStream {
public:
    using PriceCallback = std::function<void(const PriceUpdate& update)>;
    
    WebSocketPriceStream();
    ~WebSocketPriceStream();
    
    void set_callback(PriceCallback cb);
    void subscribe(const std::string& token_id);
    void unsubscribe(const std::string& token_id);
    void clear_subscriptions();
    void start();
    void stop();
    bool is_connected() const { return connected_.load(); }
    
    // Reconnect to WebSocket (disconnect and connect again)
    void reconnect();
    
private:
    void run();
    void connect();
    void read_loop();
    void send_subscribe(const std::string& token_id);
    void send_unsubscribe(const std::string& token_id);
    
    net::io_context ioc_;
    ssl::context ctx_{ssl::context::tlsv12_client};
    std::unique_ptr<websocket::stream<beast::ssl_stream<tcp::socket>>> ws_;
    
    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    std::thread worker_thread_;
    
    PriceCallback callback_;
    std::vector<std::string> subscribed_tokens_;
    std::mutex mutex_;
};

} // namespace poly
