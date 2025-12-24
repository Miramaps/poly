// Default configuration values
export const DEFAULT_CONFIG: {
  entryThreshold: number;
  shares: number;
  dcaEnabled: boolean;
  dcaLevels: number[];
  dcaMultiplier: number;
  sumTarget: number;
  breakevenEnabled: boolean;
  maxHoldMinutes: number;
  move: number;
  windowMin: number;
  dumpWindowSec: number;
  feeBps: number;
  initialBankroll: number;
} = {
  // Entry settings
  entryThreshold: 0.35,        // Buy when price < 35¢
  shares: 10,                  // Base shares per buy
  
  // DCA settings
  dcaEnabled: true,            // Enable DCA by default
  dcaLevels: [0.30, 0.25, 0.20, 0.15],  // Buy more at these prices
  dcaMultiplier: 1.5,          // 1.5x shares at each level
  
  // Hedge settings
  sumTarget: 0.99,             // Hedge when avgCost + oppositeAsk <= 0.99
  
  // Exit settings
  breakevenEnabled: true,      // Wait for breakeven (no losses)
  maxHoldMinutes: 0,           // 0 = hold forever until breakeven or hedge
  
  // Legacy (kept for compatibility)
  move: 0.15,
  windowMin: 15,               // Watch for full 15 minutes
  dumpWindowSec: 3,
  feeBps: 0,
  initialBankroll: 1000,
};

// Market patterns for Bitcoin Up/Down detection
export const BTC_UPDOWN_PATTERNS = [
  /btc-updown-15m-/i,
  /bitcoin.*up.*or.*down/i,
  /btc.*15.*min/i,
] as const;

// WebSocket message types
export const WS_EVENTS = {
  STATUS_UPDATE: 'status:update',
  LOG_ENTRY: 'log:entry',
  TRADE_EXECUTED: 'trade:executed',
  CYCLE_UPDATED: 'cycle:updated',
  ORDERBOOK_UPDATE: 'orderbook:update',
  COMMAND_RESPONSE: 'command:response',
} as const;

// Cycle statuses
export const CYCLE_STATUS = {
  PENDING: 'pending',          // Waiting for entry condition
  BUYING: 'buying',            // Actively buying (DCA in progress)
  LEG1_DONE: 'leg1_done',      // Entry complete, waiting for hedge
  COMPLETE: 'complete',        // Hedged successfully
  INCOMPLETE: 'incomplete',    // Market ended without hedge
  SETTLED: 'settled',          // Market resolved
} as const;

// Market statuses
export const MARKET_STATUS = {
  UPCOMING: 'upcoming',
  LIVE: 'live',
  ENDED: 'ended',
  RESOLVED: 'resolved',
} as const;

// Sides
export const SIDE = {
  UP: 'UP',
  DOWN: 'DOWN',
} as const;

