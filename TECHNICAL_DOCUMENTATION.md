# Poly Trader - Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Trading Strategy](#trading-strategy)
4. [Core Components](#core-components)
5. [Data Flow](#data-flow)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Configuration](#configuration)
9. [Dashboard](#dashboard)
10. [Deployment](#deployment)

---

## Overview

Poly Trader is a **paper trading bot** designed for Polymarket's Bitcoin Up/Down 15-minute prediction markets. It implements a 2-leg arbitrage-style strategy that locks in guaranteed profit by holding both sides of a binary outcome.

### What This Bot Does

1. **Monitors** Polymarket's BTC Up/Down 15-minute markets
2. **Detects** rapid price dumps on either UP or DOWN tokens
3. **Executes** a 2-leg trade strategy to lock in profit
4. **Tracks** all trades, cycles, and portfolio performance
5. **Provides** a real-time dashboard for monitoring and control

### Key Features

- **Paper Trading Only**: No real money is used; all trades are simulated
- **Live Market Data**: Connects to Polymarket's public APIs for real prices
- **WebSocket Updates**: Real-time orderbook streaming
- **Persistent Storage**: PostgreSQL database for trade history
- **Web Dashboard**: Full monitoring and control interface
- **CLI Interface**: Terminal-based command system

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           POLY TRADER                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Dashboard  │◄──►│   Bot API    │◄──►│   Trading Engine     │  │
│  │  (Next.js)   │    │  (Fastify)   │    │                      │  │
│  │  Port 3000   │    │  Port 3001   │    │  ┌────────────────┐  │  │
│  └──────────────┘    └──────────────┘    │  │ Dump Detector  │  │  │
│         │                   │            │  └────────────────┘  │  │
│         │            ┌──────┴──────┐     │  ┌────────────────┐  │  │
│         │            │  WebSocket  │     │  │Paper Execution │  │  │
│         └───────────►│   Server    │     │  └────────────────┘  │  │
│                      └─────────────┘     └──────────────────────┘  │
│                                                     │               │
│  ┌─────────────────────────────────────────────────┼───────────┐   │
│  │                    Services Layer               │           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────▼────────┐  │   │
│  │  │  Database   │  │  WebSocket  │  │ Market Discovery   │  │   │
│  │  │  (Prisma)   │  │  Manager    │  │                    │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────┬──────────┘  │   │
│  └─────────┼────────────────┼───────────────────┼─────────────┘   │
│            │                │                   │                  │
└────────────┼────────────────┼───────────────────┼──────────────────┘
             │                │                   │
             ▼                ▼                   ▼
      ┌──────────┐    ┌──────────────┐    ┌──────────────┐
      │PostgreSQL│    │ Polymarket   │    │ Polymarket   │
      │ Database │    │ WebSocket    │    │ REST API     │
      └──────────┘    └──────────────┘    └──────────────┘
```

### Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| Trading Engine | TypeScript | Core strategy logic |
| Bot API | Fastify | REST + WebSocket server |
| Dashboard | Next.js 14 | Web interface |
| Database | PostgreSQL + Prisma | Persistent storage |
| Shared Package | TypeScript | Types, schemas, parser |

---

## Trading Strategy

### The "Dump Then Hedge" Strategy

This strategy exploits temporary price inefficiencies in binary prediction markets.

#### How Binary Markets Work

In a Polymarket binary market (UP vs DOWN):
- Each side has a price between $0.00 and $1.00
- Prices represent the market's implied probability
- **At resolution**: The winning side pays $1.00, the losing side pays $0.00
- If you hold 1 share of each side, you're guaranteed $1.00 payout

#### The Opportunity

Sometimes, in volatile 15-minute BTC markets:
- One side experiences a rapid price dump (panic selling)
- The other side doesn't immediately adjust
- **Briefly, the sum of both sides' prices drops below $1.00**

If you can buy both sides for less than $1.00 total, you **lock in guaranteed profit**.

### Strategy Execution

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STRATEGY TIMELINE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Round Start                                              Round End  │
│       │                                                       │      │
│       ▼                                                       ▼      │
│  ┌─────────────────┐                                    ┌─────────┐ │
│  │  WATCH WINDOW   │                                    │ PAYOUT  │ │
│  │  (windowMin)    │                                    │  $1.00  │ │
│  └────────┬────────┘                                    └─────────┘ │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐     ┌─────────────────┐     ┌───────────────┐  │
│  │   DETECT DUMP   │────►│    BUY LEG 1    │────►│  WAIT FOR     │  │
│  │                 │     │  (dumped side)  │     │  HEDGE        │  │
│  │  price drops    │     │                 │     │               │  │
│  │  ≥ move% in     │     │  Example:       │     │  Until:       │  │
│  │  dumpWindowSec  │     │  UP @ $0.42     │     │  L1 + L2 Ask  │  │
│  │                 │     │                 │     │  ≤ sumTarget  │  │
│  └─────────────────┘     └─────────────────┘     └───────┬───────┘  │
│                                                          │          │
│                                                          ▼          │
│                                              ┌───────────────────┐  │
│                                              │    BUY LEG 2      │  │
│                                              │  (opposite side)  │  │
│                                              │                   │  │
│                                              │  Example:         │  │
│                                              │  DOWN @ $0.51     │  │
│                                              │                   │  │
│                                              │  Total: $0.93     │  │
│                                              │  Profit: $0.07    │  │
│                                              │  = 7.5% locked    │  │
│                                              └───────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Strategy Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `shares` | 10 | Number of shares to trade per leg |
| `sumTarget` | 0.95 | Maximum combined price for both legs (guarantees ≥5% profit) |
| `move` | 0.15 | Minimum price drop to trigger Leg 1 (15%) |
| `windowMin` | 2 | Minutes from round start to watch for dumps |
| `dumpWindowSec` | 3 | Time window to measure the price drop |

### Profit Calculation

```
Example Trade:
─────────────────────────────────
Leg 1: Buy 10 UP   @ $0.42 = $4.20
Leg 2: Buy 10 DOWN @ $0.51 = $5.10
─────────────────────────────────
Total Cost:              $9.30
Guaranteed Payout:      $10.00  (10 shares × $1.00)
─────────────────────────────────
Locked Profit:           $0.70  (7.5%)
```

---

## Core Components

### 1. Trading Engine (`apps/bot/src/core/engine.ts`)

The central orchestrator that coordinates all trading activity.

#### Responsibilities

- Manages bot state (enabled/disabled, config)
- Tracks current market and cycle
- Coordinates dump detection and trade execution
- Emits events for real-time updates

#### State Machine

```
┌──────────────────────────────────────────────────────────────────┐
│                      ENGINE STATE MACHINE                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────┐   enable()   ┌─────────┐                            │
│  │DISABLED │─────────────►│ ENABLED │                            │
│  └─────────┘              └────┬────┘                            │
│       ▲                        │                                  │
│       │    disable()           ▼                                  │
│       │               ┌────────────────┐                         │
│       └───────────────│  FIND MARKET   │◄──────────────────┐     │
│                       └───────┬────────┘                   │     │
│                               │ market found               │     │
│                               ▼                            │     │
│                       ┌────────────────┐                   │     │
│                       │ WAIT FOR START │                   │     │
│                       └───────┬────────┘                   │     │
│                               │ market starts              │     │
│                               ▼                            │     │
│                       ┌────────────────┐                   │     │
│                       │ WATCH WINDOW   │                   │     │
│                       │ (dump detect)  │                   │     │
│                       └───────┬────────┘                   │     │
│                               │                            │     │
│              ┌────────────────┼────────────────┐           │     │
│              │                │                │           │     │
│              ▼                ▼                ▼           │     │
│     ┌──────────────┐  ┌──────────────┐  ┌───────────┐     │     │
│     │ DUMP FOUND   │  │ WINDOW ENDS  │  │ NO DUMP   │     │     │
│     │ Execute L1   │  │ (no dump)    │  │ (timeout) │     │     │
│     └──────┬───────┘  └──────┬───────┘  └─────┬─────┘     │     │
│            │                 │                │           │     │
│            ▼                 │                │           │     │
│     ┌──────────────┐         │                │           │     │
│     │ WAIT HEDGE   │         │                │           │     │
│     └──────┬───────┘         │                │           │     │
│            │                 │                │           │     │
│       ┌────┴────┐            │                │           │     │
│       ▼         ▼            │                │           │     │
│  ┌─────────┐ ┌─────────┐     │                │           │     │
│  │ HEDGE   │ │ MARKET  │     │                │           │     │
│  │ FOUND   │ │ ENDS    │     │                │           │     │
│  │ Exec L2 │ │(incomp.)│     │                │           │     │
│  └────┬────┘ └────┬────┘     │                │           │     │
│       │           │          │                │           │     │
│       ▼           ▼          ▼                ▼           │     │
│  ┌─────────────────────────────────────────────────────┐  │     │
│  │                    CYCLE COMPLETE                   │──┘     │
│  │              (reset, find next market)              │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### Key Methods

```typescript
class TradingEngine {
  // Lifecycle
  async initialize(): Promise<void>     // Load state from DB
  start(): void                         // Start main loop
  async stop(): Promise<void>           // Graceful shutdown

  // Control
  async enable(config): Promise<void>   // Enable bot
  async disable(): Promise<void>        // Disable bot

  // Configuration
  async setBankroll(amount): Promise<void>
  async resetBankroll(): Promise<void>
  async setConfig(updates): Promise<void>

  // Market
  async selectMarket(slug): Promise<void>
  async setMarketMode(mode): Promise<void>

  // Status
  getStatus(): LiveStatus
  getConfig(): BotConfig
}
```

### 2. Dump Detector (`apps/bot/src/core/dumpDetector.ts`)

Detects rapid price drops that trigger Leg 1.

#### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DUMP DETECTION ALGORITHM                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. COLLECT PRICE SNAPSHOTS                                         │
│     ─────────────────────────                                       │
│     Every orderbook update, record:                                  │
│     { timestamp: now, price: bestAsk }                              │
│                                                                      │
│     Rolling window keeps last 60 seconds of data                    │
│                                                                      │
│  2. CALCULATE DROP                                                  │
│     ─────────────                                                   │
│     Within dumpWindowSec (e.g., 3 seconds):                         │
│                                                                      │
│     maxPrice = highest price in window                              │
│     currentPrice = latest price                                     │
│     dropPct = (maxPrice - currentPrice) / maxPrice                  │
│                                                                      │
│  3. TRIGGER CONDITION                                               │
│     ─────────────────                                               │
│     If dropPct >= move threshold (e.g., 0.15 = 15%):               │
│       → DUMP DETECTED                                               │
│       → Return { detected: true, side: 'UP'|'DOWN', dropPct }      │
│                                                                      │
│  Example:                                                           │
│  ─────────                                                          │
│  Time     │ UP Price │ DOWN Price                                   │
│  ─────────┼──────────┼────────────                                  │
│  00:00.0  │   0.55   │    0.45                                      │
│  00:01.0  │   0.53   │    0.47                                      │
│  00:02.0  │   0.48   │    0.52     ← UP dropped 12.7%, not enough  │
│  00:02.5  │   0.45   │    0.55     ← UP dropped 18.2%, TRIGGER!    │
│                                                                      │
│  dropPct = (0.55 - 0.45) / 0.55 = 0.182 = 18.2%                    │
│  18.2% >= 15% → Dump detected on UP side                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Debouncing

Once a dump is detected on a side:
- That side is marked as "triggered"
- No further dump signals are generated for that side
- Prevents multiple Leg 1 executions

### 3. Paper Execution (`apps/bot/src/core/paperExecution.ts`)

Simulates trade execution without real money.

#### How Paper Trades Work

```typescript
async buy(params: BuyParams): Promise<Trade> {
  const { shares, price, currentCash, feeBps } = params;

  // Calculate cost
  const grossCost = shares * price;
  const fee = (grossCost * feeBps) / 10000;  // Default: 0 bps
  const totalCost = grossCost + fee;

  // Validate funds
  if (totalCost > currentCash) {
    throw new Error('Insufficient cash');
  }

  // Create trade record
  const trade = {
    id: nanoid(),
    timestamp: new Date(),
    shares,
    price,
    cost: totalCost,
    cashAfter: currentCash - totalCost,
    // ... other fields
  };

  // Persist to database
  await this.db.createTrade(trade);

  return trade;
}
```

#### Switching to Live Trading

The `PaperExecution` class implements an `IExecution` interface:

```typescript
interface IExecution {
  buy(params: BuyParams): Promise<Trade>;
  sell(params: SellParams): Promise<{ proceeds: number; cashAfter: number }>;
}
```

To enable live trading:
1. Create `LiveExecution` implementing the same interface
2. Use `PolymarketClient` for authenticated API calls
3. Swap the execution instance in `TradingEngine`

### 4. Market Discovery (`apps/bot/src/services/marketDiscovery.ts`)

Finds and tracks BTC Up/Down markets.

#### Market Detection

```typescript
// Patterns to identify BTC Up/Down markets
const BTC_UPDOWN_PATTERNS = [
  /btc-updown-15m-/i,       // Slug pattern
  /bitcoin.*up.*or.*down/i, // Question pattern
  /btc.*15.*min/i,          // Alternative pattern
];
```

#### API Sources

1. **Gamma API** (`https://gamma-api.polymarket.com`)
   - Game markets with start times
   - Token information

2. **CLOB API** (`https://clob.polymarket.com`)
   - Active markets
   - Orderbook data

#### Market Lifecycle

```
UPCOMING ──► LIVE ──► ENDED ──► RESOLVED
    │           │         │          │
    │           │         │          └─ Winner determined, payout
    │           │         └─ Trading closed
    │           └─ Trading active, watching for dumps
    └─ Found, waiting for start time
```

### 5. WebSocket Manager (`apps/bot/src/services/websocket.ts`)

Maintains real-time connections to Polymarket orderbooks.

#### Connection Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WEBSOCKET CONNECTION FLOW                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Engine selects a market                                         │
│     ▼                                                                │
│  2. Subscribe to both tokens                                        │
│     wsManager.subscribeToOrderbook(tokenUp, callback)               │
│     wsManager.subscribeToOrderbook(tokenDown, callback)             │
│     ▼                                                                │
│  3. WebSocket connects to Polymarket                                │
│     wss://ws-subscriptions-clob.polymarket.com/ws/market            │
│     ▼                                                                │
│  4. Send subscription message                                       │
│     { type: 'subscribe', channel: 'book', assets_id: tokenId }      │
│     ▼                                                                │
│  5. Receive orderbook updates                                       │
│     { bids: [...], asks: [...] }                                    │
│     ▼                                                                │
│  6. Parse and dispatch to callback                                  │
│     callback({ bids, asks, timestamp })                             │
│     ▼                                                                │
│  7. Engine updates prices and checks for signals                    │
│                                                                      │
│  On disconnect:                                                      │
│  ─────────────                                                       │
│  - Automatic reconnection after 5 seconds                           │
│  - All subscriptions are re-established                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6. Database Service (`apps/bot/src/services/database.ts`)

Prisma-based PostgreSQL access layer.

#### Key Operations

| Method | Purpose |
|--------|---------|
| `getBotState()` | Load saved bot configuration |
| `saveBotState()` | Persist bot state |
| `upsertMarket()` | Save market info |
| `createTrade()` | Record a paper trade |
| `createCycle()` | Start a new trading cycle |
| `updateCycle()` | Update cycle status/results |
| `createEquitySnapshot()` | Record portfolio value |
| `getEquityHistory()` | Fetch equity curve data |

---

## Data Flow

### Complete Trade Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      COMPLETE TRADE FLOW                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────┐                                              │
│  │ POLYMARKET API    │                                              │
│  │ (market data)     │                                              │
│  └─────────┬─────────┘                                              │
│            │                                                         │
│            ▼                                                         │
│  ┌───────────────────┐                                              │
│  │ MARKET DISCOVERY  │                                              │
│  │ Find BTC Up/Down  │                                              │
│  └─────────┬─────────┘                                              │
│            │                                                         │
│            ▼                                                         │
│  ┌───────────────────┐      ┌───────────────────┐                   │
│  │ WEBSOCKET MGR     │◄────►│ POLYMARKET WS     │                   │
│  │ Subscribe tokens  │      │ (orderbook feed)  │                   │
│  └─────────┬─────────┘      └───────────────────┘                   │
│            │                                                         │
│            │ orderbook updates                                       │
│            ▼                                                         │
│  ┌───────────────────┐                                              │
│  │ TRADING ENGINE    │                                              │
│  │ Main loop (100ms) │                                              │
│  └─────────┬─────────┘                                              │
│            │                                                         │
│            ├──────────────────────────────┐                         │
│            ▼                              ▼                         │
│  ┌───────────────────┐      ┌───────────────────┐                   │
│  │ DUMP DETECTOR     │      │ HEDGE CHECKER     │                   │
│  │ Check price drops │      │ L1 + L2 ≤ target? │                   │
│  └─────────┬─────────┘      └─────────┬─────────┘                   │
│            │                          │                              │
│            │ dump detected            │ hedge condition met          │
│            ▼                          ▼                              │
│  ┌───────────────────┐      ┌───────────────────┐                   │
│  │ PAPER EXECUTION   │      │ PAPER EXECUTION   │                   │
│  │ Execute Leg 1     │      │ Execute Leg 2     │                   │
│  └─────────┬─────────┘      └─────────┬─────────┘                   │
│            │                          │                              │
│            └──────────┬───────────────┘                              │
│                       ▼                                              │
│            ┌───────────────────┐                                     │
│            │ DATABASE          │                                     │
│            │ - Save trade      │                                     │
│            │ - Update cycle    │                                     │
│            │ - Equity snapshot │                                     │
│            └─────────┬─────────┘                                     │
│                      │                                               │
│                      ▼                                               │
│            ┌───────────────────┐      ┌───────────────────┐         │
│            │ EVENT EMITTER     │─────►│ WEBSOCKET SERVER  │         │
│            │ trade:executed    │      │ Broadcast to UI   │         │
│            │ cycle:updated     │      │                   │         │
│            └───────────────────┘      └─────────┬─────────┘         │
│                                                 │                    │
│                                                 ▼                    │
│                                       ┌───────────────────┐         │
│                                       │ DASHBOARD         │         │
│                                       │ Real-time updates │         │
│                                       └───────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### REST Endpoints

#### `GET /health`
Health check (no authentication required).

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1703376000000
}
```

#### `GET /api/status`
Current bot status, portfolio, and market info.

**Response:**
```json
{
  "success": true,
  "data": {
    "bot": {
      "enabled": true,
      "mode": "auto",
      "selectedMarket": null,
      "config": {
        "shares": 10,
        "sumTarget": 0.95,
        "move": 0.15,
        "windowMin": 2,
        "dumpWindowSec": 3,
        "feeBps": 0
      }
    },
    "portfolio": {
      "cash": 1000.00,
      "positions": { "UP": 0, "DOWN": 0 },
      "unrealizedPnL": 0,
      "realizedPnL": 0,
      "equity": 1000.00
    },
    "currentMarket": {
      "slug": "btc-updown-15m-2024-01-15-1200",
      "status": "live",
      "startTime": "2024-01-15T12:00:00Z",
      "endTime": "2024-01-15T12:15:00Z"
    },
    "orderbooks": {
      "UP": { "bids": [...], "asks": [...] },
      "DOWN": { "bids": [...], "asks": [...] }
    },
    "currentCycle": null,
    "watcherActive": true,
    "watcherSecondsRemaining": 85,
    "uptime": 3600000,
    "lastUpdate": 1703376000000
  }
}
```

#### `POST /api/command`
Execute a command.

**Request:**
```json
{
  "command": "auto on 10 0.95 0.15 4"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bot enabled with config:\n  Shares: 10\n  Sum Target: 0.95\n  ...",
  "data": { ... }
}
```

#### `GET /api/cycles`
List trading cycles.

**Query Parameters:**
- `limit` (optional): Number of cycles (default: 20)

#### `GET /api/trades`
List trades.

**Query Parameters:**
- `limit` (optional): Number of trades (default: 50)

#### `GET /api/equity`
Equity history for charts.

**Query Parameters:**
- `limit` (optional): Number of snapshots (default: 1000)

### WebSocket Events

Connect to `ws://localhost:3001/ws`

#### Incoming Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `status:update` | LiveStatus | Sent every 1 second |
| `log:entry` | LogEntry | New log message |
| `trade:executed` | Trade | Trade was executed |
| `cycle:updated` | Cycle | Cycle status changed |
| `orderbook:update` | { side, orderbook } | Price update |
| `command:response` | { command, result } | Command result |

#### Outgoing Events (Client → Server)

```json
{
  "type": "command",
  "command": "status"
}
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────────┐       ┌─────────────────┐
│    BotState     │       │     Config      │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │       │ id (PK)         │
│ enabled         │       │ key (unique)    │
│ mode            │       │ value (JSON)    │
│ selectedMarket  │       │ updatedAt       │
│ config (JSON)   │       └─────────────────┘
│ updatedAt       │
└─────────────────┘
                                    ┌─────────────────┐
┌─────────────────┐                 │  LogEntry       │
│     Market      │                 ├─────────────────┤
├─────────────────┤                 │ id (PK)         │
│ id (PK)         │                 │ timestamp       │
│ slug (unique)   │                 │ level           │
│ question        │                 │ message         │
│ startTime       │                 │ meta (JSON)     │
│ endTime         │                 └─────────────────┘
│ tokenUp         │
│ tokenDown       │       ┌─────────────────┐
│ conditionId     │       │ EquitySnapshot  │
│ status          │       ├─────────────────┤
│ resolution      │       │ id (PK)         │
│ createdAt       │       │ timestamp       │
│ updatedAt       │       │ cash            │
└────────┬────────┘       │ equity          │
         │                │ unrealized      │
         │                │ realized        │
         │                └─────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────┐
│     Cycle       │
├─────────────────┤
│ id (PK)         │
│ marketSlug (FK) │───────────────────────┐
│ startedAt       │                       │
│ endedAt         │                       │
│ leg1Side        │                       │
│ leg1Price       │                       │
│ leg1Time        │                       │
│ leg1Shares      │                       │
│ leg2Side        │                       │
│ leg2Price       │                       │
│ leg2Time        │                       │
│ leg2Shares      │                       │
│ totalCost       │                       │
│ lockedInProfit  │                       │
│ lockedInPct     │                       │
│ status          │                       │
└────────┬────────┘                       │
         │                                │
         │ 1:N                            │
         ▼                                │
┌─────────────────┐                       │
│     Trade       │                       │
├─────────────────┤                       │
│ id (PK)         │                       │
│ timestamp       │                       │
│ marketSlug (FK) │───────────────────────┘
│ leg             │
│ side            │
│ tokenId         │
│ shares          │
│ price           │
│ cost            │
│ fee             │
│ cashAfter       │
│ cycleId (FK)    │
└─────────────────┘
```

### Cycle Statuses

| Status | Description |
|--------|-------------|
| `pending` | Cycle created, watching for dump |
| `leg1_done` | Leg 1 executed, waiting for hedge |
| `complete` | Both legs executed, profit locked |
| `incomplete` | Market ended before Leg 2 |
| `settled` | Payout received (simulation) |

---

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/polytrader"

# Dashboard Authentication
DASH_USER="admin"
DASH_PASS="your-secure-password"

# Initial Paper Bankroll
INITIAL_BANKROLL=1000

# Trading Fees (basis points, 100 = 1%)
FEE_BPS=0

# Polymarket API Endpoints
POLYMARKET_API_URL="https://clob.polymarket.com"
POLYMARKET_GAMMA_URL="https://gamma-api.polymarket.com"

# Polymarket Credentials (for future live trading)
POLYMARKET_API_KEY="your-api-key"
POLYMARKET_SECRET="your-secret"
POLYMARKET_PASSPHRASE="your-passphrase"

# Server Ports
BOT_PORT=3001
DASHBOARD_PORT=3000

# Logging
LOG_LEVEL="info"  # debug | info | warn | error
```

### Strategy Defaults

Located in `packages/shared/src/constants.ts`:

```typescript
export const DEFAULT_CONFIG = {
  shares: 10,           // Shares per trade
  sumTarget: 0.95,      // Max combined price (5% min profit)
  move: 0.15,           // 15% price drop threshold
  windowMin: 2,         // 2-minute watch window
  dumpWindowSec: 3,     // 3-second dump detection window
  feeBps: 0,            // No fees for paper trading
  initialBankroll: 1000, // Starting cash
};
```

---

## Dashboard

### Pages

#### Overview (`/`)

Main dashboard showing:
- **Status Cards**: Equity, cash, positions, realized P&L
- **Equity Chart**: Historical portfolio value
- **Orderbook Display**: Live UP/DOWN prices with sum indicator
- **Market Info**: Current market, watcher countdown
- **Cycle Info**: Active cycle status
- **Config Panel**: Current strategy parameters
- **Terminal**: Embedded command interface

#### Cycles (`/cycles`)

- Cycle statistics (total, completed, incomplete, avg profit)
- Profit distribution bar chart
- Detailed cycles table

#### Trades (`/trades`)

- Trade statistics (count, volume, by side)
- Complete trade history table

#### Terminal (`/terminal`)

- Full-screen terminal interface
- Live log streaming
- Quick command buttons
- Command history (arrow keys)

### Real-Time Updates

The dashboard uses WebSocket for live updates:

```typescript
// hooks/useWebSocket.ts
function useWebSocket() {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/ws');

    ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);

      switch (type) {
        case 'status:update':
          setStatus(payload);
          break;
        case 'log:entry':
          setLogs(prev => [...prev.slice(-199), payload]);
          break;
        // ... other events
      }
    };
  }, []);

  return { status, logs };
}
```

---

## Deployment

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres
docker-compose up -d postgres

# 3. Setup database
npx prisma generate
npx prisma db push

# 4. Start services
./scripts/start-local.sh
# Or separately:
npm run dev -w apps/bot
npm run dev -w apps/dashboard
```

### EC2 Production

```bash
# One-command deployment
./scripts/deploy-ec2.sh

# Manual steps:
# 1. Install Node 20 via NVM
# 2. Install Docker
# 3. Install PM2
# 4. Configure .env
# 5. Start services with PM2
pm2 start ecosystem.config.cjs
```

### PM2 Configuration

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'poly-bot',
      script: 'dist/index.js',
      cwd: './apps/bot',
      instances: 1,
      autorestart: true,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'poly-dashboard',
      script: 'npm',
      args: 'start',
      cwd: './apps/dashboard',
      instances: 1,
      autorestart: true
    }
  ]
};
```

---

## Appendix: Command Reference

| Command | Description |
|---------|-------------|
| `auto on <shares> [sum] [move] [window] [dump]` | Enable bot |
| `auto off` | Disable bot |
| `status` | Show current status |
| `bankroll set <amount>` | Set paper bankroll |
| `bankroll reset` | Reset to $1000 |
| `config show` | Show configuration |
| `config set key=value ...` | Update configuration |
| `market mode auto` | Auto-detect markets |
| `market select <slug>` | Select specific market |
| `cycles list [limit]` | List cycles |
| `trades list [limit]` | List trades |
| `logs tail [limit]` | Show recent logs |
| `help` | Show help |

---

*Last Updated: December 2024*

