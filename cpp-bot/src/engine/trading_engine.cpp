#include "trading_engine.hpp"
#include <iostream>
#include <iomanip>
#include <algorithm>
#include <cmath>

namespace poly {

TradingEngine::TradingEngine(Config config)
    : config_(std::move(config))
    , start_time_(std::chrono::system_clock::now()) {
}

TradingEngine::~TradingEngine() {
    stop();
}

void TradingEngine::start() {
    if (running_.exchange(true)) {
        return; // Already running
    }
    start_time_ = std::chrono::system_clock::now();
    std::cout << "[ENGINE] Trading engine started" << std::endl;
}

void TradingEngine::stop() {
    if (!running_.exchange(false)) {
        return; // Already stopped
    }
    
    std::cout << "[ENGINE] Trading engine stopped" << std::endl;
}

void TradingEngine::set_market(const std::string& slug, const std::string& up_token, const std::string& down_token) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    active_market_slug_ = slug;
    
    // Initialize market state if not exists
    if (markets_.find(slug) == markets_.end()) {
        markets_[slug] = MarketState{
            .slug = slug,
            .up_token_id = up_token,
            .down_token_id = down_token,
            .up_orderbook = {},
            .down_orderbook = {},
            .last_update = std::chrono::system_clock::now()
        };
    } else {
        markets_[slug].up_token_id = up_token;
        markets_[slug].down_token_id = down_token;
    }
    
    std::cout << "[ENGINE] Set active market: " << slug << std::endl;
}

EngineStatus TradingEngine::get_status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    EngineStatus status;
    status.running = running_;
    status.mode = trading_mode_;
    status.cash = cash_;
    status.realized_pnl = realized_pnl_;
    status.config = config_;
    status.market_slug = active_market_slug_;
    
    // Calculate uptime
    auto now = std::chrono::system_clock::now();
    status.uptime_seconds = std::chrono::duration_cast<std::chrono::seconds>(now - start_time_).count();
    
    // Get positions from current position
    status.positions.UP = 0;
    status.positions.DOWN = 0;
    
    if (current_position_) {
        if (current_position_->side == "UP") {
            status.positions.UP = current_position_->shares;
        } else {
            status.positions.DOWN = current_position_->shares;
        }
    }
    
    // Calculate unrealized PnL and equity
    status.unrealized_pnl = 0.0;
    
    // Get orderbook data for active market
    auto it = markets_.find(active_market_slug_);
    if (it != markets_.end()) {
        const auto& market = it->second;
        
        // Copy UP orderbook
        for (const auto& [price, size] : market.up_orderbook.asks) {
            status.up_orderbook.asks.push_back({price, size});
        }
        for (const auto& [price, size] : market.up_orderbook.bids) {
            status.up_orderbook.bids.push_back({price, size});
        }
        
        // Copy DOWN orderbook
        for (const auto& [price, size] : market.down_orderbook.asks) {
            status.down_orderbook.asks.push_back({price, size});
        }
        for (const auto& [price, size] : market.down_orderbook.bids) {
            status.down_orderbook.bids.push_back({price, size});
        }
        
        // Calculate unrealized PnL if we have a position
        if (current_position_) {
            double current_bid = 0.0;
            if (current_position_->side == "UP" && !market.up_orderbook.bids.empty()) {
                current_bid = market.up_orderbook.bids[0].first;
            } else if (current_position_->side == "DOWN" && !market.down_orderbook.bids.empty()) {
                current_bid = market.down_orderbook.bids[0].first;
            }
            status.unrealized_pnl = (current_bid - current_position_->avg_cost) * current_position_->shares;
        }
    }
    
    // Calculate equity
    double position_value = 0.0;
    if (current_position_) {
        // Use current position value estimate
        position_value = current_position_->shares * current_position_->avg_cost;
    }
    status.equity = status.cash + position_value + status.unrealized_pnl;
    
    // Copy recent trades (last 100)
    size_t start_idx = trade_history_.size() > 100 ? trade_history_.size() - 100 : 0;
    for (size_t i = start_idx; i < trade_history_.size(); ++i) {
        status.recent_trades.push_back(trade_history_[i]);
    }
    
    return status;
}

void TradingEngine::on_orderbook_update(
    const std::string& token_id,
    OrderbookSnapshot snapshot
) {
    if (!running_) return;
    
    std::string market_to_process;
    
    {
        std::lock_guard<std::mutex> lock(mutex_);
        
        // Find which market this token belongs to
        for (auto& [slug, market] : markets_) {
            if (market.up_token_id == token_id) {
                market.up_orderbook = std::move(snapshot);
                market.last_update = std::chrono::system_clock::now();
                market_to_process = slug;
                break;
            } else if (market.down_token_id == token_id) {
                market.down_orderbook = std::move(snapshot);
                market.last_update = std::chrono::system_clock::now();
                market_to_process = slug;
                break;
            }
        }
    }
    
    if (!market_to_process.empty()) {
        process_market(market_to_process);
    }
}

void TradingEngine::process_market(const std::string& market_slug) {
    auto it = markets_.find(market_slug);
    if (it == markets_.end()) return;
    
    const auto& market = it->second;
    
    // Check if we should enter a position
    if (!current_position_) {
        std::string side;
        double price;
        
        if (should_enter(market, side, price)) {
            std::cout << "[SIGNAL] Entry detected: " << side 
                      << " @ $" << price << std::endl;
            
            // Execute entry trade
            auto trade = execute_trade(
                market_slug,
                side,
                side == "UP" ? market.up_token_id : market.down_token_id,
                config_.shares,
                price
            );
            
            if (trade) {
                current_position_ = Position{
                    .market_slug = market_slug,
                    .side = side,
                    .shares = trade->shares,
                    .avg_cost = trade->price,
                    .total_cost = trade->cost,
                    .trades = {*trade}
                };
                
                std::cout << "\n╔══════════════════════════════════════════════════════════╗" << std::endl;
                std::cout << "║  🟢 LEG 1 ENTRY                                           ║" << std::endl;
                std::cout << "╠══════════════════════════════════════════════════════════╣" << std::endl;
                std::cout << "║  Side:      " << side << std::string(45 - side.length(), ' ') << "║" << std::endl;
                std::cout << "║  Shares:    " << trade->shares << std::string(45 - std::to_string((int)trade->shares).length(), ' ') << "║" << std::endl;
                std::cout << "║  Price:     $" << std::fixed << std::setprecision(4) << trade->price << std::string(43, ' ') << "║" << std::endl;
                std::cout << "║  Cost:      $" << std::fixed << std::setprecision(2) << trade->cost << std::string(43, ' ') << "║" << std::endl;
                std::cout << "║  Cash:      $" << std::fixed << std::setprecision(2) << cash_ << std::string(43, ' ') << "║" << std::endl;
                std::cout << "╚══════════════════════════════════════════════════════════╝\n" << std::endl;
            }
        }
    }
    // Check if we should hedge
    else if (current_position_->market_slug == market_slug) {
        double hedge_price;
        
        if (should_hedge(*current_position_, market, hedge_price)) {
            std::string opposite_side = current_position_->side == "UP" ? "DOWN" : "UP";
            
            std::cout << "[SIGNAL] Hedge opportunity: " << opposite_side 
                      << " @ $" << hedge_price << std::endl;
            
            // Execute hedge trade
            auto trade = execute_trade(
                market_slug,
                opposite_side,
                opposite_side == "UP" ? market.up_token_id : market.down_token_id,
                current_position_->shares,
                hedge_price
            );
            
            if (trade) {
                double profit = (1.0 - current_position_->avg_cost - hedge_price) * 
                               current_position_->shares;
                double sum = current_position_->avg_cost + hedge_price;
                
                std::cout << "\n╔══════════════════════════════════════════════════════════╗" << std::endl;
                std::cout << "║  🔴 LEG 2 HEDGE - CYCLE COMPLETE                          ║" << std::endl;
                std::cout << "╠══════════════════════════════════════════════════════════╣" << std::endl;
                std::cout << "║  Leg 1:     " << current_position_->side << " @ $" << std::fixed << std::setprecision(4) << current_position_->avg_cost << std::string(32, ' ') << "║" << std::endl;
                std::cout << "║  Leg 2:     " << opposite_side << " @ $" << std::fixed << std::setprecision(4) << hedge_price << std::string(32, ' ') << "║" << std::endl;
                std::cout << "║  Sum:       $" << std::fixed << std::setprecision(4) << sum << std::string(43, ' ') << "║" << std::endl;
                std::cout << "╠══════════════════════════════════════════════════════════╣" << std::endl;
                if (profit >= 0) {
                    std::cout << "║  💰 PROFIT: +$" << std::fixed << std::setprecision(2) << profit << std::string(41, ' ') << "║" << std::endl;
                } else {
                    std::cout << "║  💸 LOSS:   -$" << std::fixed << std::setprecision(2) << (-profit) << std::string(41, ' ') << "║" << std::endl;
                }
                std::cout << "║  Total P&L: $" << std::fixed << std::setprecision(2) << realized_pnl_ << std::string(43, ' ') << "║" << std::endl;
                std::cout << "║  Cash:      $" << std::fixed << std::setprecision(2) << cash_ << std::string(43, ' ') << "║" << std::endl;
                std::cout << "╚══════════════════════════════════════════════════════════╝\n" << std::endl;
                
                // Clear position
                current_position_.reset();
            }
        }
    }
}

bool TradingEngine::should_enter(
    const MarketState& market,
    std::string& side_out,
    double& price_out
) {
    double up_ask = get_best_ask(market.up_orderbook);
    double down_ask = get_best_ask(market.down_orderbook);
    
    // Check if either side dropped below threshold (0.36)
    if (up_ask < config_.move) {
        side_out = "UP";
        price_out = up_ask;
        return true;
    }
    
    if (down_ask < config_.move) {
        side_out = "DOWN";
        price_out = down_ask;
        return true;
    }
    
    return false;
}

bool TradingEngine::should_hedge(
    const Position& pos,
    const MarketState& market,
    double& price_out
) {
    // Get opposite side ask
    const auto& opposite_book = pos.side == "UP" ? 
        market.down_orderbook : market.up_orderbook;
    
    double opposite_ask = get_best_ask(opposite_book);
    
    // Check if we can hedge profitably
    double sum = pos.avg_cost + opposite_ask;
    
    if (sum <= config_.sum_target) {
        price_out = opposite_ask;
        return true;
    }
    
    return false;
}

std::optional<Trade> TradingEngine::execute_trade(
    const std::string& market_slug,
    const std::string& side,
    const std::string& token_id,
    double shares,
    double price
) {
    // TODO: Implement actual API call to Polymarket
    // For now, simulate the trade
    
    Trade trade{
        .id = "trade_" + std::to_string(
            std::chrono::system_clock::now().time_since_epoch().count()
        ),
        .market_slug = market_slug,
        .leg = current_position_ ? 2 : 1,
        .side = side,
        .token_id = token_id,
        .shares = shares,
        .price = price,
        .cost = shares * price,
        .fee = 0.0,
        .timestamp = std::chrono::system_clock::now()
    };
    
    // Store trade in history
    {
        std::lock_guard<std::mutex> lock(mutex_);
        trade_history_.push_back(trade);
        
        // Update cash balance
        cash_ -= trade.cost;
        
        // If this is leg 2 (hedge), update realized PnL
        if (trade.leg == 2 && current_position_) {
            double profit = (1.0 - current_position_->avg_cost - trade.price) * shares;
            realized_pnl_ += profit;
            cash_ += shares; // Settlement of binary option
        }
    }
    
    return trade;
}

double TradingEngine::get_best_bid(const OrderbookSnapshot& book) const {
    if (book.bids.empty()) return 0.0;
    return book.bids[0].first;
}

double TradingEngine::get_best_ask(const OrderbookSnapshot& book) const {
    if (book.asks.empty()) return 1.0;
    return book.asks[0].first;
}

} // namespace poly

