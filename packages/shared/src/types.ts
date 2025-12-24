// Bot configuration
export interface BotConfig {
  // Entry settings
  entryThreshold: number;      // Buy when price drops below this (default: 0.35)
  shares: number;              // Base shares per buy
  
  // DCA settings
  dcaEnabled: boolean;         // Enable dollar-cost averaging
  dcaLevels: number[];         // Price levels to buy more (e.g., [0.30, 0.25, 0.20])
  dcaMultiplier: number;       // Multiply shares at each DCA level (e.g., 1.5x)
  
  // Hedge settings
  sumTarget: number;           // Hedge when avgCost + oppositeAsk <= this (default: 0.99)
  
  // Exit settings
  breakevenEnabled: boolean;   // Wait for breakeven before exiting (no losses)
  maxHoldMinutes: number;      // Max time to hold waiting for breakeven (0 = forever)
  
  // Legacy (kept for compatibility)
  move: number;                // Dump detection threshold (deprecated)
  windowMin: number;           // Watch window in minutes
  dumpWindowSec: number;       // Dump detection window (deprecated)
  feeBps: number;              // Fee basis points
}

// Bot state
export interface BotState {
  enabled: boolean;
  mode: 'auto' | 'manual';
  tradingMode: 'PAPER' | 'LIVE';
  selectedMarket: string | null;
  config: BotConfig;
}

// Execution metrics for live trading status
export interface ExecutionMetrics {
  ordersSent: number;
  ordersFilled: number;
  avgLatencyMs: number;
  fillRate: string;
  lastError: string | null;
}

// Market info
export interface Market {
  slug: string;
  question?: string;
  startTime?: Date;
  endTime?: Date;
  tokenUp?: string;
  tokenDown?: string;
  conditionId?: string;
  status: 'upcoming' | 'live' | 'ended' | 'resolved';
  resolution?: 'UP' | 'DOWN' | null;
}

// Orderbook
export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
}

export interface TokenOrderbooks {
  UP: Orderbook | null;
  DOWN: Orderbook | null;
}

// Price snapshot for dump detection
export interface PriceSnapshot {
  timestamp: number;
  price: number;
}

// Trade
export interface Trade {
  id: string;
  timestamp: Date;
  marketSlug: string;
  leg: 1 | 2;
  side: 'UP' | 'DOWN';
  tokenId: string;
  shares: number;
  price: number;
  cost: number;
  fee: number;
  cashAfter: number;
  cycleId?: string;
}

// Cycle
export interface Cycle {
  id: string;
  marketSlug: string;
  startedAt: Date;
  endedAt?: Date;
  
  // Leg 1 (entry side)
  leg1Side?: 'UP' | 'DOWN';
  leg1Price?: number;           // Average price (for DCA)
  leg1Time?: Date;              // First buy time
  leg1Shares?: number;          // Total shares
  leg1Buys?: number;            // Number of DCA buys
  leg1TotalCost?: number;       // Total cost for leg 1
  
  // Leg 2 (hedge side)
  leg2Side?: 'UP' | 'DOWN';
  leg2Price?: number;
  leg2Time?: Date;
  leg2Shares?: number;
  
  // Totals
  totalCost?: number;
  lockedInProfit?: number;
  lockedInPct?: number;
  
  // Exit tracking
  exitPrice?: number;           // Price at exit (if not hedged)
  exitPnL?: number;             // P&L at exit
  
  status: 'pending' | 'buying' | 'leg1_done' | 'complete' | 'incomplete' | 'settled';
}

// Positions
export interface Positions {
  UP: number;
  DOWN: number;
}

// Portfolio state
export interface Portfolio {
  cash: number;
  positions: Positions;
  unrealizedPnL: number;
  realizedPnL: number;
  equity: number;
}

// Live status for dashboard
export interface LiveStatus {
  bot: BotState;
  portfolio: Portfolio;
  currentMarket: Market | null;
  orderbooks: TokenOrderbooks;
  currentCycle: Cycle | null;
  watcherActive: boolean;
  watcherSecondsRemaining: number;
  uptime: number;
  lastUpdate: number;
  executionMetrics: ExecutionMetrics;
}

// WebSocket message
export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

// Command response
export interface CommandResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

// Equity snapshot
export interface EquitySnapshot {
  timestamp: Date;
  cash: number;
  equity: number;
  unrealized: number;
  realized: number;
}

// Log entry
export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta?: Record<string, unknown>;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Polymarket API types
export interface PolymarketToken {
  token_id: string;
  outcome: string;
  price: number;
}

export interface PolymarketMarket {
  condition_id: string;
  question_id?: string;
  question: string;
  slug?: string;
  tokens: PolymarketToken[];
  end_date_iso?: string;
  game_start_time?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
}

// Dump detection result
export interface DumpDetection {
  detected: boolean;
  side: 'UP' | 'DOWN' | null;
  dropPct: number;
  maxPrice: number;
  currentPrice: number;
}

// Hedge condition result
export interface HedgeCondition {
  met: boolean;
  avgCost: number;            // Average cost per share (leg1)
  oppositeAsk: number;        // Current ask on opposite side
  sum: number;                // avgCost + oppositeAsk
  target: number;             // sumTarget threshold
  potentialProfit: number;    // Profit if hedged now
}

// Wallet types
export interface WalletInfo {
  address: string;
  privateKey: string;
  balance: number;
  hasBalance: boolean;
}

export interface WalletStatus {
  address: string;
  balance: number;
  hasBalance: boolean;
  canGenerateNew: boolean;
}

