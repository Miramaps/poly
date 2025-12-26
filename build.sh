#!/bin/bash
set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          POLY TRADER C++ BUILD SCRIPT                         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check for required dependencies
log_info "Checking dependencies..."

if ! command -v cmake &> /dev/null; then
    log_error "cmake not found. Install with: brew install cmake"
    exit 1
fi

if ! command -v g++ &> /dev/null && ! command -v clang++ &> /dev/null; then
    log_error "C++ compiler not found"
    exit 1
fi

# Install dependencies on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    log_info "Detected macOS"
    
    if ! command -v brew &> /dev/null; then
        log_error "Homebrew not found. Install from https://brew.sh"
        exit 1
    fi
    
    log_info "Installing dependencies via Homebrew..."
    brew install boost openssl nlohmann-json libpq curl || true
    
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    log_info "Detected Linux"
    
    log_info "Installing dependencies via apt..."
    sudo apt-get update
    sudo apt-get install -y \
        build-essential \
        cmake \
        libboost-all-dev \
        libssl-dev \
        nlohmann-json3-dev \
        libpq-dev \
        libcurl4-openssl-dev
fi

# Create build directory
log_info "Creating build directory..."
mkdir -p build
cd build

# Configure with CMake
log_info "Configuring with CMake..."
cmake -DCMAKE_BUILD_TYPE=Release ..

# Build
log_info "Building (using all CPU cores)..."
cmake --build . -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# Success
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    BUILD COMPLETE                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Executable: build/poly-trader-cpp"
log_info "Run with: ./build/poly-trader-cpp"
echo ""

