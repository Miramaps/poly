#pragma once

#include <string>
#include <vector>
#include <memory>
#include <nlohmann/json.hpp>

namespace poly {

using json = nlohmann::json;

struct Market {
    std::string slug;
    std::string condition_id;
    std::string question;
    std::vector<std::string> outcomes;
    std::vector<std::string> token_ids;
    bool active;
};

struct OrderbookLevel {
    double price;
    double size;
};

struct Orderbook {
    std::string asset_id;
    std::vector<OrderbookLevel> bids;
    std::vector<OrderbookLevel> asks;
    uint64_t timestamp;
};

// ============ LIVE TRADING RESULT TYPES ============

struct OrderResult {
    bool success = false;
    std::string order_id;
    std::string status;
    double filled_amount = 0.0;
    double price = 0.0;
    std::string error;
};

struct BalanceResult {
    bool success = false;
    double balance = 0.0;
    std::string currency = "USDC";
    std::string error;
};

struct Position {
    std::string token_id;
    double size = 0.0;
    double avg_price = 0.0;
};

struct PositionsResult {
    bool success = false;
    std::vector<Position> positions;
    std::string error;
};

class PolymarketClient {
public:
    explicit PolymarketClient(
        const std::string& api_url = "https://clob.polymarket.com",
        const std::string& gamma_url = "https://gamma-api.polymarket.com"
    );
    
    // Set path to Python order executor script
    void set_executor_path(const std::string& path);
    
    // ============ MARKET DATA (Read-Only) ============
    
    // Market discovery
    std::vector<Market> get_markets(const std::string& query = "");
    Market get_market(const std::string& slug);
    
    // Orderbook data
    Orderbook get_orderbook(const std::string& token_id);
    
    // ============ LIVE TRADING (Requires Authentication) ============
    
    // Place a limit order (GTC - Good Till Cancelled)
    OrderResult place_order(
        const std::string& token_id,
        const std::string& side,  // "BUY" or "SELL"
        double size,
        double price
    );
    
    // Place a market order (FOK - Fill or Kill)
    OrderResult place_market_order(
        const std::string& token_id,
        const std::string& side,  // "BUY" or "SELL"
        double size
    );
    
    // Cancel an order
    bool cancel_order(const std::string& order_id);
    
    // Cancel all open orders
    bool cancel_all_orders();
    
    // ============ ACCOUNT DATA ============
    
    // Get USDC balance
    BalanceResult get_balance();
    
    // Get current positions
    PositionsResult get_positions();
    
    // Check if live trading is available (private key configured)
    bool is_live_trading_available() const;

private:
    std::string api_url_;
    std::string gamma_url_;
    std::string executor_path_ = "scripts/order_executor.py";
    
    // HTTP request helpers
    json http_get(const std::string& url);
    json http_post(const std::string& url, const json& body);
    
    // Execute Python script for live trading
    json execute_python(const std::string& args);
};

} // namespace poly
