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

// Forward declaration
class PolymarketClient;

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
    double pnl = 0.0;  // Profit/loss for this trade (if leg 2)
    bool is_live = false;  // true if this was a real trade, false if paper
    std::chrono::system_clock::time_point timestamp;
};

struct Config {
    double entry_threshold = 0.35;
    int shares = 10;
    bool dca_enabled = true;
    std::vector<double> dca_levels = {0.30, 0.25, 0.20, 0.15};
    double dca_multiplier = 1.5;
    double sum_target = 0.99;
    bool breakeven_enabled = true;
    double move = 0.36;  // Updated threshold
    int window_min = 15;
    int dump_window_sec = 120;  // Trade in the last 120 seconds (2 minutes) of each 15-min window
};

enum class TradingMode {
    PAPER,
    LIVE
};

struct CycleStatus {
    bool active = false;
    std::string status = "pending";  // "pending", "leg1_done", "complete", "incomplete"
    std::string leg1_side;
    double leg1_price = 0.0;
    double leg1_shares = 0.0;
    std::string leg2_side;
    double leg2_price = 0.0;
    double leg2_shares = 0.0;
    double total_cost = 0.0;
    double pnl = 0.0;
};

struct EngineStatus {
    bool running;
    std::string mode;  // "PAPER" or "LIVE"
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
    bool live_trading_available = false;
    CycleStatus current_cycle;
};

class TradingEngine {
public:
    explicit TradingEngine(Config config);
    ~TradingEngine();

    // Disable copy and move (contains atomic)
    TradingEngine(const TradingEngine&) = delete;
    TradingEngine& operator=(const TradingEngine&) = delete;
    TradingEngine(TradingEngine&&) = delete;
    TradingEngine& operator=(TradingEngine&&) = delete;

    void start();
    void stop();
    
    // Get current status for API
    EngineStatus get_status() const;
    
    // Get current config
    Config get_config() const;
    
    // Configuration setters
    void set_entry_threshold(double value);
    void set_shares(int value);
    void set_sum_target(double value);
    void set_dca_enabled(bool value);
    void set_trading_window(int seconds);
    
    // Set active market to watch
    void set_market(const std::string& slug, const std::string& up_token, const std::string& down_token);
    
    // Set async trade writer for database persistence
    void set_async_writer(class AsyncTradeWriter* writer);
    
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
    
    // ============ TRADING MODE CONTROL ============
    
    // Set trading mode (PAPER or LIVE)
    bool set_trading_mode(TradingMode mode);
    TradingMode get_trading_mode() const;
    std::string get_trading_mode_string() const;
    
    // Check if live trading is available
    bool is_live_trading_available() const;
    
    // Set the Polymarket client for live trading
    void set_polymarket_client(std::shared_ptr<PolymarketClient> client);
    
    // Refresh balance from Polymarket (for live trading)
    void refresh_balance();
    
    // Set cash manually (for paper trading)
    void set_cash(double amount);
    
    // Reset paper trading state
    void reset_paper_trading();

private:
    Config config_;
    std::atomic<bool> running_{false};
    std::chrono::system_clock::time_point start_time_;
    mutable std::mutex mutex_;  // For thread-safe access
    
    // Portfolio state
    double cash_ = 1000.0;
    double realized_pnl_ = 0.0;
    TradingMode trading_mode_ = TradingMode::PAPER;
    
    // Polymarket client for live trading
    std::shared_ptr<PolymarketClient> polymarket_client_;
    
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
    
    // Trade history (in-memory)
    std::vector<Trade> trade_history_;
    
    // Cycle tracking
    CycleStatus last_completed_cycle_;
    std::chrono::system_clock::time_point last_cycle_complete_time_;
    
    // Async trade writer
    class AsyncTradeWriter* async_writer_ = nullptr;
    
    // Trading logic
    void process_market(const std::string& market_slug);
    bool should_enter(const MarketState& market, std::string& side_out, double& price_out);
    bool should_hedge(const Position& pos, const MarketState& market, double& price_out);
    
    // Helper functions
    double get_best_bid(const OrderbookSnapshot& book) const;
    double get_best_ask(const OrderbookSnapshot& book) const;
    
    // Execute trade via Polymarket API (live mode)
    std::optional<Trade> execute_live_trade(
        const std::string& market_slug,
        const std::string& side,
        const std::string& token_id,
        double shares,
        double price
    );
    
    // Execute paper trade (simulation)
    std::optional<Trade> execute_paper_trade(
        const std::string& market_slug,
        const std::string& side,
        const std::string& token_id,
        double shares,
        double price
    );
};

} // namespace poly
