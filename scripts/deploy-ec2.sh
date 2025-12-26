#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# Poly Trader EC2 Deployment Script
# For Amazon Linux 2023
# ═══════════════════════════════════════════════════════════════════

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                POLY TRADER DEPLOYMENT SCRIPT                       ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── Check if running as appropriate user ───────────────────────────

if [ "$EUID" -eq 0 ]; then
    log_warn "Running as root. Consider running as ec2-user."
fi

# ─── Install Node.js 20 via NVM ─────────────────────────────────────

log_info "Checking Node.js installation..."

if ! command -v nvm &> /dev/null; then
    log_info "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Source NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node &> /dev/null || [[ $(node -v) != v20* ]]; then
    log_info "Installing Node.js 20..."
    nvm install 20
    nvm use 20
    nvm alias default 20
fi

log_info "Node.js version: $(node -v)"
log_info "npm version: $(npm -v)"

# ─── Install Docker ─────────────────────────────────────────────────

log_info "Checking Docker installation..."

if ! command -v docker &> /dev/null; then
    log_info "Installing Docker..."
    sudo dnf update -y
    sudo dnf install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    log_warn "Docker installed. You may need to log out and back in for group changes."
fi

# ─── Install Docker Compose ─────────────────────────────────────────

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    log_info "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# ─── Install PM2 ────────────────────────────────────────────────────

log_info "Checking PM2 installation..."

if ! command -v pm2 &> /dev/null; then
    log_info "Installing PM2..."
    npm install -g pm2
fi

# ─── Create logs directory ──────────────────────────────────────────

mkdir -p logs

# ─── Setup environment file ─────────────────────────────────────────

if [ ! -f .env ]; then
    log_info "Creating .env file from template..."
    if [ -f env.example ]; then
        cp env.example .env
        log_warn "Please edit .env file with your configuration!"
    else
        cat > .env << 'EOF'
DATABASE_URL="postgresql://polytrader:polytrader@localhost:5432/polytrader?schema=public"
DASH_USER="admin"
DASH_PASS="changeme"
INITIAL_BANKROLL=1000
FEE_BPS=0
POLYMARKET_API_URL="https://clob.polymarket.com"
POLYMARKET_GAMMA_URL="https://gamma-api.polymarket.com"
BOT_PORT=3001
DASHBOARD_PORT=3000
LOG_LEVEL="info"
EOF
        log_warn "Created default .env file. Please edit with secure credentials!"
    fi
fi

# ─── Start Postgres with Docker Compose ─────────────────────────────

log_info "Starting Postgres..."
docker-compose up -d postgres

# Wait for Postgres to be ready
log_info "Waiting for Postgres to be ready..."
sleep 5

for i in {1..30}; do
    if docker-compose exec -T postgres pg_isready -U polytrader &> /dev/null; then
        log_info "Postgres is ready!"
        break
    fi
    sleep 1
done

# ─── Install dependencies ───────────────────────────────────────────

log_info "Installing npm dependencies..."
npm install

# ─── Generate Prisma client ─────────────────────────────────────────

log_info "Generating Prisma client..."
npx prisma generate

# ─── Push database schema ───────────────────────────────────────────

log_info "Pushing database schema..."
npx prisma db push

# ─── Build applications ─────────────────────────────────────────────

log_info "Building shared package..."
npm run build -w packages/shared

log_info "Building bot..."
npm run build -w apps/bot

log_info "Building dashboard..."
npm run build -w apps/dashboard

# ─── Start applications with PM2 ────────────────────────────────────

log_info "Starting applications with PM2..."
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.cjs

# Save PM2 process list
pm2 save

# Setup PM2 startup script
log_info "Setting up PM2 startup..."
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# ─── Show status ────────────────────────────────────────────────────

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                    DEPLOYMENT COMPLETE                             ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""

pm2 status

echo ""
log_info "Dashboard: http://localhost:3000"
log_info "Bot API:   http://localhost:3001"
log_info "Health:    http://localhost:3001/health"
echo ""
log_info "To view logs: pm2 logs"
log_info "To stop:      pm2 stop all"
log_info "To restart:   pm2 restart all"
echo ""


