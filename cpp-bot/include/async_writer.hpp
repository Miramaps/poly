#pragma once

#include "database.hpp"
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>

namespace poly {

class AsyncTradeWriter {
public:
    explicit AsyncTradeWriter(Database& db);
    ~AsyncTradeWriter();
    
    // Non-blocking: queues trade for async write
    void queue_trade(const TradeRecord& trade);
    
    void start();
    void stop();
    
    size_t pending_count() const;

private:
    void worker_loop();
    
    Database& db_;
    std::queue<TradeRecord> queue_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::thread worker_;
    std::atomic<bool> running_{false};
};

} // namespace poly
