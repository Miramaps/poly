#pragma once

#include <string>
#include <iostream>
#include <fstream>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <sstream>

namespace poly {

enum class LogLevel {
    DEBUG,
    INFO,
    WARN,
    ERROR,
    FATAL
};

class Logger {
public:
    static Logger& instance() {
        static Logger logger;
        return logger;
    }
    
    void set_level(LogLevel level) {
        level_ = level;
    }
    
    void set_file(const std::string& filename) {
        std::lock_guard<std::mutex> lock(mutex_);
        file_.open(filename, std::ios::app);
    }
    
    template<typename... Args>
    void log(LogLevel level, Args&&... args) {
        if (level < level_) return;
        
        std::lock_guard<std::mutex> lock(mutex_);
        
        auto now = std::chrono::system_clock::now();
        auto time = std::chrono::system_clock::to_time_t(now);
        
        std::ostringstream oss;
        oss << std::put_time(std::localtime(&time), "%Y-%m-%d %H:%M:%S");
        oss << " [" << level_to_string(level) << "] ";
        
        (oss << ... << args);
        
        std::string msg = oss.str();
        
        std::cout << msg << std::endl;
        
        if (file_.is_open()) {
            file_ << msg << std::endl;
            file_.flush();
        }
    }
    
    template<typename... Args>
    void debug(Args&&... args) { log(LogLevel::DEBUG, std::forward<Args>(args)...); }
    
    template<typename... Args>
    void info(Args&&... args) { log(LogLevel::INFO, std::forward<Args>(args)...); }
    
    template<typename... Args>
    void warn(Args&&... args) { log(LogLevel::WARN, std::forward<Args>(args)...); }
    
    template<typename... Args>
    void error(Args&&... args) { log(LogLevel::ERROR, std::forward<Args>(args)...); }
    
    template<typename... Args>
    void fatal(Args&&... args) { log(LogLevel::FATAL, std::forward<Args>(args)...); }

private:
    Logger() : level_(LogLevel::INFO) {}
    
    std::string level_to_string(LogLevel level) {
        switch (level) {
            case LogLevel::DEBUG: return "DEBUG";
            case LogLevel::INFO:  return "INFO";
            case LogLevel::WARN:  return "WARN";
            case LogLevel::ERROR: return "ERROR";
            case LogLevel::FATAL: return "FATAL";
        }
        return "UNKNOWN";
    }
    
    LogLevel level_;
    std::ofstream file_;
    std::mutex mutex_;
};

} // namespace poly

