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
        return (now_sec / 900) * 900;  // Use window START time (market slug convention)
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
        
        // Determine the best available price
        // Priority: best_ask > price (from price_changes)
        double ask = 0.0;
        double bid = 0.0;
        
        if (update.best_ask > 0) {
            ask = update.best_ask;
        } else if (update.price > 0) {
            ask = update.price;  // Use price as ask
        }
        
        if (update.best_bid > 0) {
            bid = update.best_bid;
        } else if (ask > 0) {
            bid = ask - 0.01;  // Estimate bid as ask - spread
        }
        
        if (ask <= 0) return;  // No valid price, skip
        
        if (update.token_id == g_up_token) {
            s_up_price = ask;
            g_up_price.store(ask);
            matched = true;
        } else if (update.token_id == g_down_token) {
            s_down_price = ask;
            g_down_price.store(ask);
            matched = true;
        }
        
        // Update the API server with latest prices (only when matched)
        if (matched) {
            set_live_prices(s_up_price, s_down_price);
        }
        
        // Don't send orderbook from price updates - we get full orderbook via orderbook callback
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
        
        // Initialize Polymarket client for live trading
        auto polymarket_client = std::make_shared<poly::PolymarketClient>();
        polymarket_client->set_executor_path("scripts/order_executor.py");
        engine.set_polymarket_client(polymarket_client);
        
        // Check if live trading is available
        if (polymarket_client->is_live_trading_available()) {
            std::cout << "[WALLET] ✓ Live trading credentials detected" << std::endl;
            poly::add_log("info", "WALLET", "Live trading credentials configured");
        } else {
            std::cout << "[WALLET] ℹ️  Paper trading mode (no credentials)" << std::endl;
            poly::add_log("info", "WALLET", "Paper trading mode - set POLYMARKET_PRIVATE_KEY for live trading");
        }
        
        // Initialize WebSocket
        g_ws = std::make_unique<poly::WebSocketPriceStream>();
        g_ws->set_callback(on_price_update);
        
        // Set orderbook callback for full depth updates via WebSocket
        g_ws->set_orderbook_callback([](const poly::OrderbookUpdate& update) {
            if (!poly::get_engine_ptr()) return;
            
            poly::OrderbookSnapshot snapshot;
            snapshot.asks = update.asks;  // Already in the right format (pairs)
            snapshot.bids = update.bids;
            snapshot.timestamp = std::chrono::system_clock::now();
            
            poly::get_engine_ptr()->on_orderbook_update(update.token_id, snapshot);
        });
        
        g_ws->start();
        std::cout << "[WS] WebSocket client starting..." << std::endl;
        
        // Start API server
        g_server = std::make_unique<poly::APIServer>(engine, db, 3001);
        g_server->start();
        poly::start_ws_server(3002);
        
        std::cout << "\n✓ API: http://localhost:3001\n✓ Dashboard: http://localhost:3000\n\n[RUNNING] WebSocket real-time mode - Ctrl+C to stop\n" << std::endl;
        
    std::string current_slug;
        int64_t current_window_ts = 0;
        auto last_log_time = std::chrono::steady_clock::now();
        
        // Pre-fetched next market tokens
        std::string next_up_token;
        std::string next_down_token;
        std::string next_slug;
        std::string next_question;
        bool next_tokens_ready = false;
        
        // Calculate exact time until next window
        auto get_ms_until_next_window = []() -> int64_t {
            auto now = std::chrono::system_clock::now();
            auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
            int64_t window_ms = 900 * 1000; // 15 minutes in ms
            int64_t ms_into_window = now_ms % window_ms;
            return window_ms - ms_into_window;
        };
        
        while (g_running) {
            int secs_in_window = get_seconds_into_window();
            int time_left = 900 - secs_in_window;
            int64_t ms_until_switch = get_ms_until_next_window();
            
            // PRECISE TIMING: Sleep until exactly when we need to act
            // FAST loop - 50ms for real-time dashboard updates
            int sleep_ms;
            if (ms_until_switch <= 1) {
                sleep_ms = 0;  // Window switch imminent
            } else if (ms_until_switch <= 100) {
                sleep_ms = 1;  // Within 100ms of switch - precision mode
            } else {
                sleep_ms = 50; // Normal operation - 20 updates/second for real-time feel
            }
            
            if (sleep_ms > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
            }
            
            int64_t window_ts = get_current_window_timestamp();
            
            // PRE-FETCH: 20 seconds before window ends, fetch next market tokens
            if (time_left <= 20 && time_left > 0 && !next_tokens_ready) {
                int64_t next_window_ts = window_ts + 900;
                next_slug = generate_market_slug(next_window_ts);
                
                std::cout << "[PRE-FETCH] Fetching next market: " << next_slug << std::endl;
                poly::add_log("info", "PRE-FETCH", "Fetching next market: " + next_slug);
                
                // Store current tokens
                std::string old_up = g_up_token;
                std::string old_down = g_down_token;
                
                if (fetch_market_tokens(next_slug, next_question)) {
                    next_up_token = g_up_token;
                    next_down_token = g_down_token;
                    next_tokens_ready = true;
                    
                    // Restore current tokens
                    g_up_token = old_up;
                    g_down_token = old_down;
                    
                    std::cout << "[PRE-FETCH] ✓ Ready: " << next_question << std::endl;
                    poly::add_log("info", "PRE-FETCH", "✓ Next market tokens ready");
                    
                    // Pre-subscribe to next market tokens (WebSocket will start receiving)
                    g_ws->subscribe(next_up_token);
                    g_ws->subscribe(next_down_token);
                    std::cout << "[PRE-FETCH] ✓ Pre-subscribed to next market tokens" << std::endl;
                } else {
                    std::cerr << "[PRE-FETCH] Failed to fetch next market" << std::endl;
                }
            }
            
            // Check for new market window
            if (window_ts != current_window_ts) {
                current_window_ts = window_ts;
                current_slug = generate_market_slug(window_ts);
                
                auto switch_start = std::chrono::high_resolution_clock::now();
                
                // Calculate how late we are (ms after the exact window start)
                auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                int64_t window_start_ms = window_ts * 1000;
                int64_t latency_ms = now_ms - window_start_ms;
                
                std::cout << "\n[MARKET] ═══════════════════════════════════════" << std::endl;
                std::cout << "[MARKET] ⚡ SWITCH DETECTED (latency: " << latency_ms << "ms)" << std::endl;
                std::cout << "[MARKET] New market: " << current_slug << std::endl;
                poly::add_log("info", "MARKET", "⚡ SWITCH (latency: " + std::to_string(latency_ms) + "ms) " + current_slug);
                
                // Use pre-fetched tokens if available
                if (next_tokens_ready && next_slug == current_slug) {
                    g_up_token = next_up_token;
                    g_down_token = next_down_token;
                    
                    engine.set_market(current_slug, g_up_token, g_down_token);
                    poly::set_market_info(current_slug, next_question);
                    
                    std::cout << "[MARKET] ✓ Using pre-fetched tokens (INSTANT)" << std::endl;
                    std::cout << "[TOKENS] UP:   " << g_up_token.substr(0,24) << "..." << std::endl;
                    std::cout << "[TOKENS] DOWN: " << g_down_token.substr(0,24) << "..." << std::endl;
                    
                    // Already subscribed via pre-fetch, no reconnect needed!
                    
                    // Clear old subscriptions (keep new ones)
                    // Note: We don't call clear_subscriptions() because we want to keep new tokens
                    
                } else {
                    // Fallback: fetch tokens now (slower path)
                    std::cout << "[MARKET] ⚠️  No pre-fetch, fetching now..." << std::endl;
                    std::string question;
                    if (fetch_market_tokens(current_slug, question)) {
                        engine.set_market(current_slug, g_up_token, g_down_token);
                        poly::set_market_info(current_slug, question);
                        
                        // Subscribe immediately (will send on existing connection)
                        g_ws->clear_subscriptions();
                        g_ws->subscribe(g_up_token);
                        g_ws->subscribe(g_down_token);
                        
                        std::cout << "[TOKENS] UP:   " << g_up_token.substr(0,24) << "..." << std::endl;
                        std::cout << "[TOKENS] DOWN: " << g_down_token.substr(0,24) << "..." << std::endl;
                    } else {
                        poly::add_log("error", "MARKET", "Failed to load market");
                        std::cerr << "[MARKET] Failed to load market" << std::endl;
                    }
                }
                
                // Reset prices for new market
                s_up_price = 0.0;
                s_down_price = 0.0;
                g_up_price.store(0.0);
                g_down_price.store(0.0);
                
                // Reset pre-fetch state
                next_tokens_ready = false;
                
                auto switch_end = std::chrono::high_resolution_clock::now();
                auto switch_ms = std::chrono::duration_cast<std::chrono::milliseconds>(switch_end - switch_start).count();
                
                std::cout << "[MARKET] Switch completed in " << switch_ms << "ms" << std::endl;
                poly::add_log("info", "MARKET", "Switch completed in " + std::to_string(switch_ms) + "ms");
                std::cout << "[MARKET] ═══════════════════════════════════════\n" << std::endl;
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
                    // Trading happens in the LAST dump_window_sec seconds
                    bool in_trading = time_left <= config.dump_window_sec && time_left >= 0;
                    
                    std::ostringstream oss;
                    oss << std::fixed << std::setprecision(2);
                    oss << "UP: $" << up << " | DOWN: $" << down;
                    oss << " | " << (in_trading ? "🔥 TRADING" : "👁️ WATCHING");
                    oss << " | " << time_left << "s";
                    oss << " | WS:" << (g_ws->is_connected() ? "✓" : "✗");
                    poly::add_log("info", "PRICE", oss.str());

                    // Entry signals - only log during actual trading window
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

            // Broadcast FULL status to dashboard WebSocket every 50ms (INSTANT updates)
            static auto last_broadcast_time = std::chrono::steady_clock::now();
            static int broadcast_check_count = 0;
            auto broadcast_now = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::milliseconds>(broadcast_now - last_broadcast_time).count() >= 50) {
                last_broadcast_time = broadcast_now;
                broadcast_check_count++;
                
                if (poly::get_engine_ptr()) {
                    auto status = poly::get_engine_ptr()->get_status();
                    
                    nlohmann::json ws_msg;
                    ws_msg["type"] = "fullStatus";
                    
                    // Market info
                    ws_msg["market"] = current_slug;
                    int ws_secs = get_seconds_into_window();
                    int ws_time_left = 900 - ws_secs;
                    bool ws_in_trading = time_left <= config.dump_window_sec && time_left >= 0;
                    ws_msg["inTrading"] = ws_in_trading;
                    ws_msg["timeLeft"] = ws_time_left;
                    ws_msg["wsConnected"] = g_ws && g_ws->is_connected();
                    
                    // FULL orderbook data
                    ws_msg["orderbooks"] = nlohmann::json::object();
                    ws_msg["orderbooks"]["UP"] = {
                        {"asks", nlohmann::json::array()},
                        {"bids", nlohmann::json::array()}
                    };
                    ws_msg["orderbooks"]["DOWN"] = {
                        {"asks", nlohmann::json::array()},
                        {"bids", nlohmann::json::array()}
                    };
                    
                    for (const auto& [price, size] : status.up_orderbook.asks) {
                        nlohmann::json level;
                        level["price"] = price;
                        level["size"] = size;
                        ws_msg["orderbooks"]["UP"]["asks"].push_back(level);
                    }
                    for (const auto& [price, size] : status.up_orderbook.bids) {
                        nlohmann::json level;
                        level["price"] = price;
                        level["size"] = size;
                        ws_msg["orderbooks"]["UP"]["bids"].push_back(level);
                    }
                    for (const auto& [price, size] : status.down_orderbook.asks) {
                        nlohmann::json level;
                        level["price"] = price;
                        level["size"] = size;
                        ws_msg["orderbooks"]["DOWN"]["asks"].push_back(level);
                    }
                    for (const auto& [price, size] : status.down_orderbook.bids) {
                        nlohmann::json level;
                        level["price"] = price;
                        level["size"] = size;
                        ws_msg["orderbooks"]["DOWN"]["bids"].push_back(level);
                    }
                    
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
