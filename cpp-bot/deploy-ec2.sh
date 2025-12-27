#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# Poly Trader C++ - EC2 Deployment Script
# For Amazon Linux 2023 with Live Trading Support
# ═══════════════════════════════════════════════════════════════════

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║         POLY TRADER C++ - EC2 DEPLOYMENT SCRIPT                   ║"
echo "║         With Live Trading Support                                  ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_DIR=$(pwd)

# ─── Check if running as appropriate user ───────────────────────────

if [ "$EUID" -eq 0 ]; then
    log_warn "Running as root. Consider running as ec2-user."
fi

# ─── Install system dependencies ─────────────────────────────────────

log_info "Installing system dependencies..."

sudo dnf update -y
sudo dnf install -y \
    gcc-c++ \
    cmake \
    make \
    libcurl-devel \
    openssl-devel \
    boost-devel \
    libpq-devel \
    git \
    python3 \
    python3-pip \
    docker

# ─── Install nlohmann/json ───────────────────────────────────────────

if [ ! -d "/usr/local/include/nlohmann" ]; then
    log_info "Installing nlohmann/json..."
    cd /tmp
    git clone --depth 1 https://github.com/nlohmann/json.git
    sudo mkdir -p /usr/local/include/nlohmann
    sudo cp json/single_include/nlohmann/json.hpp /usr/local/include/nlohmann/
    rm -rf json
    cd "$PROJECT_DIR"
fi

# ─── Install Python dependencies for live trading ───────────────────

log_info "Installing Python dependencies for live trading..."

pip3 install --user py-clob-client web3 eth-account

# Verify installation
if python3 -c "from py_clob_client.client import ClobClient" 2>/dev/null; then
    log_info "✓ py-clob-client installed successfully"
else
    log_error "Failed to install py-clob-client. Live trading won't work."
fi

# ─── Install Node.js 20 via NVM ─────────────────────────────────────

log_info "Checking Node.js installation..."

export NVM_DIR="$HOME/.nvm"
if [ ! -d "$NVM_DIR" ]; then
    log_info "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node &> /dev/null || [[ $(node -v) != v20* ]]; then
    log_info "Installing Node.js 20..."
    nvm install 20
    nvm use 20
    nvm alias default 20
fi

log_info "Node.js version: $(node -v)"

# ─── Install Docker ─────────────────────────────────────────────────

log_info "Checking Docker installation..."

if ! command -v docker &> /dev/null; then
    log_info "Installing Docker..."
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    log_warn "Docker installed. You may need to log out and back in for group changes."
fi

# ─── Start Postgres with Docker ─────────────────────────────────────

log_info "Starting Postgres..."

# Stop existing container if running
docker stop polytrader-postgres 2>/dev/null || true
docker rm polytrader-postgres 2>/dev/null || true

# Start new container
docker run -d \
    --name polytrader-postgres \
    -e POSTGRES_USER=polytrader \
    -e POSTGRES_PASSWORD=polytrader \
    -e POSTGRES_DB=polytrader \
    -p 5432:5432 \
    --restart unless-stopped \
    postgres:15

# Wait for Postgres to be ready
log_info "Waiting for Postgres to be ready..."
for i in {1..30}; do
    if docker exec polytrader-postgres pg_isready -U polytrader &> /dev/null; then
        log_info "Postgres is ready!"
        break
    fi
    sleep 1
done

# ─── Setup environment file ─────────────────────────────────────────

if [ ! -f .env ]; then
    log_info "Creating .env file from template..."
    if [ -f ../env.example ]; then
        cp ../env.example .env
    else
        cat > .env << 'EOF'
DATABASE_URL="postgresql://polytrader:polytrader@localhost:5432/polytrader?schema=public"
DASH_USER="admin"
DASH_PASS="changeme"
INITIAL_BANKROLL=1000
FEE_BPS=0
POLYMARKET_API_URL="https://clob.polymarket.com"
POLYMARKET_GAMMA_URL="https://gamma-api.polymarket.com"

# Live Trading Credentials (REQUIRED for live trading)
POLYMARKET_PRIVATE_KEY=""
POLYMARKET_API_KEY=""
POLYMARKET_SECRET=""
POLYMARKET_PASSPHRASE=""

BOT_PORT=3001
DASHBOARD_PORT=3000
LOG_LEVEL="info"
EOF
    fi
    log_warn "Created .env file. Edit it to add your POLYMARKET_PRIVATE_KEY for live trading!"
fi

# ─── Build C++ Bot ───────────────────────────────────────────────────

log_info "Building C++ bot..."

cd "$PROJECT_DIR"

# Sync header files
if [ -d "../include" ]; then
    cp ../include/*.hpp include/ 2>/dev/null || true
fi

# Sync source files
if [ -d "../src" ]; then
    cp -r ../src/network/*.cpp src/network/ 2>/dev/null || true
    cp -r ../src/engine/*.cpp src/engine/ 2>/dev/null || true
    cp -r ../src/api/*.cpp src/api/ 2>/dev/null || true
    cp ../src/main.cpp src/ 2>/dev/null || true
fi

# Create build directory
mkdir -p build
cd build

# Configure with CMake
cmake ..

# Build
make -j$(nproc)

log_info "✓ C++ bot built successfully"

# ─── Copy Python executor script ─────────────────────────────────────

log_info "Setting up Python order executor..."

mkdir -p "$PROJECT_DIR/scripts"
if [ -f "../../scripts/order_executor.py" ]; then
    cp ../../scripts/order_executor.py "$PROJECT_DIR/scripts/"
    chmod +x "$PROJECT_DIR/scripts/order_executor.py"
fi

# ─── Install Dashboard Dependencies ──────────────────────────────────

log_info "Installing dashboard dependencies..."

cd "$PROJECT_DIR/.."

if [ -f "package.json" ]; then
    npm install
    
    # Build dashboard
    if [ -d "apps/dashboard" ]; then
        npm run build -w apps/dashboard 2>/dev/null || true
    fi
fi

# ─── Install PM2 ────────────────────────────────────────────────────

if ! command -v pm2 &> /dev/null; then
    log_info "Installing PM2..."
    npm install -g pm2
fi

# ─── Create PM2 ecosystem file ──────────────────────────────────────

log_info "Creating PM2 configuration..."

cat > "$PROJECT_DIR/ecosystem.config.cjs" << 'EOF'
module.exports = {
  apps: [
    {
      name: 'poly-trader-cpp',
      script: './build/poly-trader-cpp',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/cpp-error.log',
      out_file: './logs/cpp-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'poly-dashboard',
      script: 'npm',
      args: 'start',
      cwd: __dirname + '/../apps/dashboard',
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: __dirname + '/logs/dashboard-error.log',
      out_file: __dirname + '/logs/dashboard-out.log'
    }
  ]
};
EOF

mkdir -p "$PROJECT_DIR/logs"

# ─── Start applications with PM2 ────────────────────────────────────

log_info "Starting applications with PM2..."

cd "$PROJECT_DIR"
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

# Setup PM2 startup script
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# ─── Check if live trading is available ─────────────────────────────

source .env 2>/dev/null || true

if [ -n "$POLYMARKET_PRIVATE_KEY" ] && [ "$POLYMARKET_PRIVATE_KEY" != "" ]; then
    log_info "✓ POLYMARKET_PRIVATE_KEY is set - Live trading available!"
else
    log_warn "POLYMARKET_PRIVATE_KEY not set - Live trading NOT available"
    log_warn "To enable live trading, add your private key to .env"
fi

# ─── Show status ────────────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                    DEPLOYMENT COMPLETE                             ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""

pm2 status

echo ""
log_info "Dashboard: http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP'):3000"
log_info "Bot API:   http://localhost:3001"
log_info "Health:    http://localhost:3001/health"
echo ""
log_info "Commands:"
log_info "  pm2 logs          - View logs"
log_info "  pm2 restart all   - Restart all services"
log_info "  pm2 stop all      - Stop all services"
echo ""
log_info "To enable live trading:"
log_info "  1. Edit .env and set POLYMARKET_PRIVATE_KEY"
log_info "  2. Restart: pm2 restart poly-trader-cpp"
log_info "  3. In dashboard terminal: mode live"
echo ""
