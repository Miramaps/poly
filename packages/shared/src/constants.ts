// Default configuration values
export const DEFAULT_CONFIG = {
  shares: 10,
  sumTarget: 0.95,
  move: 0.15,
  windowMin: 2,
  dumpWindowSec: 3,
  feeBps: 0,
  initialBankroll: 1000,
} as const;

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
  PENDING: 'pending',
  LEG1_DONE: 'leg1_done',
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  SETTLED: 'settled',
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

