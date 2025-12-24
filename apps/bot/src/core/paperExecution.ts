import { nanoid } from 'nanoid';
import type { Trade } from '@poly-trader/shared';
import { Database } from '../services/database.js';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('execution');

interface BuyParams {
  marketSlug: string;
  leg: 1 | 2;
  side: 'UP' | 'DOWN';
  tokenId: string;
  shares: number;
  price: number;
  cycleId: string;
  currentCash: number;
  feeBps: number;
}

/**
 * PaperExecution handles simulated order execution with REALISTIC LATENCY.
 * 
 * Simulates real-world conditions:
 * - Network latency (100-200ms delay)
 * - Slippage (price moves 0.5-2% against you during execution)
 * 
 * This gives accurate results for profitability testing.
 */
export class PaperExecution {
  private db: Database;
  
  // Simulation settings
  private readonly LATENCY_MIN_MS = 80;   // Minimum simulated latency
  private readonly LATENCY_MAX_MS = 200;  // Maximum simulated latency
  private readonly SLIPPAGE_MIN = 0.005;  // 0.5% minimum slippage
  private readonly SLIPPAGE_MAX = 0.02;   // 2% maximum slippage

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<number> {
    const latency = this.LATENCY_MIN_MS + Math.random() * (this.LATENCY_MAX_MS - this.LATENCY_MIN_MS);
    await new Promise(resolve => setTimeout(resolve, latency));
    return latency;
  }

  /**
   * Simulate slippage - price moves against you during execution
   * For buys: price goes UP (you pay more)
   */
  private simulateSlippage(price: number): number {
    const slippagePct = this.SLIPPAGE_MIN + Math.random() * (this.SLIPPAGE_MAX - this.SLIPPAGE_MIN);
    const slippedPrice = price * (1 + slippagePct);
    return Math.min(slippedPrice, 0.99); // Cap at 0.99
  }

  /**
   * Execute a paper buy order with REALISTIC latency and slippage.
   * 
   * @param params - Buy order parameters
   * @returns Trade object representing the executed order
   */
  async buy(params: BuyParams): Promise<Trade> {
    const { marketSlug, leg, side, tokenId, shares, price, cycleId, currentCash, feeBps } = params;

    const startTime = Date.now();

    // Simulate API call latency
    const latency = await this.simulateLatency();

    // Simulate slippage - price moves against us during execution
    const executedPrice = this.simulateSlippage(price);
    const slippagePct = ((executedPrice - price) / price * 100).toFixed(2);

    // Calculate cost with slipped price
    const grossCost = shares * executedPrice;
    const fee = (grossCost * feeBps) / 10000;
    const totalCost = grossCost + fee;

    // Validate sufficient funds
    if (totalCost > currentCash) {
      throw new Error(`Insufficient cash: need ${totalCost.toFixed(4)}, have ${currentCash.toFixed(4)}`);
    }

    const cashAfter = currentCash - totalCost;

    // Create trade record
    const trade: Trade = {
      id: nanoid(),
      timestamp: new Date(),
      marketSlug,
      leg,
      side,
      tokenId,
      shares,
      price: executedPrice,  // Use slipped price
      cost: totalCost,
      fee,
      cashAfter,
      cycleId,
    };

    // Persist to database
    await this.db.createTrade(trade);

    const totalTime = Date.now() - startTime;

    logger.info('📝 Paper trade executed (realistic mode)', {
      leg,
      side,
      shares,
      requestedPrice: price.toFixed(4),
      executedPrice: executedPrice.toFixed(4),
      slippage: `+${slippagePct}%`,
      cost: totalCost.toFixed(4),
      cashAfter: cashAfter.toFixed(4),
      latencyMs: latency.toFixed(0),
      totalMs: totalTime,
    });

    return trade;
  }

  /**
   * Execute a paper sell order (for flattening positions).
   * Not typically used in the strategy but provided for completeness.
   */
  async sell(params: {
    marketSlug: string;
    side: 'UP' | 'DOWN';
    tokenId: string;
    shares: number;
    price: number;
    currentCash: number;
    feeBps: number;
  }): Promise<{ proceeds: number; cashAfter: number }> {
    const { shares, price, currentCash, feeBps } = params;

    const grossProceeds = shares * price;
    const fee = (grossProceeds * feeBps) / 10000;
    const netProceeds = grossProceeds - fee;
    const cashAfter = currentCash + netProceeds;

    logger.info('Paper sell executed', {
      side: params.side,
      shares,
      price: price.toFixed(4),
      proceeds: netProceeds.toFixed(4),
      cashAfter: cashAfter.toFixed(4),
    });

    return { proceeds: netProceeds, cashAfter };
  }
}

/**
 * Interface for future LiveExecution implementation.
 * When implementing live trading, create a class with this same interface.
 */
export interface IExecution {
  buy(params: BuyParams): Promise<Trade>;
  sell(params: {
    marketSlug: string;
    side: 'UP' | 'DOWN';
    tokenId: string;
    shares: number;
    price: number;
    currentCash: number;
    feeBps: number;
  }): Promise<{ proceeds: number; cashAfter: number }>;
}

