#include "ws_server.hpp"
#include <iostream>

namespace poly {

std::unique_ptr<WSServer> g_ws_server;

WSSession::WSSession(tcp::socket socket, std::function<void(std::shared_ptr<WSSession>)> on_close)
    : ws_(std::move(socket)), on_close_(std::move(on_close)) {}

void WSSession::run() {
    ws_.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));
    ws_.set_option(websocket::stream_base::decorator([](websocket::response_type& res) {
        res.set(beast::http::field::server, "PolyTrader/1.0");
        res.set(beast::http::field::access_control_allow_origin, "*");
    }));
    
    ws_.async_accept([self = shared_from_this()](beast::error_code ec) {
        if (!ec) {
            self->do_read();
        } else {
            self->on_close_(self);
        }
    });
}

void WSSession::do_read() {
    ws_.async_read(buffer_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
        if (ec) {
            self->on_close_(self);
            return;
        }
        self->buffer_.consume(self->buffer_.size());
        self->do_read();
    });
}

void WSSession::send(const std::string& msg) {
    auto self = shared_from_this();
    ws_.async_write(net::buffer(msg), [self](beast::error_code ec, std::size_t) {
        if (ec) {
            self->on_close_(self);
        }
    });
}

WSServer::WSServer(unsigned short port)
    : acceptor_(ioc_, tcp::endpoint(tcp::v4(), port)) {
    acceptor_.set_option(net::socket_base::reuse_address(true));
}

WSServer::~WSServer() { stop(); }

void WSServer::start() {
    if (running_.exchange(true)) return;
    do_accept();
    worker_ = std::thread([this] { ioc_.run(); });
    std::cout << "[WS-SERVER] Dashboard WebSocket started on port 3002" << std::endl;
}

void WSServer::stop() {
    running_ = false;
    ioc_.stop();
    if (worker_.joinable()) worker_.join();
}

void WSServer::do_accept() {
    acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
        if (!ec) {
            auto session = std::make_shared<WSSession>(
                std::move(socket),
                [this](std::shared_ptr<WSSession> s) { on_session_close(s); }
            );
            {
                std::lock_guard<std::mutex> lock(sessions_mutex_);
                sessions_.insert(session);
            }
            session->run();
        }
        if (running_) do_accept();
    });
}

void WSServer::on_session_close(std::shared_ptr<WSSession> session) {
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    sessions_.erase(session);
}

void WSServer::broadcast(const std::string& msg) {
    std::lock_guard<std::mutex> lock(sessions_mutex_);
    for (auto& session : sessions_) {
        session->send(msg);
    }
}

void start_ws_server(unsigned short port) {
    g_ws_server = std::make_unique<WSServer>(port);
    g_ws_server->start();
}

void broadcast_status(const std::string& json) {
    if (g_ws_server) g_ws_server->broadcast(json);
}

} // namespace poly
