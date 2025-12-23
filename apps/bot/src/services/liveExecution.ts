import crypto from 'crypto';
import { nanoid } from 'nanoid';
import type { Trade } from '@poly-trader/shared';
import { Database } from './database.js';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('live-execution');

/**
 * Polymarket API credentials
 */
interface Credentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Order parameters for Polymarket CLOB
 */
interface OrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  orderType?: 'GTC' | 'GTD' | 'FOK';
  expiration?: number;
}

/**
 * Order response from Polymarket
 */
interface OrderResponse {
  orderId: string;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED';
  filledSize?: number;
  avgPrice?: number;
  createdAt: string;
}

/**
 * Balance response
 */
interface BalanceResponse {
  collateral: number;  // USDC balance
  positions: Array<{
    tokenId: string;
    size: number;
    avgPrice: number;
  }>;
}

/**
 * LiveExecution handles real order execution on Polymarket.
 * 
 * IMPORTANT: This will execute REAL trades with REAL money.
 * Only use after thorough testing in paper mode.
 */
export class LiveExecution {
  private db: Database;
  private credentials: Credentials;
  private baseUrl: string;
  
  // Track execution metrics
  private metrics = {
    ordersSent: 0,
    ordersFilled: 0,
    avgLatencyMs: 0,
    lastError: null as string | null,
  };

  constructor(db: Database, credentials: Credentials) {
    this.db = db;
    this.credentials = credentials;
    this.baseUrl = process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com';
    
    logger.warn('🔴 LIVE EXECUTION ENABLED - Real trades will be executed!');
  }

  /**
   * Generate HMAC-SHA256 signature for Polymarket API.
   * 
   * The signature is computed as:
   * HMAC-SHA256(secret, timestamp + method + path + body)
   */
  private sign(
    timestamp: string,
    method: string,
    path: string,
    body: string = ''
  ): string {
    const message = timestamp + method.toUpperCase() + path + body;
    const hmac = crypto.createHmac('sha256', this.credentials.secret);
    hmac.update(message);
    return hmac.digest('base64');
  }

  /**
   * Generate authentication headers for Polymarket API.
   */
  private getAuthHeaders(
    method: string,
    path: string,
    body?: string
  ): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign(timestamp, method, path, body);

    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'POLY_API_KEY': this.credentials.apiKey,
      'POLY_PASSPHRASE': this.credentials.passphrase,
      'POLY_TIMESTAMP': timestamp,
      'POLY_SIGNATURE': signature,
    };
  }

  /**
   * Make authenticated request to Polymarket API.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers = this.getAuthHeaders(method, path, bodyStr);
    const url = `${this.baseUrl}${path}`;

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: bodyStr,
      });

      const latency = Date.now() - startTime;
      this.updateLatencyMetric(latency);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error ${response.status}: ${error}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      this.metrics.lastError = (error as Error).message;
      throw error;
    }
  }

  private updateLatencyMetric(latency: number) {
    const count = this.metrics.ordersSent + 1;
    this.metrics.avgLatencyMs = 
      (this.metrics.avgLatencyMs * this.metrics.ordersSent + latency) / count;
  }

  /**
   * Get current USDC balance and positions.
   */
  async getBalance(): Promise<BalanceResponse> {
    logger.info('Fetching account balance...');
    
    try {
      const balance = await this.request<BalanceResponse>('GET', '/balance');
      
      logger.info('Balance fetched', {
        collateral: balance.collateral.toFixed(2),
        positions: balance.positions.length,
      });
      
      return balance;
    } catch (error) {
      logger.error('Failed to fetch balance', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Place a limit order on Polymarket.
   */
  async placeOrder(params: OrderParams): Promise<OrderResponse> {
    logger.info('Placing order...', {
      tokenId: params.tokenId.slice(0, 10) + '...',
      side: params.side,
      price: params.price,
      size: params.size,
    });

    const startTime = Date.now();

    try {
      const order = await this.request<OrderResponse>('POST', '/order', {
        token_id: params.tokenId,
        side: params.side,
        price: params.price.toString(),
        size: params.size.toString(),
        order_type: params.orderType || 'GTC',
        expiration: params.expiration,
      });

      const latency = Date.now() - startTime;
      this.metrics.ordersSent++;

      logger.info('Order placed', {
        orderId: order.orderId,
        status: order.status,
        latencyMs: latency,
      });

      if (order.status === 'FILLED') {
        this.metrics.ordersFilled++;
      }

      return order;
    } catch (error) {
      logger.error('Order placement failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get order status by ID.
   */
  async getOrderStatus(orderId: string): Promise<OrderResponse> {
    return this.request<OrderResponse>('GET', `/order/${orderId}`);
  }

  /**
   * Cancel an open order.
   */
  async cancelOrder(orderId: string): Promise<void> {
    logger.info('Cancelling order', { orderId });
    await this.request<void>('DELETE', `/order/${orderId}`);
    logger.info('Order cancelled', { orderId });
  }

  /**
   * Get all open orders.
   */
  async getOpenOrders(): Promise<OrderResponse[]> {
    return this.request<OrderResponse[]>('GET', '/orders');
  }

  /**
   * Execute a buy trade (full flow for the trading engine).
   * 
   * This handles the complete buy flow:
   * 1. Validate funds
   * 2. Place order
   * 3. Wait for fill (with timeout)
   * 4. Record trade
   */
  async buy(params: {
    marketSlug: string;
    leg: 1 | 2;
    side: 'UP' | 'DOWN';
    tokenId: string;
    shares: number;
    price: number;
    cycleId: string;
    currentCash: number;
    feeBps: number;
  }): Promise<Trade> {
    const { marketSlug, leg, side, tokenId, shares, price, cycleId, currentCash, feeBps } = params;
    
    // Calculate expected cost
    const grossCost = shares * price;
    const fee = (grossCost * feeBps) / 10000;
    const totalCost = grossCost + fee;

    // Validate funds
    if (totalCost > currentCash) {
      throw new Error(`Insufficient cash: need ${totalCost.toFixed(4)}, have ${currentCash.toFixed(4)}`);
    }

    logger.info('Executing LIVE buy', {
      leg,
      side,
      shares,
      price: price.toFixed(4),
      expectedCost: totalCost.toFixed(4),
    });

    const startTime = Date.now();

    // Place the order
    const order = await this.placeOrder({
      tokenId,
      side: 'BUY',
      price,
      size: shares,
      orderType: 'FOK', // Fill-or-Kill for immediate execution
    });

    // Wait for fill if pending
    let finalOrder = order;
    if (order.status === 'PENDING' || order.status === 'OPEN') {
      finalOrder = await this.waitForFill(order.orderId, 5000);
    }

    const executionTime = Date.now() - startTime;

    if (finalOrder.status !== 'FILLED') {
      throw new Error(`Order not filled: ${finalOrder.status}`);
    }

    // Calculate actual cost from fill
    const actualPrice = finalOrder.avgPrice || price;
    const actualShares = finalOrder.filledSize || shares;
    const actualCost = actualShares * actualPrice;
    const actualFee = (actualCost * feeBps) / 10000;
    const totalActualCost = actualCost + actualFee;
    const cashAfter = currentCash - totalActualCost;

    // Create trade record
    const trade: Trade = {
      id: nanoid(),
      timestamp: new Date(),
      marketSlug,
      leg,
      side,
      tokenId,
      shares: actualShares,
      price: actualPrice,
      cost: totalActualCost,
      fee: actualFee,
      cashAfter,
      cycleId,
    };

    // Persist to database
    await this.db.createTrade(trade);

    logger.info('LIVE trade executed', {
      leg,
      side,
      shares: actualShares,
      price: actualPrice.toFixed(4),
      cost: totalActualCost.toFixed(4),
      cashAfter: cashAfter.toFixed(4),
      executionMs: executionTime,
      orderId: finalOrder.orderId,
    });

    return trade;
  }

  /**
   * Wait for order to fill with timeout.
   */
  private async waitForFill(orderId: string, timeoutMs: number): Promise<OrderResponse> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getOrderStatus(orderId);
      
      if (status.status === 'FILLED' || status.status === 'CANCELLED') {
        return status;
      }
      
      // Poll every 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Timeout - cancel the order
    logger.warn('Order timeout, cancelling', { orderId });
    await this.cancelOrder(orderId);
    
    return {
      orderId,
      status: 'CANCELLED',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get execution metrics.
   */
  getMetrics() {
    return {
      ...this.metrics,
      fillRate: this.metrics.ordersSent > 0 
        ? (this.metrics.ordersFilled / this.metrics.ordersSent * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Estimate gas for a trade (Polygon network).
   * 
   * Note: Polymarket handles gas internally, but this gives an estimate
   * for settlement transactions.
   */
  async estimateGas(): Promise<{ gasPrice: string; estimatedCost: string }> {
    try {
      // Polygon gas oracle endpoint
      const response = await fetch('https://gasstation.polygon.technology/v2');
      const data = await response.json() as { fast: { maxFee: number } };
      
      const gasPrice = data.fast.maxFee;
      // Typical trade settlement uses ~100k gas
      const estimatedGas = 100000;
      const estimatedCostMatic = (gasPrice * estimatedGas) / 1e9;
      
      return {
        gasPrice: gasPrice.toFixed(2) + ' gwei',
        estimatedCost: estimatedCostMatic.toFixed(6) + ' MATIC',
      };
    } catch (error) {
      return {
        gasPrice: 'Unknown',
        estimatedCost: 'Unknown',
      };
    }
  }
}

/**
 * Create execution instance based on mode.
 */
export function createExecution(db: Database, mode: 'PAPER' | 'LIVE') {
  if (mode === 'LIVE') {
    const apiKey = process.env.POLYMARKET_API_KEY;
    const secret = process.env.POLYMARKET_SECRET;
    const passphrase = process.env.POLYMARKET_PASSPHRASE;

    if (!apiKey || !secret || !passphrase) {
      throw new Error('Live trading requires POLYMARKET_API_KEY, POLYMARKET_SECRET, and POLYMARKET_PASSPHRASE');
    }

    return new LiveExecution(db, { apiKey, secret, passphrase });
  }

  // Import paper execution dynamically to avoid circular deps
  const { PaperExecution } = require('./paperExecution.js');
  return new PaperExecution(db);
}

