#include "trading_engine.hpp"
#include "database.hpp"
#include "api_server.hpp"
#include "polymarket_client.hpp"
#include <iostream>
#include <csignal>
#include <memory>
#include <thread>
#include <atomic>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <curl/curl.h>
#include <nlohmann/json.hpp>

namespace poly {
    void add_log(const std::string& level, const std::string& name, const std::string& message);
    void set_live_prices(double up_price, double down_price);
    void set_market_info(const std::string& slug, const std::string& question);
}

namespace {
    std::unique_ptr<poly::APIServer> g_server;
    std::atomic<bool> g_running{true};
    
    // Pre-initialized CURL handles for speed
    CURL* g_curl_up = nullptr;
    CURL* g_curl_down = nullptr;
    CURL* g_curl_market = nullptr;
    std::string g_up_token;
    std::string g_down_token;
    
    void signal_handler(int signal) {
        if (signal == SIGINT || signal == SIGTERM) {
            std::cout << "\n[SHUTDOWN] Signal received" << std::endl;
            g_running = false;
            if (g_server) g_server->stop();
        }
    }
    
    int64_t get_current_window_timestamp() {
        auto now = std::chrono::system_clock::now();
        auto now_sec = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
        return (now_sec / 900) * 900;
    }
    
    int get_seconds_into_window() {
        auto now = std::chrono::system_clock::now();
        auto now_sec = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
        return now_sec % 900;
    }
    
    std::string generate_market_slug(int64_t timestamp) {
        return "btc-updown-15m-" + std::to_string(timestamp);
    }
    
    size_t write_cb(void* contents, size_t size, size_t nmemb, std::string* s) {
        s->append((char*)contents, size * nmemb);
        return size * nmemb;
    }
    
    void init_curl_handles() {
        auto init_handle = [](CURL*& handle) {
            handle = curl_easy_init();
            if (handle) {
                curl_easy_setopt(handle, CURLOPT_WRITEFUNCTION, write_cb);
                curl_easy_setopt(handle, CURLOPT_TIMEOUT_MS, 300L);  // 300ms timeout
                curl_easy_setopt(handle, CURLOPT_CONNECTTIMEOUT_MS, 200L);
                curl_easy_setopt(handle, CURLOPT_TCP_KEEPALIVE, 1L);
                curl_easy_setopt(handle, CURLOPT_TCP_NODELAY, 1L);  // Disable Nagle
                curl_easy_setopt(handle, CURLOPT_USERAGENT, "PolyTrader/1.0");
                curl_easy_setopt(handle, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_2_0);  // HTTP/2
            }
        };
        init_handle(g_curl_up);
        init_handle(g_curl_down);
        init_handle(g_curl_market);
    }
    
    // Parallel CLOB price fetch - fastest possible
    std::pair<double, double> fetch_clob_prices_parallel() {
        if (!g_curl_up || !g_curl_down || g_up_token.empty() || g_down_token.empty()) {
            return {0.0, 0.0};
        }
        
        std::string up_url = "https://clob.polymarket.com/price?token_id=" + g_up_token + "&side=buy";
        std::string down_url = "https://clob.polymarket.com/price?token_id=" + g_down_token + "&side=buy";
        
        std::string up_response, down_response;
        
        curl_easy_setopt(g_curl_up, CURLOPT_URL, up_url.c_str());
        curl_easy_setopt(g_curl_up, CURLOPT_WRITEDATA, &up_response);
        
        curl_easy_setopt(g_curl_down, CURLOPT_URL, down_url.c_str());
        curl_easy_setopt(g_curl_down, CURLOPT_WRITEDATA, &down_response);
        
        // Use multi handle for truly parallel requests
        CURLM* multi = curl_multi_init();
        curl_multi_add_handle(multi, g_curl_up);
        curl_multi_add_handle(multi, g_curl_down);
        
        int still_running = 1;
        while (still_running) {
            CURLMcode mc = curl_multi_perform(multi, &still_running);
            if (mc != CURLM_OK) break;
            if (still_running) {
                curl_multi_poll(multi, nullptr, 0, 50, nullptr);
            }
        }
        
        curl_multi_remove_handle(multi, g_curl_up);
        curl_multi_remove_handle(multi, g_curl_down);
        curl_multi_cleanup(multi);
        
        double up_price = 0.0, down_price = 0.0;
        
        try {
            if (!up_response.empty()) {
                auto j = nlohmann::json::parse(up_response);
                std::string p = j.value("price", "0");
                up_price = std::stod(p);
            }
        } catch (...) {}
        
        try {
            if (!down_response.empty()) {
                auto j = nlohmann::json::parse(down_response);
                std::string p = j.value("price", "0");
                down_price = std::stod(p);
            }
        } catch (...) {}
        
        return {up_price, down_price};
    }
    
    // Fetch market info and token IDs
    bool fetch_market_tokens(const std::string& slug, std::string& question) {
        if (!g_curl_market) return false;
        
        std::string url = "https://gamma-api.polymarket.com/markets/slug/" + slug;
        std::string response;
        
        curl_easy_setopt(g_curl_market, CURLOPT_URL, url.c_str());
        curl_easy_setopt(g_curl_market, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(g_curl_market, CURLOPT_TIMEOUT_MS, 2000L);
        
        if (curl_easy_perform(g_curl_market) != CURLE_OK) return false;
        
        try {
            auto j = nlohmann::json::parse(response);
            question = j.value("question", "");
            
            std::string tokens_str = j.value("clobTokenIds", "");
            if (!tokens_str.empty()) {
                auto tokens = nlohmann::json::parse(tokens_str);
                if (tokens.is_array() && tokens.size() >= 2) {
                    g_up_token = tokens[0].get<std::string>();
                    g_down_token = tokens[1].get<std::string>();
                    return true;
                }
            }
        } catch (...) {}
        
        return false;
    }
}

int main() {
    std::cout << R"(
╔═══════════════════════════════════════════════════════════════╗
║   POLY TRADER C++ - CLOB PARALLEL (50ms LATENCY)              ║
╚═══════════════════════════════════════════════════════════════╝
)" << std::endl;

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
    
    curl_global_init(CURL_GLOBAL_ALL);
    init_curl_handles();
    
    try {
        poly::Config config;
        config.entry_threshold = 0.36;
        config.move = 0.36;
        config.shares = 10;
        config.sum_target = 0.99;
        config.dca_enabled = true;
        config.breakeven_enabled = true;
        
        std::cout << "[CONFIG] Entry Threshold: $" << config.entry_threshold << std::endl;
        std::cout << "[CONFIG] Poll Interval: 50ms (parallel CLOB)" << std::endl;
        
        const char* db_url_env = std::getenv("DATABASE_URL");
        std::string db_url = db_url_env ? db_url_env :
            "postgresql://polytrader:polytrader@localhost:5432/polytrader";
        
        poly::Database db(db_url);
        if (db.connect()) {
            std::cout << "[DB] Connected" << std::endl;
        }
        
        poly::TradingEngine engine(config);
        engine.start();
        std::cout << "[ENGINE] Started" << std::endl;
        
        g_server = std::make_unique<poly::APIServer>(engine, db, 3001);
        g_server->start();
        
        std::cout << "\n✓ API: http://localhost:3001\n✓ Dashboard: http://localhost:3000\n\n[RUNNING] CLOB parallel mode - Ctrl+C to stop\n" << std::endl;
        
        std::string current_slug;
        int64_t current_window_ts = 0;
        int log_counter = 0;
        
        while (g_running) {
            // 50ms polling for near real-time
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            log_counter++;
            
            int64_t window_ts = get_current_window_timestamp();
            
            // Check for new market window
            if (window_ts != current_window_ts) {
                current_window_ts = window_ts;
                current_slug = generate_market_slug(window_ts);
                
                poly::add_log("info", "MARKET", "Switching to: " + current_slug);
                std::cout << "[MARKET] Switching to: " << current_slug << std::endl;
                
                std::string question;
                if (fetch_market_tokens(current_slug, question)) {
                    engine.set_market(current_slug, g_up_token, g_down_token);
                    poly::set_market_info(current_slug, question);
                    poly::add_log("info", "MARKET", "Loaded: " + question);
                    std::cout << "[MARKET] Loaded: " << question << std::endl;
                    std::cout << "[TOKENS] UP: " << g_up_token.substr(0,20) << "..." << std::endl;
                    std::cout << "[TOKENS] DOWN: " << g_down_token.substr(0,20) << "..." << std::endl;
                } else {
                    poly::add_log("error", "MARKET", "Failed to load market");
                }
            }
            
            // Fetch prices every 50ms (20x per second)
            if (!g_up_token.empty() && !g_down_token.empty()) {
                auto [up_price, down_price] = fetch_clob_prices_parallel();
                
                if (up_price > 0 || down_price > 0) {
                    poly::set_live_prices(up_price, down_price);
                    
                    // Log every second
                    if (log_counter >= 20) {
                        log_counter = 0;
                        int secs_into_window = get_seconds_into_window();
                        int time_left = 900 - secs_into_window;
                        bool in_trading = secs_into_window <= 120;
                        
                        std::ostringstream oss;
                        oss << std::fixed << std::setprecision(2);
                        oss << "UP: $" << up_price << " | DOWN: $" << down_price;
                        oss << " | " << (in_trading ? "🔥 TRADING" : "👁️ WATCHING");
                        oss << " | " << time_left << "s";
                        poly::add_log("info", "CLOB", oss.str());
                        
                        if (in_trading) {
                            if (up_price <= config.entry_threshold) {
                                poly::add_log("warn", "SIGNAL", "UP @ $" + 
                                    std::to_string(up_price).substr(0,4) + " - ENTRY!");
                            }
                            if (down_price <= config.entry_threshold) {
                                poly::add_log("warn", "SIGNAL", "DOWN @ $" + 
                                    std::to_string(down_price).substr(0,4) + " - ENTRY!");
                            }
                        }
                    }
                }
            }
        }
        
        if (g_curl_up) curl_easy_cleanup(g_curl_up);
        if (g_curl_down) curl_easy_cleanup(g_curl_down);
        if (g_curl_market) curl_easy_cleanup(g_curl_market);
        curl_global_cleanup();
        
        std::cout << "[SHUTDOWN] Clean exit" << std::endl;
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "[FATAL] " << e.what() << std::endl;
        return 1;
    }
}
