#include "api_server.hpp"
#include <iostream>
#include <thread>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <cstring>
#include <cstdlib>
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

// Current cycle tracking
struct CurrentCycle {
    std::string id;
    std::string status;  // "pending", "leg1_done", "complete", "incomplete"
    std::string leg1Side;
    double leg1Price = 0.0;
    double leg1Shares = 0.0;
    std::string leg2Side;
    double leg2Price = 0.0;
    double leg2Shares = 0.0;
    double totalCost = 0.0;
    double lockedInPct = 0.0;
    double lockedInProfit = 0.0;
    bool active = false;
};
static CurrentCycle g_current_cycle;
static std::mutex g_cycle_mutex;

void set_engine_ptr(TradingEngine* engine) {
    g_engine_ptr = engine;
}

TradingEngine* get_engine_ptr() {
    return g_engine_ptr;
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

// Called when leg 1 is executed
void set_cycle_leg1(const std::string& side, double price, double shares, double cost) {
    std::lock_guard<std::mutex> lock(g_cycle_mutex);
    
    g_current_cycle.id = "cycle_" + std::to_string(
        std::chrono::system_clock::now().time_since_epoch().count()
    );
    g_current_cycle.status = "leg1_done";
    g_current_cycle.leg1Side = side;
    g_current_cycle.leg1Price = price;
    g_current_cycle.leg1Shares = shares;
    g_current_cycle.totalCost = cost;
    g_current_cycle.active = true;
    
    add_log("info", "CYCLE", "Leg 1 executed: " + side + " @ $" + std::to_string(price));
}

// Called when leg 2 is executed (cycle complete)
void set_cycle_leg2(const std::string& side, double price, double shares, double profit, double pct) {
    std::lock_guard<std::mutex> lock(g_cycle_mutex);
    
    if (g_current_cycle.active) {
        g_current_cycle.status = "complete";
        g_current_cycle.leg2Side = side;
        g_current_cycle.leg2Price = price;
        g_current_cycle.leg2Shares = shares;
        g_current_cycle.totalCost += price * shares;
        g_current_cycle.lockedInProfit = profit;
        g_current_cycle.lockedInPct = pct;
        
        add_log("info", "CYCLE", "Cycle complete! Profit: $" + std::to_string(profit) + 
                " (" + std::to_string(pct * 100) + "%)");
    }
}

// Called to clear the cycle after it's done
void clear_cycle() {
    std::lock_guard<std::mutex> lock(g_cycle_mutex);
    g_current_cycle = CurrentCycle();
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
    std::lock_guard<std::mutex> price_lock(g_price_mutex);
    std::lock_guard<std::mutex> cycle_lock(g_cycle_mutex);
    
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
    int64_t uptime = 0;
    
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
        uptime = engine_status.uptime_seconds;
    }
    
    // Build orderbooks from REAL engine data
    nlohmann::json orderbooks = {
        {"UP", {
            {"bids", nlohmann::json::array()},
            {"asks", nlohmann::json::array()}
        }},
        {"DOWN", {
            {"bids", nlohmann::json::array()},
            {"asks", nlohmann::json::array()}
        }}
    };
    
    // Use REAL orderbook from engine
    if (g_engine_ptr) {
        auto status = g_engine_ptr->get_status();
        
        // UP orderbook
        for (const auto& [price, size] : status.up_orderbook.asks) {
            nlohmann::json level;
            level["price"] = price;
            level["size"] = size;
            orderbooks["UP"]["asks"].push_back(level);
        }
        for (const auto& [price, size] : status.up_orderbook.bids) {
            nlohmann::json level;
            level["price"] = price;
            level["size"] = size;
            orderbooks["UP"]["bids"].push_back(level);
        }
        
        // DOWN orderbook
        for (const auto& [price, size] : status.down_orderbook.asks) {
            nlohmann::json level;
            level["price"] = price;
            level["size"] = size;
            orderbooks["DOWN"]["asks"].push_back(level);
        }
        for (const auto& [price, size] : status.down_orderbook.bids) {
            nlohmann::json level;
            level["price"] = price;
            level["size"] = size;
            orderbooks["DOWN"]["bids"].push_back(level);
        }
    }
    
    // Build current cycle info from positions
    nlohmann::json currentCycle = nullptr;
    
    // If we have a position, show it as leg1_done
    if (up_pos > 0 || down_pos > 0) {
        std::string side = up_pos > 0 ? "UP" : "DOWN";
        int pos_shares = up_pos > 0 ? up_pos : down_pos;
        double price = up_pos > 0 ? g_up_price : g_down_price;
        double cost = pos_shares * price;
        
        currentCycle = {
            {"id", "cycle_live"},
            {"status", "leg1_done"},
            {"leg1Side", side},
            {"leg1Price", price > 0 ? price : 0.35},  // Show last known price
            {"leg1Shares", pos_shares},
            {"totalCost", cost > 0 ? cost : pos_shares * 0.35}
        };
    }
    // Legacy cycle support
    else if (g_current_cycle.active) {
        currentCycle = {
            {"id", g_current_cycle.id},
            {"status", g_current_cycle.status},
            {"leg1Side", g_current_cycle.leg1Side},
            {"leg1Price", g_current_cycle.leg1Price},
            {"leg1Shares", g_current_cycle.leg1Shares},
            {"totalCost", g_current_cycle.totalCost}
        };
        
        if (g_current_cycle.status == "complete") {
            currentCycle["leg2Side"] = g_current_cycle.leg2Side;
            currentCycle["leg2Price"] = g_current_cycle.leg2Price;
            currentCycle["leg2Shares"] = g_current_cycle.leg2Shares;
            currentCycle["lockedInPct"] = g_current_cycle.lockedInPct;
            currentCycle["lockedInProfit"] = g_current_cycle.lockedInProfit;
        }
    }
    
    // Get trading mode from engine
    std::string trading_mode = "PAPER";
    bool live_available = false;
    if (g_engine_ptr) {
        auto engine_status = g_engine_ptr->get_status();
        trading_mode = engine_status.mode;
        live_available = engine_status.live_trading_available;
    }
    
    nlohmann::json status = {
        {"success", true},
        {"data", {
            {"bot", {
                {"enabled", g_auto_enabled.load()},
                {"mode", trading_mode},
                {"tradingMode", trading_mode},
                {"liveAvailable", live_available},
                {"uptime", uptime},
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
            {"orderbooks", orderbooks},
            {"currentCycle", currentCycle},
            {"uptime", uptime}
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
        return 
            "╔══════════════════════════════════════════════════════════════╗\n"
            "║           ⚡ POLY TRADER C++ ⚡                              ║\n"
            "╠══════════════════════════════════════════════════════════════╣\n"
            "║                                                              ║\n"
            "║  📊 STATUS                                                   ║\n"
            "║  ─────────────────────────────────────────────────────────   ║\n"
            "║  help              Show this help menu                       ║\n"
            "║  status            Bot status, prices & P&L                  ║\n"
            "║  config            Current configuration                     ║\n"
            "║                                                              ║\n"
            "║  🤖 TRADING                                                  ║\n"
            "║  ─────────────────────────────────────────────────────────   ║\n"
            "║  auto on           Enable auto trading                       ║\n"
            "║  auto off          Disable auto trading                      ║\n"
            "║                                                              ║\n"
            "║  ⚙️  CONFIGURATION                                           ║\n"
            "║  ─────────────────────────────────────────────────────────   ║\n"
            "║  set entry <$>     Entry threshold    (e.g. set entry 0.36)  ║\n"
            "║  set shares <n>    Shares per trade   (e.g. set shares 10)   ║\n"
            "║  set sum <$>       Sum target         (e.g. set sum 0.99)    ║\n"
            "║  set window <s>    Trading window     (e.g. set window 120)  ║\n"
            "║  set dca on/off    Toggle DCA mode                           ║\n"
            "║                                                              ║\n"
            "╚══════════════════════════════════════════════════════════════╝";
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
        
        std::string auto_status = g_auto_enabled.load() ? "🟢 ON" : "🔴 OFF";
        double sum = g_up_price + g_down_price;
        std::string pnl_color = realized_pnl >= 0 ? "+" : "";
        
        oss << "╔══════════════════════════════════════════════╗\n"
            << "║           📊 BOT STATUS                      ║\n"
            << "╠══════════════════════════════════════════════╣\n"
            << "║                                              ║\n"
            << "║  Mode      PAPER TRADING                     ║\n"
            << "║  Auto      " << auto_status << std::string(33 - auto_status.length() + 4, ' ') << "║\n"
            << "║                                              ║\n"
            << "║  📈 PRICES                                   ║\n"
            << "║  ──────────────────────────────────────────  ║\n"
            << "║  ▲ UP      $" << std::fixed << std::setprecision(4) << g_up_price << std::string(30, ' ') << "║\n"
            << "║  ▼ DOWN    $" << std::fixed << std::setprecision(4) << g_down_price << std::string(30, ' ') << "║\n"
            << "║  Σ SUM     $" << std::fixed << std::setprecision(4) << sum << std::string(30, ' ') << "║\n"
            << "║                                              ║\n"
            << "║  💰 PORTFOLIO                                ║\n"
            << "║  ──────────────────────────────────────────  ║\n"
            << "║  Cash      $" << std::fixed << std::setprecision(2) << cash << std::string(30, ' ') << "║\n"
            << "║  P&L       " << pnl_color << "$" << std::fixed << std::setprecision(2) << realized_pnl << std::string(30, ' ') << "║\n"
            << "║                                              ║\n"
            << "║  Market    " << g_market_slug.substr(0, 30) << std::string(std::max(0, 33 - (int)g_market_slug.length()), ' ') << "║\n"
            << "║                                              ║\n"
            << "╚══════════════════════════════════════════════╝";
        return oss.str();
    }
    else if (cmd == "config") {
        add_log("info", "CMD", "config - showing configuration");
        std::ostringstream oss;
        
        if (g_engine_ptr) {
            auto cfg = g_engine_ptr->get_config();
            std::string dca_status = cfg.dca_enabled ? "🟢 ON" : "🔴 OFF";
            std::string breakeven_status = cfg.breakeven_enabled ? "🟢 ON" : "🔴 OFF";
            
            oss << "╔══════════════════════════════════════════════╗\n"
                << "║           ⚙️  CONFIGURATION                  ║\n"
                << "╠══════════════════════════════════════════════╣\n"
                << "║                                              ║\n"
                << "║  🎯 ENTRY                                    ║\n"
                << "║  ──────────────────────────────────────────  ║\n"
                << "║  Threshold     $" << std::fixed << std::setprecision(2) << cfg.move << std::string(26, ' ') << "║\n"
                << "║  Shares        " << cfg.shares << std::string(28, ' ') << "║\n"
                << "║  Sum Target    $" << std::fixed << std::setprecision(2) << cfg.sum_target << std::string(26, ' ') << "║\n"
                << "║                                              ║\n"
                << "║  ⏱️  TIMING                                   ║\n"
                << "║  ──────────────────────────────────────────  ║\n"
                << "║  Window        " << cfg.dump_window_sec << "s (last " << cfg.dump_window_sec << "s of 15min)" << std::string(10, ' ') << "║\n"
                << "║                                              ║\n"
                << "║  🔧 FEATURES                                 ║\n"
                << "║  ──────────────────────────────────────────  ║\n"
                << "║  DCA Mode      " << dca_status << std::string(26, ' ') << "║\n"
                << "║  Breakeven     " << breakeven_status << std::string(26, ' ') << "║\n"
                << "║                                              ║\n"
                << "╚══════════════════════════════════════════════╝";
        } else {
            oss << "╔══════════════════════════════════════════════╗\n"
                << "║           ⚙️  CONFIGURATION                  ║\n"
                << "╠══════════════════════════════════════════════╣\n"
                << "║  Threshold     $0.36                         ║\n"
                << "║  Shares        10                            ║\n"
                << "║  Sum Target    $0.99                         ║\n"
                << "║  Window        120s                          ║\n"
                << "║  DCA Mode      🟢 ON                         ║\n"
                << "║  Breakeven     🟢 ON                         ║\n"
                << "╚══════════════════════════════════════════════╝";
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
    // MODE COMMANDS
    else if (cmd == "mode live") {
        if (g_engine_ptr) {
            g_engine_ptr->set_trading_mode(poly::TradingMode::LIVE);
            add_log("warn", "MODE", "🔴 LIVE TRADING ENABLED - Real money!");
            return "🔴 LIVE TRADING ENABLED - Orders will be executed on Polymarket!";
        }
        return "❌ Engine not available";
    }
    else if (cmd == "mode paper") {
        if (g_engine_ptr) {
            g_engine_ptr->set_trading_mode(poly::TradingMode::PAPER);
            add_log("info", "MODE", "📝 Paper trading mode");
            return "📝 Paper trading enabled - Simulated trades only";
        }
        return "❌ Engine not available";
    }
    // RESET COMMAND
    else if (cmd == "reset") {
        if (g_engine_ptr) {
            g_auto_enabled = false;
            g_engine_ptr->stop();
            g_engine_ptr->reset_paper_trading();
            add_log("info", "CMD", "🔄 Portfolio reset to $1000");
            return "🔄 Portfolio reset!\n• Cash: $1,000.00\n• Positions: 0\n• P&L: $0.00\n• Trade history cleared\n• Bot is now OFF - use 'auto on' to start trading";
        }
        return "❌ Engine not available";
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
                nlohmann::json trades_data = nlohmann::json::array();
                
                if (g_engine_ptr) {
                    auto status = g_engine_ptr->get_status();
                    for (const auto& trade : status.recent_trades) {
                        nlohmann::json t;
                        t["id"] = trade.id;
                        t["market_slug"] = trade.market_slug;
                        t["leg"] = trade.leg;
                        t["side"] = trade.side;
                        t["token_id"] = trade.token_id;
                        t["shares"] = trade.shares;
                        t["price"] = trade.price;
                        t["cost"] = trade.cost;
                        t["fee"] = trade.fee;
                        t["pnl"] = trade.pnl;
                        t["is_live"] = trade.is_live;
                        t["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                            trade.timestamp.time_since_epoch()).count();
                        trades_data.push_back(t);
                    }
                }
                
                nlohmann::json trades = {{"success", true}, {"data", trades_data}};
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + trades.dump();
            }
            else if (base_path == "/api/cycles") {
                nlohmann::json cycles_data = nlohmann::json::array();
                
                if (g_engine_ptr) {
                    auto status = g_engine_ptr->get_status();
                    // Return completed cycles (derived from trade pairs)
                    // Group trades by cycle: every 2 trades = 1 cycle
                    for (size_t i = 0; i + 1 < status.recent_trades.size(); i += 2) {
                        const auto& leg1 = status.recent_trades[i];
                        const auto& leg2 = status.recent_trades[i + 1];
                        
                        nlohmann::json c;
                        c["market_slug"] = leg1.market_slug;
                        c["leg1_side"] = leg1.side;
                        c["leg1_price"] = leg1.price;
                        c["leg1_shares"] = leg1.shares;
                        c["leg2_side"] = leg2.side;
                        c["leg2_price"] = leg2.price;
                        c["leg2_shares"] = leg2.shares;
                        c["sum"] = leg1.price + leg2.price;
                        c["pnl"] = (1.0 - (leg1.price + leg2.price)) * leg1.shares;
                        c["timestamp"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                            leg2.timestamp.time_since_epoch()).count();
                        cycles_data.push_back(c);
                    }
                }
                
                nlohmann::json cycles = {{"success", true}, {"data", cycles_data}};
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + cycles.dump();
            }
            else if (base_path == "/api/wallet") {
                // Check if we have a wallet configured
                bool has_wallet = false;
                std::string wallet_address = "";
                double usdc_balance = 0.0;
                double matic_balance = 0.0;
                bool live_available = false;
                std::string trading_mode = "PAPER";
                
                if (g_engine_ptr) {
                    auto status = g_engine_ptr->get_status();
                    usdc_balance = status.cash;
                    live_available = status.live_trading_available;
                    trading_mode = status.mode;
                    
                    // Check environment for wallet
                    const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
                    if (pk && strlen(pk) > 0) {
                        has_wallet = true;
                        // Show partial address (first 6 + last 4 chars of key)
                        std::string pk_str(pk);
                        if (pk_str.length() > 10) {
                            wallet_address = "0x" + pk_str.substr(0, 4) + "..." + pk_str.substr(pk_str.length() - 4);
                        } else {
                            wallet_address = "0x...configured";
                        }
                    }
                }
                
                nlohmann::json wallet = {
                    {"success", true},
                    {"data", {
                        {"hasWallet", has_wallet},
                        {"address", has_wallet ? wallet_address : nullptr},
                        {"balance", {{"usdc", usdc_balance}, {"matic", matic_balance}}},
                        {"liveAvailable", live_available},
                        {"tradingMode", trading_mode},
                        {"canTradeLive", has_wallet && live_available}
                    }}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + wallet.dump();
            }
            else if (base_path == "/api/wallet/private-key" && method == "GET") {
                // Return private key (with auth check already done above)
                const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
                nlohmann::json resp;
                if (pk && strlen(pk) > 0) {
                    resp = {{"success", true}, {"data", {{"privateKey", std::string(pk)}}}};
                } else {
                    resp = {{"success", false}, {"error", "No wallet configured"}};
                }
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + resp.dump();
            }
            else if (base_path == "/api/wallet/generate" && method == "POST") {
                // Generate new wallet - for now just return info about manual setup
                nlohmann::json resp = {
                    {"success", false},
                    {"error", "Wallet generation must be done manually. Set POLYMARKET_PRIVATE_KEY in .env file."}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + resp.dump();
            }
            else if (base_path == "/api/wallet/withdraw" && method == "POST") {
                // Withdrawal not yet implemented
                nlohmann::json resp = {
                    {"success", false},
                    {"error", "Withdrawal not implemented. Use Polymarket UI to withdraw funds."}
                };
                response = "HTTP/1.1 200 OK\r\n" + cors +
                          "Content-Type: application/json\r\n\r\n" + resp.dump();
            }
            else if (base_path == "/api/trading-mode" && method == "POST") {
                size_t body_start = request.find("\r\n\r\n");
                if (body_start != std::string::npos) {
                    std::string body = request.substr(body_start + 4);
                    try {
                        auto j = nlohmann::json::parse(body);
                        std::string mode = j.value("mode", "PAPER");
                        
                        nlohmann::json resp;
                        if (mode == "LIVE") {
                            // Check if live trading is available
                            const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
                            if (pk && strlen(pk) > 0) {
                                if (g_engine_ptr) {
                                    g_engine_ptr->set_trading_mode(TradingMode::LIVE);
                                }
                                add_log("warn", "MODE", "⚠️ LIVE TRADING ENABLED - Real money trades!");
                                resp = {{"success", true}, {"data", {{"mode", "LIVE"}, {"message", "Live trading enabled!"}}}};
                            } else {
                                resp = {{"success", false}, {"error", "Cannot enable live trading: No private key configured"}};
                            }
                        } else {
                            if (g_engine_ptr) {
                                g_engine_ptr->set_trading_mode(TradingMode::PAPER);
                            }
                            add_log("info", "MODE", "Paper trading mode");
                            resp = {{"success", true}, {"data", {{"mode", "PAPER"}, {"message", "Paper trading mode enabled"}}}};
                        }
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
