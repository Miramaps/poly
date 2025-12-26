#include "dump_detector.hpp"
#include <algorithm>
#include <cmath>

namespace poly {

DumpDetector::DumpDetector(size_t max_window_size)
    : max_window_size_(max_window_size) {
}

void DumpDetector::add_price(const std::string& side, double price) {
    auto now = std::chrono::system_clock::now();
    
    if (side == "UP") {
        up_prices_.push_back({price, now});
        if (up_prices_.size() > max_window_size_) {
            up_prices_.erase(up_prices_.begin());
        }
    } else if (side == "DOWN") {
        down_prices_.push_back({price, now});
        if (down_prices_.size() > max_window_size_) {
            down_prices_.erase(down_prices_.begin());
        }
    }
}

DumpDetection DumpDetector::detect_dump(double move_threshold, int window_seconds) {
    // Prune old data
    prune_old_data(up_prices_, window_seconds);
    prune_old_data(down_prices_, window_seconds);
    
    // Calculate drops for both sides
    auto up_drop = calc_drop_pct(up_prices_, window_seconds);
    auto down_drop = calc_drop_pct(down_prices_, window_seconds);
    
    // Find which side dropped more
    std::string detected_side;
    double max_drop = 0.0;
    double from_price = 0.0;
    double to_price = 0.0;
    
    if (up_drop && *up_drop > max_drop) {
        max_drop = *up_drop;
        detected_side = "UP";
        if (!up_prices_.empty()) {
            to_price = up_prices_.back().price;
            from_price = to_price / (1.0 - max_drop);
        }
    }
    
    if (down_drop && *down_drop > max_drop) {
        max_drop = *down_drop;
        detected_side = "DOWN";
        if (!down_prices_.empty()) {
            to_price = down_prices_.back().price;
            from_price = to_price / (1.0 - max_drop);
        }
    }
    
    bool detected = max_drop >= move_threshold;
    
    return DumpDetection{
        .detected = detected,
        .side = detected_side,
        .drop_pct = max_drop,
        .from_price = from_price,
        .to_price = to_price
    };
}

void DumpDetector::clear() {
    up_prices_.clear();
    down_prices_.clear();
}

std::optional<double> DumpDetector::calc_drop_pct(
    const std::vector<PricePoint>& prices,
    int window_seconds
) const {
    if (prices.empty()) return std::nullopt;
    
    auto now = std::chrono::system_clock::now();
    auto cutoff = now - std::chrono::seconds(window_seconds);
    
    // Find max price in window
    double max_price = 0.0;
    double current_price = prices.back().price;
    
    for (auto it = prices.rbegin(); it != prices.rend(); ++it) {
        if (it->timestamp < cutoff) break;
        max_price = std::max(max_price, it->price);
    }
    
    if (max_price <= 0.0) return std::nullopt;
    
    // Calculate percentage drop
    double drop_pct = (max_price - current_price) / max_price;
    
    return drop_pct > 0.0 ? std::optional<double>(drop_pct) : std::nullopt;
}

void DumpDetector::prune_old_data(
    std::vector<PricePoint>& prices,
    int window_seconds
) {
    auto now = std::chrono::system_clock::now();
    auto cutoff = now - std::chrono::seconds(window_seconds * 2); // Keep 2x window
    
    auto it = std::find_if(prices.begin(), prices.end(),
        [cutoff](const PricePoint& p) { return p.timestamp >= cutoff; });
    
    if (it != prices.begin()) {
        prices.erase(prices.begin(), it);
    }
}

} // namespace poly

