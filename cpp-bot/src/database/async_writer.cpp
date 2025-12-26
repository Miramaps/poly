#include "async_writer.hpp"
#include <iostream>

namespace poly {

AsyncTradeWriter::AsyncTradeWriter(Database& db) : db_(db) {}

AsyncTradeWriter::~AsyncTradeWriter() {
    stop();
}

void AsyncTradeWriter::start() {
    if (running_.exchange(true)) return;
    worker_ = std::thread(&AsyncTradeWriter::worker_loop, this);
    std::cout << "[ASYNC] Trade writer started" << std::endl;
}

void AsyncTradeWriter::stop() {
    if (!running_.exchange(false)) return;
    cv_.notify_all();
    if (worker_.joinable()) {
        worker_.join();
    }
    std::cout << "[ASYNC] Trade writer stopped" << std::endl;
}

void AsyncTradeWriter::queue_trade(const TradeRecord& trade) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        queue_.push(trade);
    }
    cv_.notify_one();
    std::cout << "[ASYNC] Trade queued for DB write (pending: " << pending_count() << ")" << std::endl;
}

size_t AsyncTradeWriter::pending_count() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

void AsyncTradeWriter::worker_loop() {
    while (running_) {
        TradeRecord trade;
        
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait(lock, [this] { return !queue_.empty() || !running_; });
            
            if (!running_ && queue_.empty()) break;
            if (queue_.empty()) continue;
            
            trade = queue_.front();
            queue_.pop();
        }
        
        // Write to database (this is the slow part, but we're in background thread)
        if (db_.insert_trade(trade)) {
            std::cout << "[ASYNC] ✓ Trade saved to DB: " << trade.side << " x" << trade.shares 
                      << " @ $" << trade.price << std::endl;
        } else {
            std::cerr << "[ASYNC] ✗ Failed to save trade to DB" << std::endl;
        }
    }
    
    // Drain remaining trades on shutdown
    std::lock_guard<std::mutex> lock(mutex_);
    while (!queue_.empty()) {
        auto trade = queue_.front();
        queue_.pop();
        db_.insert_trade(trade);
    }
}

} // namespace poly
