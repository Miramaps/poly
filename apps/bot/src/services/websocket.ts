import WebSocket from 'ws';
import type { Orderbook, OrderbookLevel } from '@poly-trader/shared';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('websocket');

type OrderbookCallback = (orderbook: Orderbook) => void;

// Polymarket CLOB REST API endpoint
const CLOB_API = 'https://clob.polymarket.com';

/**
 * WebSocketManager handles orderbook data from Polymarket.
 * Uses REST API polling as primary method (more reliable than WebSocket).
 */
export class WebSocketManager {
  private callbacks: Map<string, OrderbookCallback> = new Map();
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastOrderbooks: Map<string, Orderbook> = new Map();

  constructor() {}

  /**
   * Subscribe to orderbook updates for a specific token.
   * Uses REST API polling for reliability.
   */
  subscribeToOrderbook(tokenId: string, callback: OrderbookCallback) {
    if (this.pollIntervals.has(tokenId)) {
      logger.warn('Already subscribed to token', { tokenId: tokenId.slice(0, 20) + '...' });
      this.callbacks.set(tokenId, callback);
      return;
    }

    this.callbacks.set(tokenId, callback);
    
    // Fetch immediately
    this.fetchOrderbook(tokenId);
    
    // Then poll every 500ms for live updates
    const interval = setInterval(() => {
      this.fetchOrderbook(tokenId);
    }, 500);
    
    this.pollIntervals.set(tokenId, interval);
    logger.info('Subscribed to orderbook', { tokenId: tokenId.slice(0, 20) + '...' });
  }

  /**
   * Fetch orderbook from REST API
   */
  private async fetchOrderbook(tokenId: string) {
    try {
      const response = await fetch(`${CLOB_API}/book?token_id=${tokenId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const orderbook = this.parseOrderbook(data);
      
      if (orderbook) {
        this.lastOrderbooks.set(tokenId, orderbook);
        const callback = this.callbacks.get(tokenId);
        if (callback) {
          callback(orderbook);
        }
      }
    } catch (err) {
      // Only log errors occasionally to avoid spam
      const lastOb = this.lastOrderbooks.get(tokenId);
      if (!lastOb || Date.now() - lastOb.timestamp > 10000) {
        logger.error('Failed to fetch orderbook', { 
          tokenId: tokenId.slice(0, 20) + '...', 
          error: (err as Error).message 
        });
      }
    }
  }

  private parseOrderbook(data: any): Orderbook | null {
    try {
      // Polymarket CLOB REST API format
      const bids: OrderbookLevel[] = (data.bids || []).map((b: any) => ({
        price: parseFloat(b.price),
        size: parseFloat(b.size),
      }));

      const asks: OrderbookLevel[] = (data.asks || []).map((a: any) => ({
        price: parseFloat(a.price),
        size: parseFloat(a.size),
      }));

      // Sort: bids descending, asks ascending
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      return {
        bids,
        asks,
        timestamp: Date.now(),
      };
    } catch (err) {
      logger.error('Failed to parse orderbook', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Unsubscribe from a token's orderbook updates.
   */
  unsubscribe(tokenId: string) {
    const interval = this.pollIntervals.get(tokenId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(tokenId);
    }
    this.callbacks.delete(tokenId);
    this.lastOrderbooks.delete(tokenId);
  }

  /**
   * Disconnect all connections.
   */
  disconnect() {
    for (const interval of this.pollIntervals.values()) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
    this.callbacks.clear();
    this.lastOrderbooks.clear();
    logger.info('All orderbook subscriptions stopped');
  }

  /**
   * Check if subscribed to a specific token.
   */
  isConnected(tokenId: string): boolean {
    return this.pollIntervals.has(tokenId);
  }

  /**
   * Get connection status for all subscribed tokens.
   */
  getConnectionStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const tokenId of this.callbacks.keys()) {
      status[tokenId] = this.isConnected(tokenId);
    }
    return status;
  }
}

/**
 * Mock WebSocket manager for simulation/testing.
 * Generates random orderbook updates for testing purposes.
 */
export class MockWebSocketManager extends WebSocketManager {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private prices: Map<string, number> = new Map();

  subscribeToOrderbook(tokenId: string, callback: OrderbookCallback) {
    // Initialize with a random starting price
    const startPrice = 0.4 + Math.random() * 0.2; // 0.4 - 0.6
    this.prices.set(tokenId, startPrice);

    // Generate updates every 100ms
    const interval = setInterval(() => {
      const currentPrice = this.prices.get(tokenId) || 0.5;
      
      // Random walk with occasional larger moves
      let delta = (Math.random() - 0.5) * 0.02;
      if (Math.random() < 0.05) {
        // 5% chance of larger move (simulating dump)
        delta = (Math.random() - 0.5) * 0.1;
      }

      const newPrice = Math.max(0.01, Math.min(0.99, currentPrice + delta));
      this.prices.set(tokenId, newPrice);

      const orderbook: Orderbook = {
        bids: [
          { price: newPrice - 0.01, size: 100 + Math.random() * 100 },
          { price: newPrice - 0.02, size: 200 + Math.random() * 200 },
        ],
        asks: [
          { price: newPrice + 0.01, size: 100 + Math.random() * 100 },
          { price: newPrice + 0.02, size: 200 + Math.random() * 200 },
        ],
        timestamp: Date.now(),
      };

      callback(orderbook);
    }, 100);

    this.intervals.set(tokenId, interval);
  }

  disconnect() {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    this.prices.clear();
  }
}

