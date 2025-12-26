#include "trading_engine.hpp"
#include "async_writer.hpp"
#include "database.hpp"
#include "database.hpp"
#include "api_server.hpp"
#include "polymarket_client.hpp"
#include "websocket_client.hpp"
#include "ws_server.hpp"
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

// Use functions from api_server.hpp
using poly::add_log;
using poly::set_live_prices;
using poly::set_market_info;

// Global atomic variables for API server access (external linkage)
std::atomic<double> g_up_price{0.0};
std::atomic<double> g_down_price{0.0};


namespace {
    std::unique_ptr<poly::APIServer> g_server;
    std::unique_ptr<poly::WebSocketPriceStream> g_ws;
    std::atomic<bool> g_running{true};
    
    // Current tokens
    std::string g_up_token;
    std::string g_down_token;
    std::mutex g_price_mutex;
    
    // CURL handle for market info (only needed occasionally)
    CURL* g_curl_market = nullptr;
    
    void signal_handler(int signal) {
        if (signal == SIGINT || signal == SIGTERM) {
            std::cout << "\n[SHUTDOWN] Signal received" << std::endl;
            g_running = false;
            if (g_ws) g_ws->stop();
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
    
    // Fetch market info and token IDs (HTTP, only on market switch)
    bool fetch_market_tokens(const std::string& slug, std::string& question) {
        if (!g_curl_market) {
            g_curl_market = curl_easy_init();
            if (!g_curl_market) return false;
            curl_easy_setopt(g_curl_market, CURLOPT_WRITEFUNCTION, write_cb);
            curl_easy_setopt(g_curl_market, CURLOPT_TIMEOUT, 5L);
            curl_easy_setopt(g_curl_market, CURLOPT_USERAGENT, "PolyTrader/1.0");
        }
        
        std::string url = "https://gamma-api.polymarket.com/markets/slug/" + slug;
        std::string response;
        
        curl_easy_setopt(g_curl_market, CURLOPT_URL, url.c_str());
        curl_easy_setopt(g_curl_market, CURLOPT_WRITEDATA, &response);
        
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
    
    // WebSocket price callback - use regular doubles instead of atomic
    static int callback_count = 0;
    static double s_up_price = 0.0;
    static double s_down_price = 0.0;
    
    void on_price_update(const poly::PriceUpdate& update) {
        std::lock_guard<std::mutex> lock(g_price_mutex);
        callback_count++;
        
        bool matched = false;
        double price = update.price;
        
        if (update.token_id == g_up_token) {
            s_up_price = price;
            g_up_price.store(price);  // Update atomic for logging loop
            matched = true;
        } else if (update.token_id == g_down_token) {
            s_down_price = price;
            g_down_price.store(price);  // Update atomic for logging loop
            matched = true;
        }
        
        // Update the API server with latest prices
        set_live_prices(s_up_price, s_down_price);
        
        // Call trading engine with orderbook update
        if (poly::get_engine_ptr() && matched) {
            poly::OrderbookSnapshot snapshot;
            snapshot.asks.push_back({price, 100.0});  // Price with dummy size
            snapshot.bids.push_back({price - 0.01, 100.0});
            snapshot.timestamp = std::chrono::system_clock::now();
            poly::get_engine_ptr()->on_orderbook_update(update.token_id, snapshot);
        }
        
        // Debug: log every 500th callback (less spam)
        if (callback_count <= 5 || callback_count % 500 == 0) {
            std::cout << "[PRICE CB #" << callback_count << "] " 
                      << (matched ? "MATCHED" : "UNMATCHED") 
                      << " p=" << price 
                      << " UP=$" << s_up_price 
                      << " DOWN=$" << s_down_price << std::endl;
        }
    }
}

int main() {
    std::cout << R"(
╔═══════════════════════════════════════════════════════════════╗
║   POLY TRADER C++ - WEBSOCKET REAL-TIME                       ║
║   ⚡ Instant price updates via Polymarket WebSocket           ║
╚═══════════════════════════════════════════════════════════════╝
)" << std::endl;

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
    
    curl_global_init(CURL_GLOBAL_ALL);
    
    try {
        poly::Config config;
        config.entry_threshold = 0.36;
        config.move = 0.36;
        config.shares = 10;
        config.sum_target = 0.99;
        config.dca_enabled = true;
        config.breakeven_enabled = true;
        
        std::cout << "[CONFIG] Entry Threshold: $" << config.entry_threshold << std::endl;
        std::cout << "[CONFIG] Mode: WebSocket Real-Time" << std::endl;
        
        const char* db_url_env = std::getenv("DATABASE_URL");
        std::string db_url = db_url_env ? db_url_env :
            "postgresql://polytrader:polytrader@localhost:5432/polytrader";
        
        poly::Database db(db_url);
        if (db.connect()) {
            std::cout << "[DB] Connected" << std::endl;
        }
        
        poly::TradingEngine engine(config);
        poly::set_engine_ptr(&engine);  // Set global pointer for callback
        engine.start();
        std::cout << "[ENGINE] Started" << std::endl;
        
        // Start async trade writer for database persistence
        poly::AsyncTradeWriter async_writer(db);
        async_writer.start();
        engine.set_async_writer(&async_writer);
        
        // Initialize WebSocket
        g_ws = std::make_unique<poly::WebSocketPriceStream>();
        g_ws->set_callback(on_price_update);
        g_ws->start();
        std::cout << "[WS] WebSocket client starting..." << std::endl;
        
        // Start API server
        g_server = std::make_unique<poly::APIServer>(engine, db, 3001);
        g_server->start();
        poly::start_ws_server(3002);
        
        std::cout << "\n✓ API: http://localhost:3001\n✓ Dashboard: http://localhost:3000\n\n[RUNNING] WebSocket real-time mode - Ctrl+C to stop\n" << std::endl;
        
        std::string current_slug;
        int64_t current_window_ts = 0;
        int log_counter = 0;
        auto last_log_time = std::chrono::steady_clock::now();
        
        while (g_running) {
            // Check every 100ms for market changes and logging
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            
            int64_t window_ts = get_current_window_timestamp();
            
            // Check for new market window
            if (window_ts != current_window_ts) {
                current_window_ts = window_ts;
                current_slug = generate_market_slug(window_ts);
                
                poly::add_log("info", "MARKET", "Switching to: " + current_slug);
                std::cout << "\n[MARKET] ═══════════════════════════════════════" << std::endl;
                std::cout << "[MARKET] Switching to: " << current_slug << std::endl;
                
                std::string question;
                if (fetch_market_tokens(current_slug, question)) {
                    engine.set_market(current_slug, g_up_token, g_down_token);
                    poly::set_market_info(current_slug, question);
                    poly::add_log("info", "MARKET", "Loaded: " + question);
                    std::cout << "[MARKET] " << question << std::endl;
                    std::cout << "[TOKENS] UP:   " << g_up_token.substr(0,24) << "..." << std::endl;
                    std::cout << "[TOKENS] DOWN: " << g_down_token.substr(0,24) << "..." << std::endl;
                    
                    // Clear old subscriptions and reconnect for new market
                    g_ws->clear_subscriptions();
                    g_ws->reconnect();  // Force fresh connection
                    g_ws->subscribe(g_up_token);
                    g_ws->subscribe(g_down_token);
                    
                    // Reset prices for new market
                    s_up_price = 0.0;
                    s_down_price = 0.0;
                    g_up_price.store(0.0);
                    g_down_price.store(0.0);
                    
                    poly::add_log("info", "MARKET", "Prices reset, waiting for new market prices...");
                    
                    std::cout << "[MARKET] ═══════════════════════════════════════\n" << std::endl;
                } else {
                    poly::add_log("error", "MARKET", "Failed to load market");
                    std::cerr << "[MARKET] Failed to load market" << std::endl;
                }
            }
            
            // Log prices every second
            auto now = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::seconds>(now - last_log_time).count() >= 1) {
                last_log_time = now;
                
                double up = g_up_price.load();
                double down = g_down_price.load();
                
                if (up > 0 || down > 0) {
                    int secs_into_window = get_seconds_into_window();
                    int time_left = 900 - secs_into_window;
                    bool in_trading = secs_into_window <= 120;
                    
                    std::ostringstream oss;
                    oss << std::fixed << std::setprecision(2);
                    oss << "UP: $" << up << " | DOWN: $" << down;
                    oss << " | " << (in_trading ? "🔥 TRADING" : "👁️ WATCHING");
                    oss << " | " << time_left << "s";
                    oss << " | WS:" << (g_ws->is_connected() ? "✓" : "✗");
                    poly::add_log("info", "PRICE", oss.str());

                    
                    
                    // Entry signals
                    if (in_trading) {
                        if (up <= config.entry_threshold) {
                            std::ostringstream sig;
                            sig << std::fixed << std::setprecision(2);
                            sig << "🎯 UP @ $" << up << " - ENTRY SIGNAL!";
                            poly::add_log("warn", "SIGNAL", sig.str());
                            std::cout << "[SIGNAL] " << sig.str() << std::endl;
                        }
                        if (down <= config.entry_threshold) {
                            std::ostringstream sig;
                            sig << std::fixed << std::setprecision(2);
                            sig << "🎯 DOWN @ $" << down << " - ENTRY SIGNAL!";
                            poly::add_log("warn", "SIGNAL", sig.str());
                            std::cout << "[SIGNAL] " << sig.str() << std::endl;
                        }
                    }
                }
                
                // Log WebSocket status
                if (!g_ws->is_connected()) {
                    poly::add_log("warn", "WS", "WebSocket disconnected - reconnecting...");
                }
            }

            // Broadcast to dashboard WebSocket every 100ms (instant feel)
            static auto last_broadcast_time = std::chrono::steady_clock::now();
            auto broadcast_now = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::milliseconds>(broadcast_now - last_broadcast_time).count() >= 100) {
                last_broadcast_time = broadcast_now;
                {
                    // Build WebSocket message in format dashboard expects
                    double up_p = g_up_price.load();
                    double down_p = g_down_price.load();
                    int ws_secs = get_seconds_into_window();
                    int ws_time_left = 900 - ws_secs;
                    bool ws_in_trading = ws_secs <= 120;
                    
                    nlohmann::json ws_msg;
                    ws_msg["type"] = "status";
                    ws_msg["upPrice"] = up_p;
                    ws_msg["downPrice"] = down_p;
                    ws_msg["market"] = current_slug;
                    ws_msg["inTrading"] = ws_in_trading;
                    ws_msg["timeLeft"] = ws_time_left;
                    ws_msg["wsConnected"] = g_ws && g_ws->is_connected();
                    ws_msg["autoEnabled"] = true;
                    poly::broadcast_status(ws_msg.dump());
                }
            }
        }
        
        // Cleanup
        if (g_curl_market) curl_easy_cleanup(g_curl_market);
        curl_global_cleanup();
        
        std::cout << "[SHUTDOWN] Clean exit" << std::endl;
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "[FATAL] " << e.what() << std::endl;
        return 1;
    }
}
