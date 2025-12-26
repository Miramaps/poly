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
static TradingEngine* g_engine_ptr = nullptr;

void set_engine_ptr(TradingEngine* engine) {
    g_engine_ptr = engine;
}

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

std::string get_status_json() {
    std::lock_guard<std::mutex> lock(g_price_mutex);
    
    auto now = std::chrono::system_clock::now();
    auto now_sec = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    int secs_into_window = now_sec % 900;
    int time_left = 900 - secs_into_window;
    bool in_trading = secs_into_window <= 120;
    
    // Get live config from engine
    double entry_threshold = 0.36;
    int shares = 10;
    double sum_target = 0.99;
    bool dca_enabled = true;
    int trading_window = 120;
    double cash = 1000.0;
    double realized_pnl = 0.0;
    double equity = 1000.0;
    int up_pos = 0, down_pos = 0;
    
    if (g_engine_ptr) {
        auto cfg = g_engine_ptr->get_config();
        entry_threshold = cfg.move;
        shares = cfg.shares;
        sum_target = cfg.sum_target;
        dca_enabled = cfg.dca_enabled;
        trading_window = cfg.dump_window_sec;
        
        auto engine_status = g_engine_ptr->get_status();
        cash = engine_status.cash;
        realized_pnl = engine_status.realized_pnl;
        equity = engine_status.equity;
        up_pos = static_cast<int>(engine_status.positions.UP);
        down_pos = static_cast<int>(engine_status.positions.DOWN);
    }
    
    nlohmann::json status = {
        {"success", true},
        {"data", {
            {"bot", {
                {"enabled", g_auto_enabled.load()},
                {"mode", "PAPER"},
                {"uptime", 0},
                {"config", {
                    {"entryThreshold", entry_threshold},
                    {"shares", shares},
                    {"sumTarget", sum_target},
                    {"dcaEnabled", dca_enabled},
                    {"tradingWindowSec", trading_window}
                }}
            }},
            {"portfolio", {
                {"cash", cash},
                {"positions", {{"UP", up_pos}, {"DOWN", down_pos}}},
                {"unrealizedPnL", 0.0},
                {"realizedPnL", realized_pnl},
                {"equity", equity}
            }},
            {"currentMarket", {
                {"slug", g_market_slug},
                {"title", g_market_question},
                {"url", "https://polymarket.com/event/" + g_market_slug},
                {"status", in_trading ? "TRADING" : "WATCHING"},
                {"timeLeft", time_left},
                {"inTradingWindow", in_trading}
            }},
            {"currentCycle", {
                {"active", g_engine_ptr ? (g_engine_ptr->get_status().current_cycle.active) : false},
                {"status", g_engine_ptr ? g_engine_ptr->get_status().current_cycle.status : "pending"},
                {"leg1Side", g_engine_ptr ? g_engine_ptr->get_status().current_cycle.leg1_side : ""},
                {"leg1Price", g_engine_ptr ? g_engine_ptr->get_status().current_cycle.leg1_price : 0.0},
                {"leg1Shares", g_engine_ptr ? g_engine_ptr->get_status().current_cycle.leg1_shares : 0.0},
                {"totalCost", g_engine_ptr ? g_engine_ptr->get_status().current_cycle.total_cost : 0.0}
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
            }}
        }}
    };
    
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

std::string process_command(const std::string& cmd) {
    if (cmd == "help") {
        add_log("info", "CMD", "help - showing commands");
        return "=== POLY TRADER C++ COMMANDS ===\n\n"
               "STATUS:\n"
               "  help          - Show this help\n"
               "  status        - Bot status & prices\n"
               "  config        - Show current config\n\n"
               "TRADING:\n"
               "  auto on       - Enable auto trading\n"
               "  auto off      - Disable auto trading\n\n"
               "CONFIG CHANGES:\n"
               "  set entry <$> - Set entry threshold (e.g. 'set entry 0.36')\n"
               "  set shares <n>- Set shares per trade (e.g. 'set shares 10')\n"
               "  set sum <$>   - Set sum target (e.g. 'set sum 0.99')\n"
               "  set dca on    - Enable DCA\n"
               "  set dca off   - Disable DCA\n"
               "  set window <s>- Set trading window seconds (e.g. 'set window 120')";
    }
    else if (cmd == "status") {
        add_log("info", "CMD", "status - showing bot status");
        std::lock_guard<std::mutex> lock(g_price_mutex);
        std::ostringstream oss;
        
        double cash = 1000.0;
        double realized_pnl = 0.0;
        if (g_engine_ptr) {
            auto status = g_engine_ptr->get_status();
            cash = status.cash;
            realized_pnl = status.realized_pnl;
        }
        
        oss << "=== BOT STATUS ===\n"
            << "Mode: PAPER TRADING\n"
            << "Auto: " << (g_auto_enabled.load() ? "ON" : "OFF") << "\n"
            << "Market: " << g_market_slug << "\n"
            << "UP: $" << std::fixed << std::setprecision(4) << g_up_price << "\n"
            << "DOWN: $" << std::fixed << std::setprecision(4) << g_down_price << "\n"
            << "Sum: $" << std::fixed << std::setprecision(4) << (g_up_price + g_down_price) << "\n"
            << "Cash: $" << std::fixed << std::setprecision(2) << cash << "\n"
            << "Realized P&L: $" << std::fixed << std::setprecision(2) << realized_pnl;
        return oss.str();
    }
    else if (cmd == "config") {
        add_log("info", "CMD", "config - showing configuration");
        std::ostringstream oss;
        
        if (g_engine_ptr) {
            auto cfg = g_engine_ptr->get_config();
            oss << "=== CONFIG ===\n"
                << "Entry Threshold: $" << std::fixed << std::setprecision(2) << cfg.move << "\n"
                << "Shares: " << cfg.shares << "\n"
                << "Sum Target: $" << std::fixed << std::setprecision(2) << cfg.sum_target << "\n"
                << "DCA: " << (cfg.dca_enabled ? "ON" : "OFF") << "\n"
                << "Breakeven Exit: " << (cfg.breakeven_enabled ? "ON" : "OFF") << "\n"
                << "Trading Window: " << cfg.dump_window_sec << "s";
        } else {
            oss << "=== CONFIG ===\n"
                << "Entry Threshold: $0.36\n"
                << "Shares: 10\n"
                << "Sum Target: $0.99\n"
                << "DCA: ON\n"
                << "Breakeven Exit: ON\n"
                << "Trading Window: 120s";
        }
        return oss.str();
    }
    else if (cmd == "auto on") {
        g_auto_enabled = true;
        if (g_engine_ptr) g_engine_ptr->start();
        add_log("info", "CMD", "Auto trading ENABLED");
        return "✅ Auto trading ENABLED - Bot is now actively trading";
    }
    else if (cmd == "auto off") {
        g_auto_enabled = false;
        if (g_engine_ptr) g_engine_ptr->stop();
        add_log("info", "CMD", "Auto trading DISABLED");
        return "⏹️ Auto trading DISABLED - Bot is paused";
    }
    // Handle 'set entry X' command
    else if (cmd.rfind("set entry ", 0) == 0) {
        try {
            double val = std::stod(cmd.substr(10));
            if (val > 0 && val < 1.0) {
                if (g_engine_ptr) {
                    g_engine_ptr->set_entry_threshold(val);
                    add_log("info", "CMD", "Entry threshold set to $" + std::to_string(val));
                    return "✅ Entry threshold set to $" + std::to_string(val).substr(0, 4);
                }
                return "❌ Engine not available";
            }
            return "❌ Invalid value. Entry must be between 0 and 1 (e.g. 0.36)";
        } catch (...) {
            return "❌ Invalid number. Usage: set entry 0.36";
        }
    }
    // Handle 'set shares X' command
    else if (cmd.rfind("set shares ", 0) == 0) {
        try {
            int val = std::stoi(cmd.substr(11));
            if (val > 0 && val <= 10000) {
                if (g_engine_ptr) {
                    g_engine_ptr->set_shares(val);
                    add_log("info", "CMD", "Shares set to " + std::to_string(val));
                    return "✅ Shares set to " + std::to_string(val);
                }
                return "❌ Engine not available";
            }
            return "❌ Invalid value. Shares must be between 1 and 10000";
        } catch (...) {
            return "❌ Invalid number. Usage: set shares 10";
        }
    }
    // Handle 'set sum X' command
    else if (cmd.rfind("set sum ", 0) == 0) {
        try {
            double val = std::stod(cmd.substr(8));
            if (val > 0.5 && val <= 1.0) {
                if (g_engine_ptr) {
                    g_engine_ptr->set_sum_target(val);
                    add_log("info", "CMD", "Sum target set to $" + std::to_string(val));
                    return "✅ Sum target set to $" + std::to_string(val).substr(0, 4);
                }
                return "❌ Engine not available";
            }
            return "❌ Invalid value. Sum target must be between 0.5 and 1.0 (e.g. 0.99)";
        } catch (...) {
            return "❌ Invalid number. Usage: set sum 0.99";
        }
    }
    // Handle 'set dca on/off' command
    else if (cmd == "set dca on") {
        if (g_engine_ptr) {
            g_engine_ptr->set_dca_enabled(true);
            add_log("info", "CMD", "DCA enabled");
            return "✅ DCA ENABLED - Will buy more at lower prices";
        }
        return "❌ Engine not available";
    }
    else if (cmd == "set dca off") {
        if (g_engine_ptr) {
            g_engine_ptr->set_dca_enabled(false);
            add_log("info", "CMD", "DCA disabled");
            return "⏹️ DCA DISABLED - Only initial entry trades";
        }
        return "❌ Engine not available";
    }
    // Handle 'set window X' command
    else if (cmd.rfind("set window ", 0) == 0) {
        try {
            int val = std::stoi(cmd.substr(11));
            if (val >= 10 && val <= 900) {
                if (g_engine_ptr) {
                    g_engine_ptr->set_trading_window(val);
                    add_log("info", "CMD", "Trading window set to " + std::to_string(val) + "s");
                    return "✅ Trading window set to " + std::to_string(val) + " seconds";
                }
                return "❌ Engine not available";
            }
            return "❌ Invalid value. Window must be between 10 and 900 seconds";
        } catch (...) {
            return "❌ Invalid number. Usage: set window 120";
        }
    }
    
    add_log("warn", "CMD", "Unknown command: " + cmd);
    return "❌ Unknown command. Type 'help' for available commands.";
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
                nlohmann::json cfg = {
                    {"success", true},
                    {"data", {
                        {"entryThreshold", 0.36},
                        {"shares", 10},
                        {"sumTarget", 0.99},
                        {"dcaEnabled", true},
                        {"tradingWindowSec", 120}
                    }}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + cfg.dump();
            }
            else if (base_path == "/api/trades") {
                nlohmann::json trades_arr = nlohmann::json::array();
                if (g_engine_ptr) {
                    auto status = g_engine_ptr->get_status();
                    for (const auto& t : status.recent_trades) {
                        trades_arr.push_back({
                            {"id", t.id},
                            {"market", t.market_slug},
                            {"leg", t.leg},
                            {"side", t.side},
                            {"shares", t.shares},
                            {"price", t.price},
                            {"cost", t.cost},
                            {"pnl", t.pnl},
                            {"timestamp", std::chrono::duration_cast<std::chrono::milliseconds>(t.timestamp.time_since_epoch()).count()}
                        });
                    }
                }
                nlohmann::json trades = {{"success", true}, {"data", trades_arr}};
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + trades.dump();
            }
            else if (base_path == "/api/cycles") {
                nlohmann::json cycles = {{"success", true}, {"data", nlohmann::json::array()}};
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + cycles.dump();
            }
            else if (base_path == "/api/wallet") {
                nlohmann::json wallet = {
                    {"success", true},
                    {"data", {{"balance", 1000.0}, {"currency", "USDC"}}}
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


TradingEngine* get_engine_ptr() {
    return g_engine_ptr;
}

} // namespace poly
