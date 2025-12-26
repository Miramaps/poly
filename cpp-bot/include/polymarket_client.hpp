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

class PolymarketClient {
public:
    explicit PolymarketClient(
        const std::string& api_url = "https://clob.polymarket.com",
        const std::string& gamma_url = "https://gamma-api.polymarket.com"
    );
    
    // Market discovery
    std::vector<Market> get_markets(const std::string& query = "");
    Market get_market(const std::string& slug);
    
    // Orderbook data
    Orderbook get_orderbook(const std::string& token_id);
    
    // Trading (requires authentication)
    struct OrderResult {
        std::string order_id;
        std::string status;
        double filled_amount;
    };
    
    OrderResult place_order(
        const std::string& token_id,
        const std::string& side,  // "BUY" or "SELL"
        double size,
        double price
    );

private:
    std::string api_url_;
    std::string gamma_url_;
    std::string api_key_;
    std::string private_key_;
    
    // HTTP request helper
    json http_get(const std::string& url);
    json http_post(const std::string& url, const json& body);
};

} // namespace poly

