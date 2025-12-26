cmake_minimum_required(VERSION 3.20)
project(PolyTraderCPP VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Optimization flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native -flto -DNDEBUG")
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -Wall -Wextra")

# Find packages
find_package(Boost REQUIRED COMPONENTS system thread)
find_package(OpenSSL REQUIRED)
find_package(PostgreSQL REQUIRED)
find_package(CURL REQUIRED)

# nlohmann_json is header-only
find_package(nlohmann_json QUIET)
if(NOT nlohmann_json_FOUND)
    message(STATUS "nlohmann_json not found via find_package, using system include")
endif()

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/include
    ${Boost_INCLUDE_DIRS}
    ${OPENSSL_INCLUDE_DIR}
    ${PostgreSQL_INCLUDE_DIRS}
)

# Source files  
set(SOURCES
    src/main.cpp
    src/api/api_server.cpp
    src/engine/trading_engine.cpp
    src/engine/dump_detector.cpp
    src/engine/dca_manager.cpp
    src/network/polymarket_client.cpp
    src/network/websocket_client.cpp
    src/database/database.cpp
    src/utils/logger.cpp
)

# Create executable
add_executable(poly-trader-cpp ${SOURCES})

# Link libraries
target_link_libraries(poly-trader-cpp
    ${Boost_LIBRARIES}
    OpenSSL::SSL
    OpenSSL::Crypto
    ${PostgreSQL_LIBRARIES}
    ${CURL_LIBRARIES}
    pthread
)

# Add nlohmann_json if found
if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(poly-trader-cpp nlohmann_json::nlohmann_json)
endif()

# Install
install(TARGETS poly-trader-cpp DESTINATION bin)

