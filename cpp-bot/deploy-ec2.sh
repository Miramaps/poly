#!/bin/bash
set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          POLY TRADER C++ EC2 DEPLOYMENT                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Configuration
EC2_HOST="18.175.223.104"
EC2_USER="ec2-user"
SSH_KEY="$HOME/Downloads/liquiditysweep-london.pem"
REMOTE_DIR="~/poly-trader-cpp"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }

# Sync files to EC2
log_info "Syncing files to EC2..."
rsync -avz --delete \
    --exclude 'build/' \
    --exclude '.git/' \
    -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
    ./ ${EC2_USER}@${EC2_HOST}:${REMOTE_DIR}/

# Build and run on EC2
log_info "Building on EC2..."
ssh -i $SSH_KEY ${EC2_USER}@${EC2_HOST} << 'EOF'
cd ~/poly-trader-cpp

# Create logs directory
mkdir -p logs

# Install dependencies on Amazon Linux 2023
echo "Installing build dependencies..."
sudo dnf install -y gcc-c++ cmake boost-devel openssl-devel postgresql-devel libcurl-devel wget 2>/dev/null || true

# Install nlohmann-json manually if not in repos
if [ ! -f /usr/local/include/nlohmann/json.hpp ]; then
    echo "Installing nlohmann/json..."
    wget -q https://github.com/nlohmann/json/releases/download/v3.11.2/json.hpp
    sudo mkdir -p /usr/local/include/nlohmann
    sudo mv json.hpp /usr/local/include/nlohmann/
fi

# Build
echo "Building C++ bot..."
mkdir -p build
cd build
cmake -DCMAKE_BUILD_TYPE=Release .. 2>&1
cmake --build . -j$(nproc) 2>&1
cd ..

# Stop existing process
pkill -f poly-trader-cpp 2>/dev/null || true
sleep 1

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    cat > .env << 'ENVEOF'
DATABASE_URL="postgresql://polytrader:polytrader@localhost:5432/polytrader"
DASH_USER="admin"
DASH_PASS="sexmachine666"
# Set your market tokens below:
# MARKET_SLUG="your-market-slug"
# UP_TOKEN_ID="your-up-token-id"
# DOWN_TOKEN_ID="your-down-token-id"
ENVEOF
    echo "Created .env file - edit it to add market tokens!"
fi

# Source environment variables
set -a
source .env 2>/dev/null || true
set +a

# Start in background with nohup
echo "Starting C++ trading bot..."
nohup env $(cat .env 2>/dev/null | grep -v '^#' | xargs) ./build/poly-trader-cpp > logs/cpp-bot.log 2>&1 &
sleep 2

# Show status
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
ps aux | grep poly-trader-cpp | grep -v grep || echo "Process not running!"
echo ""
tail -20 logs/cpp-bot.log 2>/dev/null || echo "No logs yet"
EOF

log_info "Deployment complete!"
echo ""
echo "To view logs: ssh -i $SSH_KEY ${EC2_USER}@${EC2_HOST} 'tail -f ~/poly-trader-cpp/logs/cpp-bot.log'"
echo ""

