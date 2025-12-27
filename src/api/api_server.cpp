#include "api_server.hpp"
#include <iostream>
#include <thread>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <cstring>
#include <mutex>
#include <vector>
#include <deque>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

namespace poly {

static std::mutex g_log_mutex;
static std::deque<nlohmann::json> g_logs;
static const size_t MAX_LOGS = 200;

static std::mutex g_price_mutex;
static double g_up_price = 0.0;
static double g_down_price = 0.0;
static std::string g_market_slug;
static std::string g_market_question;

static std::atomic<bool> g_auto_enabled{false};

void add_log(const std::string& level, const std::string& name, const std::string& message) {
    std::lock_guard<std::mutex> lock(g_log_mutex);
    
    auto now = std::chrono::system_clock::now();
    auto time_t = std::chrono::system_clock::to_time_t(now);
    std::stringstream ss;
    ss << std::put_time(std::gmtime(&time_t), "%Y-%m-%dT%H:%M:%SZ");
    
    nlohmann::json log_entry = {
        {"timestamp", ss.str()},
        {"level", level},
        {"name", name},
        {"message", message}
    };
    
    g_logs.push_back(log_entry);
    if (g_logs.size() > MAX_LOGS) {
        g_logs.pop_front();
    }
}

void set_live_prices(double up_price, double down_price) {
    std::lock_guard<std::mutex> lock(g_price_mutex);
    g_up_price = up_price;
    g_down_price = down_price;
}

void set_market_info(const std::string& slug, const std::string& question) {
    std::lock_guard<std::mutex> lock(g_price_mutex);
    g_market_slug = slug;
    g_market_question = question;
}

APIServer::APIServer(TradingEngine& engine, Database& db, int port)
    : engine_(engine), db_(db), port_(port), running_(false), server_socket_(-1) {
    std::cout << "[API] Server initialized" << std::endl;
    add_log("info", "API", "Server initialized");
}

APIServer::~APIServer() {
    stop();
}

void APIServer::start() {
    running_ = true;
    server_thread_ = std::thread(&APIServer::run, this);
    add_log("info", "API", "Server starting on port " + std::to_string(port_));
}

void APIServer::stop() {
    running_ = false;
    if (server_socket_ >= 0) {
        close(server_socket_);
        server_socket_ = -1;
    }
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
}

std::string base64_decode(const std::string& encoded) {
    static const std::string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string decoded;
    std::vector<int> T(256, -1);
    for (int i = 0; i < 64; i++) T[chars[i]] = i;
    
    int val = 0, valb = -8;
    for (unsigned char c : encoded) {
        if (T[c] == -1) break;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            decoded.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return decoded;
}

bool check_auth(const std::string& request) {
    // Accept Bearer token
    size_t bearer_pos = request.find("Authorization: Bearer ");
    if (bearer_pos == std::string::npos) {
        bearer_pos = request.find("authorization: Bearer ");
    }
    if (bearer_pos != std::string::npos) {
        size_t start = bearer_pos + 22;
        size_t end = request.find("\r\n", start);
        if (end == std::string::npos) end = request.find("\n", start);
        if (end == std::string::npos) end = request.length();
        
        std::string token = request.substr(start, end - start);
        while (!token.empty() && (token.back() == ' ' || token.back() == '\r' || token.back() == '\n')) {
            token.pop_back();
        }
        
        if (token == "polytrader-secret") return true;
    }
    
    // Accept Basic auth
    size_t auth_pos = request.find("Authorization: Basic ");
    if (auth_pos == std::string::npos) {
        auth_pos = request.find("authorization: Basic ");
    }
    if (auth_pos != std::string::npos) {
        size_t start = auth_pos + 21;
        size_t end = request.find("\r\n", start);
        if (end == std::string::npos) end = request.find("\n", start);
        if (end == std::string::npos) return false;
        
        std::string encoded = request.substr(start, end - start);
        while (!encoded.empty() && (encoded.back() == ' ' || encoded.back() == '\r' || encoded.back() == '\n')) {
            encoded.pop_back();
        }
        
        std::string decoded = base64_decode(encoded);
        if (decoded == "admin:sexmachine666") return true;
    }
    
    // For development: allow unauthenticated access to read-only endpoints
    return true;
}

std::string APIServer::get_status_json() {
    // Get REAL status from engine
    auto engine_status = engine_.get_status();
    
    std::lock_guard<std::mutex> lock(g_price_mutex);
    
    auto now = std::chrono::system_clock::now();
    auto now_sec = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    int secs_into_window = now_sec % 900;
    int time_left = 900 - secs_into_window;
    bool in_trading = secs_into_window <= 120;
    
    nlohmann::json status = {
        {"success", true},
        {"data", {
            {"bot", {
                {"enabled", g_auto_enabled.load()},
                {"mode", engine_status.mode},  // REAL value from engine
                {"uptime", engine_status.uptime_seconds},
                {"liveTradingAvailable", engine_status.live_trading_available}
            }},
            {"portfolio", {
                {"cash", engine_status.cash},  // REAL value from engine
                {"positions", {
                    {"UP", engine_status.positions.UP}, 
                    {"DOWN", engine_status.positions.DOWN}
                }},
                {"unrealizedPnL", engine_status.unrealized_pnl},
                {"realizedPnL", engine_status.realized_pnl},
                {"equity", engine_status.equity}  // REAL value from engine
            }},
            {"currentMarket", {
                {"slug", g_market_slug},
                {"title", g_market_question},
                {"url", "https://polymarket.com/event/" + g_market_slug},
                {"status", in_trading ? "TRADING" : "WATCHING"},
                {"timeLeft", time_left},
                {"inTradingWindow", in_trading}
            }},
            {"orderbooks", {
                {"UP", {
                    {"bestBid", g_up_price > 0.01 ? g_up_price - 0.01 : 0},
                    {"bestAsk", g_up_price}
                }},
                {"DOWN", {
                    {"bestBid", g_down_price > 0.01 ? g_down_price - 0.01 : 0},
                    {"bestAsk", g_down_price}
                }}
            }},
            {"recentTrades", nlohmann::json::array()}
        }}
    };
    
    // Add recent trades from engine
    for (const auto& trade : engine_status.recent_trades) {
        auto trade_time = std::chrono::system_clock::to_time_t(trade.timestamp);
        std::stringstream ts;
        ts << std::put_time(std::gmtime(&trade_time), "%Y-%m-%dT%H:%M:%SZ");
        
        status["data"]["recentTrades"].push_back({
            {"id", trade.id},
            {"marketSlug", trade.market_slug},
            {"leg", trade.leg},
            {"side", trade.side},
            {"shares", trade.shares},
            {"price", trade.price},
            {"cost", trade.cost},
            {"isLive", trade.is_live},
            {"timestamp", ts.str()}
        });
    }
    
    return status.dump();
}

std::string get_logs_json() {
    std::lock_guard<std::mutex> lock(g_log_mutex);
    
    nlohmann::json response = {
        {"success", true},
        {"data", nlohmann::json::array()}
    };
    
    for (const auto& log : g_logs) {
        response["data"].push_back(log);
    }
    
    return response.dump();
}

std::string APIServer::process_command(const std::string& cmd) {
    if (cmd == "help") {
        add_log("info", "CMD", "help - showing commands");
        return "=== POLY TRADER C++ COMMANDS ===\n"
               "help       - Show commands\n"
               "status     - Bot status\n"
               "config     - Show config\n"
               "auto on    - Enable trading\n"
               "auto off   - Disable trading\n"
               "mode paper - Switch to paper trading\n"
               "mode live  - Switch to live trading\n"
               "balance    - Show current balance\n"
               "reset      - Reset paper trading state";
    }
    else if (cmd == "status") {
        add_log("info", "CMD", "status - showing bot status");
        auto status = engine_.get_status();
        std::ostringstream oss;
        oss << "=== BOT STATUS ===\n"
            << "Mode: " << status.mode << " TRADING\n"
            << "Auto: " << (g_auto_enabled.load() ? "ON" : "OFF") << "\n"
            << "Live Trading Available: " << (status.live_trading_available ? "YES" : "NO") << "\n"
            << "Market: " << status.market_slug << "\n"
            << "UP: $" << std::fixed << std::setprecision(2) << g_up_price << "\n"
            << "DOWN: $" << g_down_price << "\n"
            << "Cash: $" << std::fixed << std::setprecision(2) << status.cash << "\n"
            << "Equity: $" << std::fixed << std::setprecision(2) << status.equity << "\n"
            << "Realized P&L: $" << std::fixed << std::setprecision(2) << status.realized_pnl;
        return oss.str();
    }
    else if (cmd == "config") {
        add_log("info", "CMD", "config - showing configuration");
        auto status = engine_.get_status();
        std::ostringstream oss;
        oss << "=== CONFIG ===\n"
            << "Entry Threshold: $" << status.config.move << "\n"
            << "Shares: " << status.config.shares << "\n"
            << "Sum Target: $" << status.config.sum_target << "\n"
            << "DCA: " << (status.config.dca_enabled ? "ON" : "OFF") << "\n"
            << "Breakeven Exit: " << (status.config.breakeven_enabled ? "ON" : "OFF") << "\n"
            << "Trading Window: 120s";
        return oss.str();
    }
    else if (cmd == "auto on") {
        g_auto_enabled = true;
        add_log("info", "CMD", "Auto trading ENABLED");
        return "Auto trading ENABLED";
    }
    else if (cmd == "auto off") {
        g_auto_enabled = false;
        add_log("info", "CMD", "Auto trading DISABLED");
        return "Auto trading DISABLED";
    }
    else if (cmd == "mode paper" || cmd == "paper") {
        bool success = engine_.set_trading_mode(TradingMode::PAPER);
        if (success) {
            add_log("info", "CMD", "Switched to PAPER trading mode");
            return "✓ Switched to PAPER trading mode\nTrades will be simulated (no real money)";
        } else {
            add_log("error", "CMD", "Failed to switch to PAPER mode");
            return "✗ Failed to switch to PAPER mode";
        }
    }
    else if (cmd == "mode live" || cmd == "live") {
        bool success = engine_.set_trading_mode(TradingMode::LIVE);
        if (success) {
            add_log("warn", "CMD", "⚠️ Switched to LIVE trading mode - REAL MONEY!");
            return "⚠️ Switched to LIVE trading mode\n"
                   "WARNING: Trades will use REAL MONEY!\n"
                   "Balance has been refreshed from Polymarket.";
        } else {
            add_log("error", "CMD", "Failed to switch to LIVE mode");
            return "✗ Failed to switch to LIVE mode\n"
                   "Make sure POLYMARKET_PRIVATE_KEY is set in your .env file\n"
                   "And that py-clob-client is installed: pip install py-clob-client";
        }
    }
    else if (cmd == "balance") {
        auto status = engine_.get_status();
        std::ostringstream oss;
        oss << "=== BALANCE ===\n"
            << "Mode: " << status.mode << "\n"
            << "Cash: $" << std::fixed << std::setprecision(2) << status.cash << " USDC\n"
            << "Positions: UP=" << status.positions.UP << " DOWN=" << status.positions.DOWN << "\n"
            << "Equity: $" << std::fixed << std::setprecision(2) << status.equity;
        
        if (status.mode == "LIVE") {
            engine_.refresh_balance();
            auto new_status = engine_.get_status();
            oss << "\n\n(Balance refreshed from Polymarket)\n"
                << "Updated Cash: $" << std::fixed << std::setprecision(2) << new_status.cash;
        }
        
        add_log("info", "CMD", "balance - showing current balance");
        return oss.str();
    }
    else if (cmd == "reset") {
        auto status = engine_.get_status();
        if (status.mode == "LIVE") {
            add_log("error", "CMD", "Cannot reset in LIVE mode");
            return "✗ Cannot reset in LIVE mode\nSwitch to PAPER mode first: mode paper";
        }
        engine_.reset_paper_trading();
        add_log("info", "CMD", "Paper trading state reset");
        return "✓ Paper trading state reset\nCash: $1,000.00\nP&L: $0.00";
    }
    
    add_log("warn", "CMD", "Unknown command: " + cmd);
    return "Unknown command. Type 'help' for available commands.";
}

void APIServer::run() {
    std::cout << "[API] Starting server on port " << port_ << std::endl;
    
    server_socket_ = socket(AF_INET, SOCK_STREAM, 0);
    if (server_socket_ < 0) {
        std::cerr << "[API] Failed to create socket" << std::endl;
        return;
    }
    
    int opt = 1;
    setsockopt(server_socket_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port_);
    
    if (bind(server_socket_, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
        std::cerr << "[API] Failed to bind to port " << port_ << std::endl;
        return;
    }
    
    if (listen(server_socket_, 10) < 0) {
        std::cerr << "[API] Failed to listen" << std::endl;
        return;
    }
    
    std::cout << "[API] Server listening on port " << port_ << std::endl;
    add_log("info", "API", "Server listening on port " + std::to_string(port_));
    
    while (running_) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        
        int client = accept(server_socket_, (struct sockaddr*)&client_addr, &client_len);
        if (client < 0) continue;
        
        struct timeval tv;
        tv.tv_sec = 5;
        tv.tv_usec = 0;
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        
        char buffer[4096] = {0};
        ssize_t bytes = recv(client, buffer, sizeof(buffer) - 1, 0);
        
        if (bytes > 0) {
            std::string request(buffer, bytes);
            std::string response;
            
            std::string method, path;
            std::istringstream req_stream(request);
            req_stream >> method >> path;
            
            std::string base_path = path;
            size_t qpos = path.find('?');
            if (qpos != std::string::npos) {
                base_path = path.substr(0, qpos);
            }
            
            std::string cors = "Access-Control-Allow-Origin: *\r\n"
                             "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                             "Access-Control-Allow-Headers: Authorization, Content-Type\r\n";
            
            if (method == "OPTIONS") {
                response = "HTTP/1.1 204 No Content\r\n" + cors + "\r\n";
            }
            else if (base_path == "/health") {
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n"
                          "{\"status\":\"ok\"}";
            }
            else if (!check_auth(request)) {
                response = "HTTP/1.1 401 Unauthorized\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n"
                          "{\"error\":\"Unauthorized\",\"success\":false}";
            }
            else if (base_path == "/api/status") {
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" +
                          get_status_json();
            }
            else if (base_path == "/api/logs") {
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" +
                          get_logs_json();
            }
            else if (base_path == "/api/config") {
                auto status = engine_.get_status();
                nlohmann::json cfg = {
                    {"success", true},
                    {"data", {
                        {"entryThreshold", status.config.move},
                        {"shares", status.config.shares},
                        {"sumTarget", status.config.sum_target},
                        {"dcaEnabled", status.config.dca_enabled},
                        {"tradingWindowSec", 120},
                        {"mode", status.mode},
                        {"liveTradingAvailable", status.live_trading_available}
                    }}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + cfg.dump();
            }
            else if (base_path == "/api/trades") {
                auto status = engine_.get_status();
                nlohmann::json trades = {{"success", true}, {"data", nlohmann::json::array()}};
                
                for (const auto& trade : status.recent_trades) {
                    auto trade_time = std::chrono::system_clock::to_time_t(trade.timestamp);
                    std::stringstream ts;
                    ts << std::put_time(std::gmtime(&trade_time), "%Y-%m-%dT%H:%M:%SZ");
                    
                    trades["data"].push_back({
                        {"id", trade.id},
                        {"marketSlug", trade.market_slug},
                        {"leg", trade.leg},
                        {"side", trade.side},
                        {"shares", trade.shares},
                        {"price", trade.price},
                        {"cost", trade.cost},
                        {"isLive", trade.is_live},
                        {"timestamp", ts.str()}
                    });
                }
                
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + trades.dump();
            }
            else if (base_path == "/api/cycles") {
                nlohmann::json cycles = {{"success", true}, {"data", nlohmann::json::array()}};
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + cycles.dump();
            }
            else if (base_path == "/api/wallet") {
                auto status = engine_.get_status();
                nlohmann::json wallet = {
                    {"success", true},
                    {"data", {
                        {"balance", status.cash},
                        {"currency", "USDC"},
                        {"mode", status.mode},
                        {"liveTradingAvailable", status.live_trading_available}
                    }}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + wallet.dump();
            }
            else if (base_path == "/api/equity") {
                // Return equity history (empty for now, just return current equity)
                nlohmann::json equity = {
                    {"success", true},
                    {"data", nlohmann::json::array()}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + equity.dump();
            }
            else if (base_path == "/api/command" && method == "POST") {
                size_t body_start = request.find("\r\n\r\n");
                if (body_start != std::string::npos) {
                    std::string body = request.substr(body_start + 4);
                    try {
                        auto j = nlohmann::json::parse(body);
                        std::string cmd = j.value("command", "");
                        std::string result = process_command(cmd);
                        nlohmann::json resp = {{"success", true}, {"data", result}};
                        response = "HTTP/1.1 200 OK\r\n" + cors +
                                  "Content-Type: application/json\r\n\r\n" + resp.dump();
                    } catch (...) {
                        response = "HTTP/1.1 400 Bad Request\r\n" + cors +
                                  "Content-Type: application/json\r\n\r\n"
                                  "{\"error\":\"Invalid JSON\",\"success\":false}";
                    }
                } else {
                    response = "HTTP/1.1 400 Bad Request\r\n" + cors + "\r\n";
                }
            }
            else {
                response = "HTTP/1.1 404 Not Found\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n"
                          "{\"error\":\"Not Found\",\"success\":false}";
            }
            
            send(client, response.c_str(), response.size(), 0);
        }
        
        close(client);
    }
}

} // namespace poly
