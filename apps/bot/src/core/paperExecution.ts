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
 * PaperExecution handles simulated order execution.
 * 
 * This class is designed to be swappable with a LiveExecution class
 * for real trading. The interface is the same, only the implementation differs.
 */
export class PaperExecution {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Execute a paper buy order.
   * 
   * @param params - Buy order parameters
   * @returns Trade object representing the executed order
   */
  async buy(params: BuyParams): Promise<Trade> {
    const { marketSlug, leg, side, tokenId, shares, price, cycleId, currentCash, feeBps } = params;

    // Calculate cost and fee
    const grossCost = shares * price;
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
      price,
      cost: totalCost,
      fee,
      cashAfter,
      cycleId,
    };

    // Persist to database
    await this.db.createTrade(trade);

    logger.info('Paper trade executed', {
      leg,
      side,
      shares,
      price: price.toFixed(4),
      cost: totalCost.toFixed(4),
      cashAfter: cashAfter.toFixed(4),
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

