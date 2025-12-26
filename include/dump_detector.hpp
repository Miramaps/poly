#pragma once

#include <vector>
#include <chrono>
#include <optional>
#include <string>

namespace poly {

struct PricePoint {
    double price;
    std::chrono::system_clock::time_point timestamp;
};

struct DumpDetection {
    bool detected;
    std::string side;  // "UP" or "DOWN"
    double drop_pct;
    double from_price;
    double to_price;
};

class DumpDetector {
public:
    explicit DumpDetector(size_t max_window_size = 1000);
    
    void add_price(const std::string& side, double price);
    
    DumpDetection detect_dump(double move_threshold, int window_seconds);
    
    void clear();

private:
    std::vector<PricePoint> up_prices_;
    std::vector<PricePoint> down_prices_;
    size_t max_window_size_;
    
    // Calculate drop percentage in time window
    std::optional<double> calc_drop_pct(
        const std::vector<PricePoint>& prices,
        int window_seconds
    ) const;
    
    // Prune old data points
    void prune_old_data(
        std::vector<PricePoint>& prices,
        int window_seconds
    );
};

} // namespace poly

