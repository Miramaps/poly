#include "trading_engine.hpp"
#include "polymarket_client.hpp"
#include "async_writer.hpp"
#include "api_server.hpp"
#include <iostream>
#include <iomanip>
#include <sstream>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace poly {
using ::poly::add_log;


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
    
    // Clear all old markets when switching to a new one
    if (active_market_slug_ != slug) {
        markets_.clear();
        
        // Abandon any incomplete cycle from previous market
        if (current_position_) {
            std::cout << "[ENGINE] ⚠️  Abandoning incomplete cycle from: " << current_position_->market_slug << std::endl;
            add_log("warn", "ENGINE", "Abandoning incomplete cycle - market window ended");
            
            // Record as incomplete cycle
            last_completed_cycle_.active = false;
            last_completed_cycle_.status = "incomplete";
            last_completed_cycle_.leg1_side = current_position_->side;
            last_completed_cycle_.leg1_price = current_position_->avg_cost;
            last_completed_cycle_.leg1_shares = current_position_->shares;
            last_completed_cycle_.total_cost = current_position_->total_cost;
            last_completed_cycle_.pnl = -(current_position_->total_cost); // Loss = cost of position
            
            // Update realized PnL (lost the cost of the position)
            realized_pnl_ -= current_position_->total_cost;
            
            current_position_.reset();
        }
        
        std::cout << "[ENGINE] Cleared old markets, switching to: " << slug << std::endl;
    }
    
    active_market_slug_ = slug;
    
    // Initialize market state
    markets_[slug] = MarketState{
        .slug = slug,
        .up_token_id = up_token,
        .down_token_id = down_token,
        .up_orderbook = {},
        .down_orderbook = {},
        .last_update = std::chrono::system_clock::now()
    };
    
    std::cout << "[ENGINE] Active market: " << slug << std::endl;
}

EngineStatus TradingEngine::get_status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    
    EngineStatus status;
    status.running = running_;
    status.mode = (trading_mode_ == TradingMode::LIVE) ? "LIVE" : "PAPER";
    status.cash = cash_;
    status.realized_pnl = realized_pnl_;
    status.config = config_;
    status.market_slug = active_market_slug_;
    
    // Check if live trading is available (private key configured)
    const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
    status.live_trading_available = (pk != nullptr && std::strlen(pk) > 0);
    
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
    
    
    // Populate current cycle
    if (current_position_) {
        status.current_cycle.active = true;
        status.current_cycle.status = "leg1_done";
        status.current_cycle.leg1_side = current_position_->side;
        status.current_cycle.leg1_price = current_position_->avg_cost;
        status.current_cycle.leg1_shares = current_position_->shares;
        status.current_cycle.total_cost = current_position_->total_cost;
    } else {
        status.current_cycle.active = false;
        status.current_cycle.status = "pending";
        // Show last completed cycle if available
        if (!last_completed_cycle_.leg1_side.empty()) {
            status.current_cycle = last_completed_cycle_;
        }
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
    
    // Extract START timestamp from market slug
    int64_t market_start_time = 0;
    size_t last_dash = market_slug.rfind('-');
    if (last_dash != std::string::npos) {
        try { market_start_time = std::stoll(market_slug.substr(last_dash + 1)); } catch (...) {}
    }
    auto now = std::chrono::system_clock::now();
    auto now_sec = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();
    int secs_into_window = static_cast<int>(now_sec - market_start_time);
    int time_left = 900 - secs_into_window;
    
    // Trade in the LAST X seconds of the window (when time_left <= window)
    // NOT the first X seconds!
    if (time_left < 0 || time_left > config_.dump_window_sec) {
        return;  // Not in trading window yet
    }
    
    std::cout << "[ENGINE] 🔥 IN TRADING WINDOW - checking for entry..." << std::endl;
    
    // Check if we should enter a position
    if (!current_position_) {
        // Check cooldown - wait at least 5 seconds between cycles
        auto now_time = std::chrono::system_clock::now();
        auto since_last = std::chrono::duration_cast<std::chrono::seconds>(now_time - last_cycle_complete_time_).count();
        if (since_last < 5) {
            return; // Still in cooldown
        }
        std::string side;
        double price;
        
        if (should_enter(market, side, price)) {
            
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
std::ostringstream oss1;
                oss1 << std::fixed << std::setprecision(4);
                oss1 << "LEG 1 ENTRY: " << side << " x" << (int)trade->shares << " @ $" << trade->price;
                std::string leg1_msg = oss1.str();
                add_log("trade", "ENGINE", leg1_msg);
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
std::ostringstream oss2;
                oss2 << std::fixed << std::setprecision(4);
                oss2 << "LEG 2 HEDGE: " << opposite_side << " @ $" << hedge_price << " | Sum: $" << sum;
                std::string leg2_msg = oss2.str();
                add_log("trade", "ENGINE", leg2_msg);
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
                // Save completed cycle for display
                last_completed_cycle_.active = false;
                last_completed_cycle_.status = "complete";
                last_completed_cycle_.leg1_side = current_position_->side;
                last_completed_cycle_.leg1_price = current_position_->avg_cost;
                last_completed_cycle_.leg1_shares = current_position_->shares;
                last_completed_cycle_.leg2_side = opposite_side;
                last_completed_cycle_.leg2_price = hedge_price;
                last_completed_cycle_.leg2_shares = current_position_->shares;
                last_completed_cycle_.total_cost = current_position_->total_cost + trade->cost;
                last_completed_cycle_.pnl = profit;
                current_position_.reset();
                last_cycle_complete_time_ = std::chrono::system_clock::now();
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
    // Route to appropriate trade execution method
    if (trading_mode_ == TradingMode::LIVE && polymarket_client_) {
        return execute_live_trade(market_slug, side, token_id, shares, price);
    } else {
        return execute_paper_trade(market_slug, side, token_id, shares, price);
    }
}

std::optional<Trade> TradingEngine::execute_paper_trade(
    const std::string& market_slug,
    const std::string& side,
    const std::string& token_id,
    double shares,
    double price
) {
    
    Trade trade{
        .id = "paper_" + std::to_string(
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
        .pnl = 0.0,
        .is_live = false,
        .timestamp = std::chrono::system_clock::now()
    };
    
    // Store trade in history
    {
        std::lock_guard<std::mutex> lock(mutex_);
        trade_history_.push_back(trade);
        
        // Queue for async database write
        if (async_writer_) {
            poly::TradeRecord record{
                .id = trade.id,
                .market_slug = trade.market_slug,
                .leg = trade.leg,
                .side = trade.side,
                .token_id = trade.token_id,
                .shares = trade.shares,
                .price = trade.price,
                .cost = trade.cost,
                .fee = 0.0,
                .timestamp = std::chrono::duration_cast<std::chrono::seconds>(trade.timestamp.time_since_epoch()).count()
            };
            async_writer_->queue_trade(record);
        }
        
        // Update cash balance
        cash_ -= trade.cost;
        
        // If this is leg 2 (hedge), update realized PnL
        if (trade.leg == 2 && current_position_) {
            double profit = (1.0 - current_position_->avg_cost - trade.price) * shares;
            realized_pnl_ += profit;
            trade.pnl = profit;
            cash_ += shares; // Settlement payout
        }
    }
    
    return trade;
}

std::optional<Trade> TradingEngine::execute_live_trade(
    const std::string& market_slug,
    const std::string& side,
    const std::string& token_id,
    double shares,
    double price
) {
    if (!polymarket_client_) {
        std::cerr << "[LIVE] ✗ No Polymarket client configured!" << std::endl;
        add_log("error", "LIVE", "No Polymarket client configured");
        return std::nullopt;
    }
    
    std::cout << "[LIVE] 🔴 Executing LIVE trade: " << side << " " << shares << " @ $" << price << std::endl;
    add_log("warn", "LIVE", "Executing LIVE order: " + side + " x" + std::to_string((int)shares) + " @ $" + std::to_string(price));
    
    // Place order via Polymarket API
    auto result = polymarket_client_->place_order(token_id, side == "UP" ? "BUY" : "BUY", shares, price);
    
    if (!result.success) {
        std::cerr << "[LIVE] ✗ Order failed: " << result.error << std::endl;
        add_log("error", "LIVE", "Order failed: " + result.error);
        return std::nullopt;
    }
    
    Trade trade{
        .id = result.order_id.empty() ? ("live_" + std::to_string(
            std::chrono::system_clock::now().time_since_epoch().count()
        )) : result.order_id,
        .market_slug = market_slug,
        .leg = current_position_ ? 2 : 1,
        .side = side,
        .token_id = token_id,
        .shares = shares,
        .price = result.price > 0 ? result.price : price,
        .cost = shares * (result.price > 0 ? result.price : price),
        .fee = 0.0,
        .pnl = 0.0,
        .is_live = true,
        .timestamp = std::chrono::system_clock::now()
    };
    
    // Store trade in history
    {
        std::lock_guard<std::mutex> lock(mutex_);
        trade_history_.push_back(trade);
        
        // Queue for async database write
        if (async_writer_) {
            poly::TradeRecord record{
                .id = trade.id,
                .market_slug = trade.market_slug,
                .leg = trade.leg,
                .side = trade.side,
                .token_id = trade.token_id,
                .shares = trade.shares,
                .price = trade.price,
                .cost = trade.cost,
                .fee = 0.0,
                .timestamp = std::chrono::duration_cast<std::chrono::seconds>(trade.timestamp.time_since_epoch()).count()
            };
            async_writer_->queue_trade(record);
        }
        
        // Update cash balance (will be synced from Polymarket later)
        cash_ -= trade.cost;
        
        // If this is leg 2 (hedge), update realized PnL
        if (trade.leg == 2 && current_position_) {
            double profit = (1.0 - current_position_->avg_cost - trade.price) * shares;
            realized_pnl_ += profit;
            trade.pnl = profit;
            cash_ += shares; // Settlement payout
        }
    }
    
    std::cout << "[LIVE] ✓ Order placed: " << trade.id << std::endl;
    add_log("info", "LIVE", "Order confirmed: " + trade.id);
    return trade;
}

double TradingEngine::get_best_bid(const OrderbookSnapshot& book) const {
    if (book.bids.empty()) return 0.0;
    // Best bid is the HIGHEST price in the bids (buyers want highest to fill first)
    double max_bid = book.bids[0].first;
    for (const auto& level : book.bids) {
        if (level.first > max_bid) max_bid = level.first;
    }
    return max_bid;
}

double TradingEngine::get_best_ask(const OrderbookSnapshot& book) const {
    if (book.asks.empty()) return 1.0;
    // Best ask is the LOWEST price in the asks (sellers want lowest to fill first)
    double min_ask = book.asks[0].first;
    for (const auto& level : book.asks) {
        if (level.first < min_ask) min_ask = level.first;
    }
    return min_ask;
}

// Config setters
void TradingEngine::set_entry_threshold(double value) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.move = value;
    config_.entry_threshold = value;
    std::cout << "[CONFIG] Entry threshold set to $" << std::fixed << std::setprecision(2) << value << std::endl;
}

void TradingEngine::set_shares(int value) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.shares = value;
    std::cout << "[CONFIG] Shares set to " << value << std::endl;
}

void TradingEngine::set_sum_target(double value) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.sum_target = value;
    std::cout << "[CONFIG] Sum target set to $" << std::fixed << std::setprecision(2) << value << std::endl;
}

void TradingEngine::set_dca_enabled(bool value) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.dca_enabled = value;
    std::cout << "[CONFIG] DCA " << (value ? "ENABLED" : "DISABLED") << std::endl;
}

void TradingEngine::set_trading_window(int seconds) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.dump_window_sec = seconds;
    std::cout << "[CONFIG] Trading window set to " << seconds << "s" << std::endl;
}

Config TradingEngine::get_config() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_;
}


void TradingEngine::set_async_writer(AsyncTradeWriter* writer) {
    async_writer_ = writer;
}

// ============ TRADING MODE CONTROL ============

bool TradingEngine::set_trading_mode(TradingMode mode) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (mode == TradingMode::LIVE) {
        // Check if live trading is available
        const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
        if (!pk || std::strlen(pk) == 0) {
            std::cerr << "[MODE] Cannot enable LIVE trading: No private key configured" << std::endl;
            add_log("error", "MODE", "Cannot enable LIVE trading: No private key configured");
            return false;
        }
        
        trading_mode_ = TradingMode::LIVE;
        std::cout << "[MODE] 🔴 LIVE TRADING ENABLED - Real money trades!" << std::endl;
        add_log("warn", "MODE", "🔴 LIVE TRADING ENABLED - Real money trades!");
        
        // Refresh balance from Polymarket
        if (polymarket_client_) {
            auto balance = polymarket_client_->get_balance();
            if (balance.success) {
                cash_ = balance.balance;
                std::cout << "[MODE] Balance synced: $" << cash_ << " USDC" << std::endl;
                add_log("info", "MODE", "Balance synced: $" + std::to_string(cash_) + " USDC");
            }
        }
    } else {
        trading_mode_ = TradingMode::PAPER;
        std::cout << "[MODE] 📝 Paper trading mode enabled" << std::endl;
        add_log("info", "MODE", "📝 Paper trading mode enabled");
    }
    
    return true;
}

TradingMode TradingEngine::get_trading_mode() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return trading_mode_;
}

std::string TradingEngine::get_trading_mode_string() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return (trading_mode_ == TradingMode::LIVE) ? "LIVE" : "PAPER";
}

bool TradingEngine::is_live_trading_available() const {
    const char* pk = std::getenv("POLYMARKET_PRIVATE_KEY");
    return (pk != nullptr && std::strlen(pk) > 0);
}

void TradingEngine::set_polymarket_client(std::shared_ptr<PolymarketClient> client) {
    std::lock_guard<std::mutex> lock(mutex_);
    polymarket_client_ = client;
    std::cout << "[ENGINE] Polymarket client configured" << std::endl;
}

void TradingEngine::refresh_balance() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (!polymarket_client_) {
        std::cerr << "[ENGINE] Cannot refresh balance: No Polymarket client" << std::endl;
        return;
    }
    
    auto balance = polymarket_client_->get_balance();
    if (balance.success) {
        cash_ = balance.balance;
        std::cout << "[ENGINE] Balance refreshed: $" << cash_ << " USDC" << std::endl;
        add_log("info", "WALLET", "Balance: $" + std::to_string(cash_) + " USDC");
    } else {
        std::cerr << "[ENGINE] Failed to refresh balance: " << balance.error << std::endl;
        add_log("error", "WALLET", "Failed to refresh balance: " + balance.error);
    }
}

void TradingEngine::set_cash(double amount) {
    std::lock_guard<std::mutex> lock(mutex_);
    cash_ = amount;
    std::cout << "[ENGINE] Cash set to $" << amount << std::endl;
}

void TradingEngine::reset_paper_trading() {
    std::lock_guard<std::mutex> lock(mutex_);
    
    // Reset to paper mode
    trading_mode_ = TradingMode::PAPER;
    
    // Reset portfolio
    cash_ = 1000.0;
    realized_pnl_ = 0.0;
    current_position_.reset();
    trade_history_.clear();
    last_completed_cycle_ = CycleStatus{};
    
    std::cout << "[ENGINE] Paper trading reset - Cash: $1000" << std::endl;
    add_log("info", "ENGINE", "Paper trading reset - starting fresh with $1000");
}

} // namespace poly
