#include "polymarket_client.hpp"
#include <curl/curl.h>
#include <stdexcept>
#include <sstream>
#include <iostream>
#include <array>
#include <memory>
#include <cstdio>
#include <cstring>

namespace poly {

namespace {
    size_t write_callback(void* contents, size_t size, size_t nmemb, std::string* userp) {
        userp->append(static_cast<char*>(contents), size * nmemb);
        return size * nmemb;
    }
}

PolymarketClient::PolymarketClient(
    const std::string& api_url,
    const std::string& gamma_url
) : api_url_(api_url), gamma_url_(gamma_url) {
    curl_global_init(CURL_GLOBAL_ALL);
}

void PolymarketClient::set_executor_path(const std::string& path) {
    executor_path_ = path;
}

std::vector<Market> PolymarketClient::get_markets(const std::string& query) {
    std::string url = gamma_url_ + "/markets";
    if (!query.empty()) {
        url += "?query=" + query;
    }
    
    auto response = http_get(url);
    std::vector<Market> markets;
    return markets;
}

Market PolymarketClient::get_market(const std::string& slug) {
    std::string url = gamma_url_ + "/markets/slug/" + slug;
    std::cout << "[POLY] Fetching: " << url << std::endl;
    
    auto response = http_get(url);
    
    Market market;
    market.slug = response.value("slug", "");
    market.condition_id = response.value("conditionId", "");
    market.question = response.value("question", "");
    market.active = response.value("active", false);
    
    if (response.contains("outcomes") && response["outcomes"].is_array()) {
        for (const auto& outcome : response["outcomes"]) {
            market.outcomes.push_back(outcome);
        }
    }
    
    if (response.contains("clobTokenIds")) {
        auto tokens_val = response["clobTokenIds"];
        if (tokens_val.is_string()) {
            try {
                auto tokens = json::parse(tokens_val.get<std::string>());
                if (tokens.is_array()) {
                    for (const auto& t : tokens) {
                        market.token_ids.push_back(t.get<std::string>());
                    }
                }
            } catch (...) {}
        } else if (tokens_val.is_array()) {
            for (const auto& t : tokens_val) {
                market.token_ids.push_back(t.get<std::string>());
            }
        }
    }
    
    return market;
}

Orderbook PolymarketClient::get_orderbook(const std::string& token_id) {
    std::string url = api_url_ + "/book?token_id=" + token_id;
    auto response = http_get(url);
    
    Orderbook book;
    book.asset_id = token_id;
    
    // Handle timestamp as string or number
    if (response.contains("timestamp")) {
        if (response["timestamp"].is_string()) {
            book.timestamp = std::stoull(response["timestamp"].get<std::string>());
        } else {
            book.timestamp = response["timestamp"].get<uint64_t>();
        }
    }
    
    if (response.contains("bids") && response["bids"].is_array()) {
        for (const auto& level : response["bids"]) {
            OrderbookLevel bid;
            // Handle price/size as string or number
            if (level.contains("price")) {
                if (level["price"].is_string()) {
                    bid.price = std::stod(level["price"].get<std::string>());
                } else {
                    bid.price = level["price"].get<double>();
                }
            }
            if (level.contains("size")) {
                if (level["size"].is_string()) {
                    bid.size = std::stod(level["size"].get<std::string>());
                } else {
                    bid.size = level["size"].get<double>();
                }
            }
            book.bids.push_back(bid);
        }
    }
    
    if (response.contains("asks") && response["asks"].is_array()) {
        for (const auto& level : response["asks"]) {
            OrderbookLevel ask;
            if (level.contains("price")) {
                if (level["price"].is_string()) {
                    ask.price = std::stod(level["price"].get<std::string>());
                } else {
                    ask.price = level["price"].get<double>();
                }
            }
            if (level.contains("size")) {
                if (level["size"].is_string()) {
                    ask.size = std::stod(level["size"].get<std::string>());
                } else {
                    ask.size = level["size"].get<double>();
                }
            }
            book.asks.push_back(ask);
        }
    }
    
    return book;
}

// ============ LIVE TRADING FUNCTIONS ============

json PolymarketClient::execute_python(const std::string& args) {
    std::string command = "python3 " + executor_path_ + " " + args + " 2>&1";
    
    std::array<char, 4096> buffer;
    std::string result;
    
    std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(command.c_str(), "r"), pclose);
    if (!pipe) {
        return json{{"success", false}, {"error", "Failed to execute Python script"}};
    }
    
    while (fgets(buffer.data(), buffer.size(), pipe.get()) != nullptr) {
        result += buffer.data();
    }
    
    // Parse JSON response
    try {
        return json::parse(result);
    } catch (const json::exception& e) {
        return json{
            {"success", false}, 
            {"error", "Failed to parse Python response: " + result}
        };
    }
}

OrderResult PolymarketClient::place_order(
    const std::string& token_id,
    const std::string& side,
    double size,
    double price
) {
    std::ostringstream cmd;
    cmd << "place --token \"" << token_id << "\" "
        << "--side " << side << " "
        << "--size " << size << " "
        << "--price " << price;
    
    std::cout << "[LIVE] Placing order: " << side << " " << size 
              << " @ $" << price << std::endl;
    
    auto response = execute_python(cmd.str());
    
    OrderResult result;
    result.success = response.value("success", false);
    result.order_id = response.value("order_id", "");
    result.status = response.value("status", "");
    result.filled_amount = response.value("size", 0.0);
    result.price = response.value("price", price);
    result.error = response.value("error", "");
    
    if (result.success) {
        std::cout << "[LIVE] ✓ Order placed: " << result.order_id << std::endl;
    } else {
        std::cerr << "[LIVE] ✗ Order failed: " << result.error << std::endl;
    }
    
    return result;
}

OrderResult PolymarketClient::place_market_order(
    const std::string& token_id,
    const std::string& side,
    double size
) {
    std::ostringstream cmd;
    cmd << "market --token \"" << token_id << "\" "
        << "--side " << side << " "
        << "--size " << size;
    
    std::cout << "[LIVE] Placing market order: " << side << " " << size << std::endl;
    
    auto response = execute_python(cmd.str());
    
    OrderResult result;
    result.success = response.value("success", false);
    result.order_id = response.value("order_id", "");
    result.status = response.value("status", "");
    result.filled_amount = response.value("filled_size", response.value("size", 0.0));
    result.price = response.value("price", 0.0);
    result.error = response.value("error", "");
    
    if (result.success) {
        std::cout << "[LIVE] ✓ Market order filled: " << result.order_id 
                  << " @ $" << result.price << std::endl;
    } else {
        std::cerr << "[LIVE] ✗ Market order failed: " << result.error << std::endl;
    }
    
    return result;
}

bool PolymarketClient::cancel_order(const std::string& order_id) {
    std::ostringstream cmd;
    cmd << "cancel --order-id \"" << order_id << "\"";
    
    auto response = execute_python(cmd.str());
    return response.value("success", false);
}

bool PolymarketClient::cancel_all_orders() {
    auto response = execute_python("cancel-all");
    return response.value("success", false);
}

BalanceResult PolymarketClient::get_balance() {
    auto response = execute_python("balance");
    
    BalanceResult result;
    result.success = response.value("success", false);
    result.balance = response.value("balance", 0.0);
    result.currency = response.value("currency", "USDC");
    result.error = response.value("error", "");
    
    return result;
}

PositionsResult PolymarketClient::get_positions() {
    auto response = execute_python("positions");
    
    PositionsResult result;
    result.success = response.value("success", false);
    result.error = response.value("error", "");
    
    if (response.contains("positions") && response["positions"].is_array()) {
        for (const auto& pos : response["positions"]) {
            Position p;
            p.token_id = pos.value("token_id", "");
            p.size = pos.value("size", 0.0);
            p.avg_price = pos.value("avg_price", 0.0);
            result.positions.push_back(p);
        }
    }
    
    return result;
}

bool PolymarketClient::is_live_trading_available() const {
    // Check if required environment variables are set
    const char* private_key = std::getenv("POLYMARKET_PRIVATE_KEY");
    return private_key != nullptr && std::strlen(private_key) > 0;
}

json PolymarketClient::http_get(const std::string& url) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to initialize CURL");
    }
    
    std::string response_data;
    
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_data);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "PolyTrader/1.0");
    
    CURLcode res = curl_easy_perform(curl);
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
    curl_easy_cleanup(curl);
    
    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("CURL error: ") + curl_easy_strerror(res));
    }
    
    if (http_code != 200) {
        throw std::runtime_error("HTTP error: " + std::to_string(http_code));
    }
    
    return json::parse(response_data);
}

json PolymarketClient::http_post(const std::string& url, const json& body) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to initialize CURL");
    }
    
    std::string response_data;
    std::string post_data = body.dump();
    
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, post_data.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_data);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
    
    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("CURL error: ") + curl_easy_strerror(res));
    }
    
    return json::parse(response_data);
}

} // namespace poly
