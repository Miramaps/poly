#include "database.hpp"
#include <iostream>
#include <sstream>

namespace poly {

Database::Database(const std::string& connection_string)
    : connection_string_(connection_string) {
}

Database::~Database() {
    disconnect();
}

Database::Database(Database&& other) noexcept
    : connection_string_(std::move(other.connection_string_))
    , conn_(other.conn_) {
    other.conn_ = nullptr;
}

Database& Database::operator=(Database&& other) noexcept {
    if (this != &other) {
        disconnect();
        connection_string_ = std::move(other.connection_string_);
        conn_ = other.conn_;
        other.conn_ = nullptr;
    }
    return *this;
}

bool Database::connect() {
    conn_ = PQconnectdb(connection_string_.c_str());
    
    if (PQstatus(conn_) != CONNECTION_OK) {
        std::cerr << "[DB] Connection failed: " << PQerrorMessage(conn_) << std::endl;
        PQfinish(conn_);
        conn_ = nullptr;
        return false;
    }
    
    std::cout << "[DB] Connected to PostgreSQL" << std::endl;
    return true;
}

void Database::disconnect() {
    if (conn_) {
        PQfinish(conn_);
        conn_ = nullptr;
        std::cout << "[DB] Disconnected" << std::endl;
    }
}

bool Database::check_connection() {
    if (!conn_ || PQstatus(conn_) != CONNECTION_OK) {
        return connect();
    }
    return true;
}

bool Database::ensure_market_exists(const std::string& slug, const std::string& title) {
    if (!check_connection()) return false;
    
    // Use INSERT ... ON CONFLICT DO NOTHING (upsert)
    std::ostringstream query;
    query << "INSERT INTO markets (id, slug, question, status, created_at, updated_at) "
          << "VALUES ("
          << "'" << slug << "', "  // Use slug as id
          << "'" << slug << "', "
          << "'" << (title.empty() ? slug : title) << "', "
          << "'live', "
          << "NOW(), NOW()) "
          << "ON CONFLICT (slug) DO NOTHING";
    
    return execute(query.str());
}

bool Database::insert_trade(const TradeRecord& trade) {
    if (!check_connection()) return false;
    
    // Ensure market exists first (for foreign key)
    ensure_market_exists(trade.market_slug);
    
    std::ostringstream query;
    query << "INSERT INTO trades (id, market_slug, leg, side, token_id, shares, price, cost, fee, cash_after, ts) "
          << "VALUES ("
          << "'" << trade.id << "', "
          << "'" << trade.market_slug << "', "
          << trade.leg << ", "
          << "'" << trade.side << "', "
          << "'" << trade.token_id << "', "
          << trade.shares << ", "
          << trade.price << ", "
          << trade.cost << ", "
          << trade.fee << ", "
          << "0, "  // cash_after placeholder
          << "to_timestamp(" << trade.timestamp << "))";
    
    return execute(query.str());
}

std::vector<TradeRecord> Database::get_trades(const std::string& market_slug) {
    std::vector<TradeRecord> trades;
    
    if (!check_connection()) return trades;
    
    std::ostringstream query;
    query << "SELECT id, market_slug, leg, side, token_id, shares, price, cost, fee, "
          << "EXTRACT(EPOCH FROM timestamp) as timestamp "
          << "FROM trades WHERE market_slug = '" << market_slug << "' "
          << "ORDER BY timestamp DESC";
    
    PGresult* res = PQexec(conn_, query.str().c_str());
    
    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        int rows = PQntuples(res);
        
        for (int i = 0; i < rows; i++) {
            TradeRecord trade;
            trade.id = PQgetvalue(res, i, 0);
            trade.market_slug = PQgetvalue(res, i, 1);
            trade.leg = std::stoi(PQgetvalue(res, i, 2));
            trade.side = PQgetvalue(res, i, 3);
            trade.token_id = PQgetvalue(res, i, 4);
            trade.shares = std::stod(PQgetvalue(res, i, 5));
            trade.price = std::stod(PQgetvalue(res, i, 6));
            trade.cost = std::stod(PQgetvalue(res, i, 7));
            trade.fee = std::stod(PQgetvalue(res, i, 8));
            trade.timestamp = std::stoll(PQgetvalue(res, i, 9));
            
            trades.push_back(trade);
        }
    }
    
    PQclear(res);
    return trades;
}

bool Database::insert_cycle(const CycleRecord& cycle) {
    if (!check_connection()) return false;
    
    std::ostringstream query;
    query << "INSERT INTO cycles (id, market_slug, started_at, status) "
          << "VALUES ("
          << "'" << cycle.id << "', "
          << "'" << cycle.market_slug << "', "
          << "to_timestamp(" << cycle.started_at << "), "
          << "'" << cycle.status << "')";
    
    return execute(query.str());
}

bool Database::update_cycle(const CycleRecord& cycle) {
    if (!check_connection()) return false;
    
    std::ostringstream query;
    query << "UPDATE cycles SET status = '" << cycle.status << "'";
    
    if (cycle.ended_at) {
        query << ", ended_at = to_timestamp(" << *cycle.ended_at << ")";
    }
    if (cycle.leg1_side) {
        query << ", leg1_side = '" << *cycle.leg1_side << "'";
    }
    if (cycle.leg1_price) {
        query << ", leg1_price = " << *cycle.leg1_price;
    }
    if (cycle.leg2_price) {
        query << ", leg2_price = " << *cycle.leg2_price;
    }
    if (cycle.locked_in_profit) {
        query << ", locked_in_profit = " << *cycle.locked_in_profit;
    }
    
    query << " WHERE id = '" << cycle.id << "'";
    
    return execute(query.str());
}

bool Database::execute(const std::string& query) {
    if (!check_connection()) return false;
    
    PGresult* res = PQexec(conn_, query.c_str());
    ExecStatusType status = PQresultStatus(res);
    
    bool success = (status == PGRES_COMMAND_OK || status == PGRES_TUPLES_OK);
    
    if (!success) {
        std::cerr << "[DB] Query failed: " << PQerrorMessage(conn_) << std::endl;
        std::cerr << "[DB] Query: " << query << std::endl;
    }
    
    PQclear(res);
    return success;
}

} // namespace poly

