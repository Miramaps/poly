cmake_minimum_required(VERSION 3.16)
project(poly-trader-cpp VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find packages
find_package(Threads REQUIRED)
find_package(CURL REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(Boost 1.70 REQUIRED COMPONENTS system)
find_package(PostgreSQL REQUIRED)

# Add nlohmann json as system include
include_directories(SYSTEM /usr/include)

# Source files
set(SOURCES
    src/main.cpp
    src/api/api_server.cpp
    src/database/database.cpp
    src/database/async_writer.cpp
    src/engine/trading_engine.cpp
    src/engine/dump_detector.cpp
    src/engine/dca_manager.cpp
    src/network/polymarket_client.cpp
    src/network/websocket_client.cpp
    src/network/ws_server.cpp
    src/utils/logger.cpp
)

# Create executable
add_executable(poly-trader-cpp ${SOURCES})

# Include directories
target_include_directories(poly-trader-cpp PRIVATE 
    ${CMAKE_SOURCE_DIR}/include
    ${CURL_INCLUDE_DIRS}
    ${PostgreSQL_INCLUDE_DIRS}
    ${Boost_INCLUDE_DIRS}
)

# Link libraries
target_link_libraries(poly-trader-cpp PRIVATE
    Threads::Threads
    ${CURL_LIBRARIES}
    PostgreSQL::PostgreSQL
    ${Boost_LIBRARIES}
    OpenSSL::SSL
    OpenSSL::Crypto
)

# Compiler flags
target_compile_options(poly-trader-cpp PRIVATE -Wall -Wextra -O2)
