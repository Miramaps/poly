# 💎 Poly Trader

A production-quality **paper trading bot** for Polymarket's Bitcoin Up/Down 15-minute markets, with a full-featured web dashboard.

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   ██████╗  ██████╗ ██╗  ██╗   ██╗    ████████╗██████╗  █████╗    ║
║   ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝    ╚══██╔══╝██╔══██╝██╔══██╗   ║
║   ██████╔╝██║   ██║██║   ╚████╔╝        ██║   ██████╔╝███████║   ║
║   ██╔═══╝ ██║   ██║██║    ╚██╔╝         ██║   ██╔══██╗██╔══██║   ║
║   ██║     ╚██████╔╝███████╗██║          ██║   ██║  ██║██║  ██║   ║
║   ╚═╝      ╚═════╝ ╚══════╝╚═╝          ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ║
║                                                                   ║
║              Polymarket Paper Trading Bot + Dashboard              ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

## 📋 Overview

This bot implements a 2-leg "dump then hedge" strategy on Polymarket's Bitcoin Up/Down 15-minute markets:

1. **Leg 1 (Dump Detection)**: During the first `windowMin` minutes of a round, watch for rapid price drops. When either UP or DOWN drops by at least `move%` within `dumpWindowSec` seconds, buy shares of the dumped side.

2. **Leg 2 (Hedge)**: After Leg 1, wait for the opposite side's price to become favorable. When `leg1Price + oppositeAsk <= sumTarget`, buy shares of the opposite side.

3. **Locked Profit**: Once both legs execute, you hold equal shares of both UP and DOWN. Since one will pay $1 and you spent less than $1 total, profit is guaranteed.

## 🏗️ Architecture

```
poly-trader/
├── apps/
│   ├── bot/                 # Node.js trading bot + API
│   │   ├── src/
│   │   │   ├── core/        # Trading engine, execution, detection
│   │   │   ├── api/         # Fastify REST + WebSocket server
│   │   │   ├── services/    # Database, WebSocket, market discovery
│   │   │   └── cli.ts       # CLI interface
│   │   └── package.json
│   │
│   └── dashboard/           # Next.js web dashboard
│       ├── src/
│       │   ├── app/         # Pages (overview, cycles, trades, terminal)
│       │   ├── components/  # React components
│       │   ├── hooks/       # Custom hooks (WebSocket)
│       │   └── lib/         # Utilities, API client
│       └── package.json
│
├── packages/
│   └── shared/              # Shared types, schemas, command parser
│
├── prisma/
│   └── schema.prisma        # Database schema
│
├── scripts/
│   ├── setup.sh             # Initial setup
│   ├── start-local.sh       # Local development
│   └── deploy-ec2.sh        # EC2 deployment
│
├── docker-compose.yml       # Postgres container
├── ecosystem.config.cjs     # PM2 configuration
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Postgres)
- npm 9+

### Local Development

```bash
# 1. Clone and enter directory
cd poly-trader

# 2. Run setup
chmod +x scripts/*.sh
./scripts/setup.sh

# 3. Start everything (Postgres + Bot + Dashboard)
./scripts/start-local.sh
```

The dashboard will be available at **http://localhost:3000** and the bot API at **http://localhost:3001**.

### Manual Setup

```bash
# Install dependencies
npm install

# Start Postgres
docker-compose up -d postgres

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Build shared package
npm run build -w packages/shared

# Start bot (in one terminal)
npm run dev -w apps/bot

# Start dashboard (in another terminal)
npm run dev -w apps/dashboard
```

## 🖥️ EC2 Deployment

### One-Command Deploy

SSH into your EC2 instance and run:

```bash
# Clone repository
git clone <your-repo> poly-trader
cd poly-trader

# Make scripts executable
chmod +x scripts/*.sh

# Deploy everything
./scripts/deploy-ec2.sh
```

The script will:
1. Install Node.js 20 via NVM
2. Install Docker and Docker Compose
3. Install PM2
4. Start Postgres
5. Build and start all services

### Manual EC2 Setup

```bash
# Install NVM and Node.js 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

# Install Docker (Amazon Linux 2023)
sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install PM2
npm install -g pm2

# Clone and setup
git clone <your-repo> poly-trader
cd poly-trader
npm install

# Configure
cp env.example .env
# Edit .env with your settings

# Start Postgres
docker-compose up -d

# Build
npm run build

# Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 💻 CLI Commands

Access the CLI by running:

```bash
npm run cli -w apps/bot
```

Or send commands via the dashboard terminal.

### Available Commands

| Command | Description |
|---------|-------------|
| `auto on <shares> [sum] [move] [window] [dump]` | Enable bot with parameters |
| `auto off` | Disable bot |
| `status` | Show current status, positions, and PnL |
| `bankroll set <amount>` | Set paper bankroll |
| `bankroll reset` | Reset bankroll to $1000 |
| `config show` | Show current configuration |
| `config set key=value ...` | Update configuration |
| `market mode auto` | Auto-detect next BTC Up/Down market |
| `market select <slug>` | Manually select a market |
| `cycles list [limit]` | List recent trading cycles |
| `trades list [limit]` | List recent trades |
| `logs tail [limit]` | Show recent logs |
| `help` | Show help |

### Example Commands

```bash
# Start bot: 10 shares, 0.95 sum target, 15% move, 4 min window
auto on 10 0.95 0.15 4

# Same with explicit parameters
auto on shares=10 sumTarget=0.95 move=0.15 windowMin=4

# Check status
status

# Set bankroll to $5000
bankroll set 5000

# Update config
config set sumTarget=0.92 move=0.12

# Stop bot
auto off
```

## 📊 Dashboard

The web dashboard provides:

### Overview Page
- Real-time bot status (ON/OFF)
- Current bankroll, positions, equity
- Live orderbook display with ask sum indicator
- Current market info and watcher countdown
- Active cycle status
- Equity curve chart
- Integrated terminal

### Cycles Page
- List of all trading cycles
- Completion statistics
- Locked-in profit distribution chart

### Trades Page
- Complete trade history
- Volume and side breakdowns

### Terminal Page
- Full terminal interface
- Live log streaming
- Quick command buttons

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `DASH_USER` | `admin` | Dashboard basic auth username |
| `DASH_PASS` | `polytrader` | Dashboard basic auth password |
| `INITIAL_BANKROLL` | `1000` | Starting paper bankroll |
| `FEE_BPS` | `0` | Fee in basis points |
| `BOT_PORT` | `3001` | Bot API port |
| `DASHBOARD_PORT` | `3000` | Dashboard port |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |

### Strategy Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `shares` | `10` | Number of shares per trade |
| `sumTarget` | `0.95` | Max sum of leg1 + leg2 prices (guarantees 5%+ profit) |
| `move` | `0.15` | Min price drop to trigger leg 1 (15%) |
| `windowMin` | `2` | Watch window from round start (minutes) |
| `dumpWindowSec` | `3` | Time window to measure price drop (seconds) |

## 🔌 API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (no auth) |
| `/api/status` | GET | Current bot status |
| `/api/command` | POST | Execute command |
| `/api/cycles` | GET | List cycles |
| `/api/trades` | GET | List trades |
| `/api/equity` | GET | Equity history |
| `/api/logs` | GET | Recent logs |
| `/api/config` | GET | Current config |

### WebSocket

Connect to `/ws` for real-time updates:

- `status:update` - Bot status every second
- `log:entry` - New log entries
- `trade:executed` - Trade events
- `cycle:updated` - Cycle updates
- `orderbook:update` - Orderbook changes

## 📈 Paper P&L Verification

1. Open the dashboard at http://localhost:3000
2. Check the **Equity** card on the overview page
3. Review the **Equity Curve** chart for historical performance
4. Check the **Cycles** page for individual cycle profits
5. Use the `status` command to see current positions and P&L

```bash
# Via CLI
status

# Output shows:
# - Cash balance
# - Positions (UP/DOWN shares)
# - Unrealized P&L
# - Realized P&L
# - Total Equity
```

## 🔄 Changing the Tracked Market

### Auto Mode (Default)

The bot automatically discovers the next Bitcoin Up/Down 15-minute market:

```bash
market mode auto
```

### Manual Selection

To manually select a specific market:

```bash
market select btc-updown-15m-2024-01-15-1200
```

The market slug can be found in the Polymarket URL or API.

## 🏗️ Extending for Live Trading

The codebase is structured for easy transition to live trading:

1. **Create LiveExecution class** implementing the same interface as `PaperExecution`
2. **Add Polymarket API credentials** for order placement
3. **Update engine** to use the new execution class
4. **Add wallet management** for real funds

Key files to modify:
- `apps/bot/src/core/paperExecution.ts` → Create `liveExecution.ts`
- `apps/bot/src/core/engine.ts` → Swap execution instance
- Add API key environment variables

## 🧪 Testing

```bash
# Run all tests
npm test

# Test shared package (command parser)
npm test -w packages/shared

# Test bot (dump detection, hedge logic)
npm test -w apps/bot
```

## 📝 Logs

### View Logs

```bash
# PM2 logs (production)
pm2 logs

# Bot logs only
pm2 logs poly-bot

# Dashboard logs only
pm2 logs poly-dashboard
```

### Log Files

- `logs/bot-out.log` - Bot stdout
- `logs/bot-error.log` - Bot errors
- `logs/dashboard-out.log` - Dashboard stdout
- `logs/dashboard-error.log` - Dashboard errors

## 🛠️ Troubleshooting

### Postgres Connection Issues

```bash
# Check if Postgres is running
docker-compose ps

# Restart Postgres
docker-compose restart postgres

# View Postgres logs
docker-compose logs postgres
```

### Bot Not Starting

```bash
# Check PM2 status
pm2 status

# View bot logs
pm2 logs poly-bot --lines 100

# Restart bot
pm2 restart poly-bot
```

### Dashboard Not Loading

```bash
# Check if dashboard is running
pm2 status

# Rebuild dashboard
npm run build -w apps/dashboard

# Restart
pm2 restart poly-dashboard
```

## 📄 License

MIT

---

**⚠️ DISCLAIMER**: This is a paper trading bot for educational purposes only. No real money is involved. Always do your own research before trading on any platform.

