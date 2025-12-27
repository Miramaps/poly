#pragma once

#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <libpq-fe.h>

namespace poly {

struct TradeRecord {
    std::string id;
    std::string market_slug;
    int leg;
    std::string side;
    std::string token_id;
    double shares;
    double price;
    double cost;
    double fee;
    int64_t timestamp;
};

struct CycleRecord {
    std::string id;
    std::string market_slug;
    int64_t started_at;
    std::optional<int64_t> ended_at;
    std::optional<std::string> leg1_side;
    std::optional<double> leg1_price;
    std::optional<double> leg2_price;
    std::optional<double> locked_in_profit;
    std::string status;
};

class Database {
public:
    explicit Database(const std::string& connection_string);
    ~Database();
    
    // Disable copy, enable move
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;
    Database(Database&&) noexcept;
    Database& operator=(Database&&) noexcept;
    
    bool connect();
    void disconnect();
    
    // Market operations (for foreign key)
    bool ensure_market_exists(const std::string& slug, const std::string& title = "");
    
    // Trade operations
    bool insert_trade(const TradeRecord& trade);
    std::vector<TradeRecord> get_trades(const std::string& market_slug);
    
    // Cycle operations
    bool insert_cycle(const CycleRecord& cycle);
    bool update_cycle(const CycleRecord& cycle);
    std::optional<CycleRecord> get_active_cycle();
    
    // Execute raw query
    bool execute(const std::string& query);

private:
    std::string connection_string_;
    PGconn* conn_{nullptr};
    
    bool check_connection();
};

} // namespace poly

