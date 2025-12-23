import { z } from 'zod';
import { DEFAULT_CONFIG } from './constants.js';

// Bot configuration schema
export const BotConfigSchema = z.object({
  shares: z.number().positive().default(DEFAULT_CONFIG.shares),
  sumTarget: z.number().min(0).max(1).default(DEFAULT_CONFIG.sumTarget),
  move: z.number().min(0).max(1).default(DEFAULT_CONFIG.move),
  windowMin: z.number().positive().default(DEFAULT_CONFIG.windowMin),
  dumpWindowSec: z.number().positive().default(DEFAULT_CONFIG.dumpWindowSec),
  feeBps: z.number().min(0).default(DEFAULT_CONFIG.feeBps),
});

// Auto on command params
export const AutoOnParamsSchema = z.object({
  shares: z.number().positive(),
  sumTarget: z.number().min(0).max(1).optional().default(0.95),
  move: z.number().min(0).max(1).optional().default(0.15),
  windowMin: z.number().positive().optional().default(2),
  dumpWindowSec: z.number().positive().optional().default(3),
});

// Bankroll set command
export const BankrollSetSchema = z.object({
  amount: z.number().positive(),
});

// Config set command
export const ConfigSetSchema = z.record(z.string(), z.union([z.string(), z.number()]));

// Market select command
export const MarketSelectSchema = z.object({
  marketSlug: z.string().min(1),
});

// API command schema
export const CommandSchema = z.object({
  command: z.string().min(1),
});

// WebSocket message schema
export const WSMessageSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.number(),
});

// Trade schema
export const TradeSchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  marketSlug: z.string(),
  leg: z.union([z.literal(1), z.literal(2)]),
  side: z.enum(['UP', 'DOWN']),
  tokenId: z.string(),
  shares: z.number(),
  price: z.number(),
  cost: z.number(),
  fee: z.number(),
  cashAfter: z.number(),
  cycleId: z.string().optional(),
});

// Cycle schema
export const CycleSchema = z.object({
  id: z.string(),
  marketSlug: z.string(),
  startedAt: z.date(),
  endedAt: z.date().optional(),
  leg1Side: z.enum(['UP', 'DOWN']).optional(),
  leg1Price: z.number().optional(),
  leg1Time: z.date().optional(),
  leg1Shares: z.number().optional(),
  leg2Side: z.enum(['UP', 'DOWN']).optional(),
  leg2Price: z.number().optional(),
  leg2Time: z.date().optional(),
  leg2Shares: z.number().optional(),
  totalCost: z.number().optional(),
  lockedInProfit: z.number().optional(),
  lockedInPct: z.number().optional(),
  status: z.enum(['pending', 'leg1_done', 'complete', 'incomplete', 'settled']),
});

