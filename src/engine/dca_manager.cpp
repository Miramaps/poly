#include <vector>
#include <string>

namespace poly {

// DCA (Dollar Cost Averaging) Manager
// Handles multiple entry levels for scaling into positions

class DCAManager {
public:
    struct Level {
        double price;
        double shares;
        bool executed;
    };
    
    explicit DCAManager(const std::vector<double>& levels, double base_shares, double multiplier)
        : base_shares_(base_shares)
        , multiplier_(multiplier) {
        
        for (double price : levels) {
            levels_.push_back({price, 0.0, false});
        }
        
        calculate_shares();
    }
    
    // Check if we should execute a DCA level
    bool should_execute(double current_price, Level& level_out) {
        for (auto& level : levels_) {
            if (!level.executed && current_price <= level.price) {
                level_out = level;
                return true;
            }
        }
        return false;
    }
    
    // Mark a level as executed
    void mark_executed(double price) {
        for (auto& level : levels_) {
            if (level.price == price) {
                level.executed = true;
                break;
            }
        }
    }
    
    // Get total shares across all levels
    double total_shares() const {
        double total = 0.0;
        for (const auto& level : levels_) {
            if (level.executed) {
                total += level.shares;
            }
        }
        return total;
    }
    
    // Get average entry price
    double average_price() const {
        double total_cost = 0.0;
        double total_shares = 0.0;
        
        for (const auto& level : levels_) {
            if (level.executed) {
                total_cost += level.price * level.shares;
                total_shares += level.shares;
            }
        }
        
        return total_shares > 0.0 ? total_cost / total_shares : 0.0;
    }

private:
    std::vector<Level> levels_;
    double base_shares_;
    double multiplier_;
    
    void calculate_shares() {
        double current_shares = base_shares_;
        
        for (auto& level : levels_) {
            level.shares = current_shares;
            current_shares *= multiplier_;
        }
    }
};

} // namespace poly

