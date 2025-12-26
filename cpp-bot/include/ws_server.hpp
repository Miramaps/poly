#pragma once
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio.hpp>
#include <memory>
#include <set>
#include <mutex>
#include <thread>
#include <atomic>
#include <string>
#include <functional>

namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;

namespace poly {

class WSSession : public std::enable_shared_from_this<WSSession> {
    websocket::stream<tcp::socket> ws_;
    beast::flat_buffer buffer_;
    std::function<void(std::shared_ptr<WSSession>)> on_close_;
    
public:
    explicit WSSession(tcp::socket socket, std::function<void(std::shared_ptr<WSSession>)> on_close);
    void run();
    void send(const std::string& msg);
    
private:
    void on_accept(beast::error_code ec);
    void do_read();
    void on_read(beast::error_code ec, std::size_t bytes);
};

class WSServer {
    net::io_context ioc_;
    tcp::acceptor acceptor_;
    std::set<std::shared_ptr<WSSession>> sessions_;
    std::mutex sessions_mutex_;
    std::thread worker_;
    std::atomic<bool> running_{false};
    
public:
    WSServer(unsigned short port);
    ~WSServer();
    void start();
    void stop();
    void broadcast(const std::string& msg);
    
private:
    void do_accept();
    void on_session_close(std::shared_ptr<WSSession> session);
};

// Global instance
extern std::unique_ptr<WSServer> g_ws_server;
void start_ws_server(unsigned short port);
void broadcast_status(const std::string& json);

} // namespace poly
