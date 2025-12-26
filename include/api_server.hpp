#pragma once

#include "trading_engine.hpp"
#include "database.hpp"
#include <thread>
#include <atomic>
#include <string>
#include <nlohmann/json.hpp>

namespace poly {

class APIServer {
public:
    APIServer(TradingEngine& engine, Database& db, int port);
    ~APIServer();
    
    void start();
    void stop();
    
private:
    void run();
    
    TradingEngine& engine_;
    Database& db_;
    int port_;
    std::atomic<bool> running_;
    std::thread server_thread_;
    int server_socket_;
};

// Global functions for cross-module communication
void add_log(const std::string& level, const std::string& name, const std::string& message);
void set_live_prices(double up_price, double down_price);
void set_market_info(const std::string& slug, const std::string& question);

} // namespace poly
