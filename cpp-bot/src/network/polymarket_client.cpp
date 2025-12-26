#include "polymarket_client.hpp"
#include <curl/curl.h>
#include <stdexcept>
#include <sstream>

namespace poly {

namespace {
    // CURL write callback
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

std::vector<Market> PolymarketClient::get_markets(const std::string& query) {
    std::string url = gamma_url_ + "/markets";
    if (!query.empty()) {
        url += "?query=" + query;
    }
    
    auto response = http_get(url);
    
    std::vector<Market> markets;
    
    if (response.contains("data") && response["data"].is_array()) {
        for (const auto& item : response["data"]) {
            Market market;
            market.slug = item.value("slug", "");
            market.condition_id = item.value("condition_id", "");
            market.question = item.value("question", "");
            market.active = item.value("active", false);
            
            if (item.contains("outcomes") && item["outcomes"].is_array()) {
                for (const auto& outcome : item["outcomes"]) {
                    market.outcomes.push_back(outcome);
                }
            }
            
            if (item.contains("tokens") && item["tokens"].is_array()) {
                for (const auto& token : item["tokens"]) {
                    if (token.contains("token_id")) {
                        market.token_ids.push_back(token["token_id"]);
                    }
                }
            }
            
            markets.push_back(market);
        }
    }
    
    return markets;
}

Market PolymarketClient::get_market(const std::string& slug) {
    std::string url = gamma_url_ + "/markets/" + slug;
    auto response = http_get(url);
    
    Market market;
    market.slug = response.value("slug", "");
    market.condition_id = response.value("condition_id", "");
    market.question = response.value("question", "");
    market.active = response.value("active", false);
    
    if (response.contains("outcomes") && response["outcomes"].is_array()) {
        for (const auto& outcome : response["outcomes"]) {
            market.outcomes.push_back(outcome);
        }
    }
    
    if (response.contains("tokens") && response["tokens"].is_array()) {
        for (const auto& token : response["tokens"]) {
            if (token.contains("token_id")) {
                market.token_ids.push_back(token["token_id"]);
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
    book.timestamp = response.value("timestamp", 0ULL);
    
    if (response.contains("bids") && response["bids"].is_array()) {
        for (const auto& level : response["bids"]) {
            OrderbookLevel bid;
            bid.price = std::stod(level.value("price", "0"));
            bid.size = std::stod(level.value("size", "0"));
            book.bids.push_back(bid);
        }
    }
    
    if (response.contains("asks") && response["asks"].is_array()) {
        for (const auto& level : response["asks"]) {
            OrderbookLevel ask;
            ask.price = std::stod(level.value("price", "0"));
            ask.size = std::stod(level.value("size", "0"));
            book.asks.push_back(ask);
        }
    }
    
    return book;
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
    
    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);
    
    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("CURL error: ") + curl_easy_strerror(res));
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

