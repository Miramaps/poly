#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <optional>
#include <chrono>
#include <unordered_map>

namespace poly {

struct OrderbookSnapshot {
    std::vector<std::pair<double, double>> bids;  // price, size
    std::vector<std::pair<double, double>> asks;
    std::chrono::system_clock::time_point timestamp;
};

struct Trade {
    std::string id;
    std::string market_slug;
    int leg;
    std::string side;
    std::string token_id;
    double shares;
    double price;
    double cost;
    double fee;
    double pnl = 0.0;
    std::chrono::system_clock::time_point timestamp;
};

struct Config {
    double entry_threshold = 0.36;
    int shares = 10;
    bool dca_enabled = true;
    std::vector<double> dca_levels = {0.30, 0.25, 0.20, 0.15};
    double dca_multiplier = 1.5;
    double sum_target = 0.99;
    bool breakeven_enabled = true;
    double move = 0.36;  // Entry threshold
    int window_min = 15;
    int dump_window_sec = 120;  // Trading window seconds (first 2 minutes)
};

struct EngineStatus {
    bool running;
    std::string mode;
    double cash;
    struct {
        double UP;
        double DOWN;
    } positions;
    double realized_pnl;
    double unrealized_pnl;
    double equity;
    struct OrderbookData {
        std::vector<std::pair<double, double>> bids;  // price, size
        std::vector<std::pair<double, double>> asks;
    };
    OrderbookData up_orderbook;
    OrderbookData down_orderbook;
    std::string market_slug;
    Config config;
    int64_t uptime_seconds;
    std::vector<Trade> recent_trades;
};

class AsyncTradeWriter;
class TradingEngine {
public:
    explicit TradingEngine(Config config);
    ~TradingEngine();

    // Disable copy, enable move
    TradingEngine(const TradingEngine&) = delete;
    TradingEngine& operator=(const TradingEngine&) = delete;
    TradingEngine(TradingEngine&&) = default;
    TradingEngine& operator=(TradingEngine&&) = default;

    void start();
    void stop();
    
    // Get current status for API
    EngineStatus get_status() const;
    
    // Set active market to watch
    void set_market(const std::string& slug, const std::string& up_token, const std::string& down_token);
    void set_async_writer(AsyncTradeWriter* writer);
    
    // Called when orderbook updates arrive
    void on_orderbook_update(const std::string& token_id, OrderbookSnapshot snapshot);
    
    // Execute a trade
    std::optional<Trade> execute_trade(
        const std::string& market_slug,
        const std::string& side,
        const std::string& token_id,
        double shares,
        double price
    );
    
    // Update config values dynamically
    void set_entry_threshold(double value);
    void set_shares(int value);
    void set_sum_target(double value);
    void set_dca_enabled(bool value);
    void set_trading_window(int seconds);
    
    // Get current config
    Config get_config() const;

private:
    Config config_;
    std::atomic<bool> running_{false};
    std::chrono::system_clock::time_point start_time_;
    mutable std::mutex mutex_;  // For thread-safe access
    
    // Portfolio state
    double cash_ = 1000.0;
    double realized_pnl_ = 0.0;
    std::string trading_mode_ = "PAPER";
    
    // Market state
    struct MarketState {
        std::string slug;
        std::string up_token_id;
        std::string down_token_id;
        OrderbookSnapshot up_orderbook;
        OrderbookSnapshot down_orderbook;
        std::chrono::system_clock::time_point last_update;
    };
    
    std::unordered_map<std::string, MarketState> markets_;
    std::string active_market_slug_;
    
    // Position tracking
    struct Position {
        std::string market_slug;
        std::string side;
        double shares = 0.0;
        double avg_cost = 0.0;
        double total_cost = 0.0;
        std::vector<Trade> trades;
    };
    
    std::optional<Position> current_position_;
    std::chrono::system_clock::time_point last_cycle_complete_time_;
    
    // Trade history (in-memory)
    std::vector<Trade> trade_history_;
    AsyncTradeWriter* async_writer_{nullptr};
    
    // Trading logic
    void process_market(const std::string& market_slug);
    bool should_enter(const MarketState& market, std::string& side_out, double& price_out);
    bool should_hedge(const Position& pos, const MarketState& market, double& price_out);
    
    // Helper functions
    double get_best_bid(const OrderbookSnapshot& book) const;
    double get_best_ask(const OrderbookSnapshot& book) const;
};

} // namespace poly

