#!/bin/bash
set -e

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                  POLY TRADER INITIAL SETUP                         ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"

# Check Node.js version
echo "[INFO] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed. Please install Node.js 20+."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "[ERROR] Node.js 20+ is required. Current version: $(node -v)"
    exit 1
fi
echo "[INFO] Node.js version: $(node -v)"

# Check Docker
echo "[INFO] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "[WARN] Docker is not installed. Postgres will need to be configured manually."
fi

# Create .env if not exists
if [ ! -f .env ]; then
    echo "[INFO] Creating .env from template..."
    if [ -f env.example ]; then
        cp env.example .env
    else
        cat > .env << 'EOF'
DATABASE_URL="postgresql://polytrader:polytrader@localhost:5432/polytrader?schema=public"
DASH_USER="admin"
DASH_PASS="polytrader"
INITIAL_BANKROLL=1000
FEE_BPS=0
BOT_PORT=3001
DASHBOARD_PORT=3000
LOG_LEVEL="info"
EOF
    fi
    echo "[INFO] Created .env file. Edit as needed."
fi

# Install dependencies
echo "[INFO] Installing dependencies..."
npm install

# Generate Prisma client
echo "[INFO] Generating Prisma client..."
npx prisma generate

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║                      SETUP COMPLETE                                ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Start Postgres:     docker-compose up -d postgres"
echo "  2. Push DB schema:     npx prisma db push"
echo "  3. Start development:  ./scripts/start-local.sh"
echo ""
echo "Or run everything:       ./scripts/start-local.sh"
echo ""

