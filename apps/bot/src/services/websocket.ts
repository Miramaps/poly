import WebSocket from 'ws';
import type { Orderbook, OrderbookLevel } from '@poly-trader/shared';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('websocket');

type OrderbookCallback = (orderbook: Orderbook) => void;

/**
 * WebSocketManager handles connections to Polymarket's orderbook WebSocket feeds.
 * 
 * Note: Polymarket uses a specific WebSocket protocol. This implementation
 * is structured for the CLOB WebSocket API but may need adjustments based
 * on actual API documentation.
 */
export class WebSocketManager {
  private connections: Map<string, WebSocket> = new Map();
  private callbacks: Map<string, OrderbookCallback> = new Map();
  private reconnectTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private baseUrl: string;

  constructor() {
    // Polymarket CLOB WebSocket endpoint
    this.baseUrl = process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  }

  /**
   * Subscribe to orderbook updates for a specific token.
   */
  subscribeToOrderbook(tokenId: string, callback: OrderbookCallback) {
    if (this.connections.has(tokenId)) {
      logger.warn('Already subscribed to token', { tokenId });
      this.callbacks.set(tokenId, callback);
      return;
    }

    this.callbacks.set(tokenId, callback);
    this.connect(tokenId);
  }

  private connect(tokenId: string) {
    try {
      const wsUrl = `${this.baseUrl}`;
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        logger.info('WebSocket connected', { tokenId });
        
        // Subscribe to the token's orderbook
        const subscribeMsg = {
          type: 'subscribe',
          channel: 'book',
          assets_id: tokenId,
        };
        ws.send(JSON.stringify(subscribeMsg));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(tokenId, message);
        } catch (err) {
          logger.error('Failed to parse WebSocket message', { error: (err as Error).message });
        }
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error', { tokenId, error: err.message });
      });

      ws.on('close', () => {
        logger.warn('WebSocket closed', { tokenId });
        this.connections.delete(tokenId);
        this.scheduleReconnect(tokenId);
      });

      this.connections.set(tokenId, ws);
    } catch (err) {
      logger.error('Failed to connect WebSocket', { tokenId, error: (err as Error).message });
      this.scheduleReconnect(tokenId);
    }
  }

  private handleMessage(tokenId: string, message: any) {
    const callback = this.callbacks.get(tokenId);
    if (!callback) return;

    // Parse orderbook update
    // Note: Actual message format depends on Polymarket's API
    if (message.type === 'book' || message.event === 'book') {
      const orderbook = this.parseOrderbook(message);
      if (orderbook) {
        callback(orderbook);
      }
    }
  }

  private parseOrderbook(message: any): Orderbook | null {
    try {
      // Polymarket CLOB format (may need adjustment based on actual API)
      const bids: OrderbookLevel[] = (message.bids || []).map((b: any) => ({
        price: parseFloat(b.price || b[0]),
        size: parseFloat(b.size || b[1]),
      }));

      const asks: OrderbookLevel[] = (message.asks || []).map((a: any) => ({
        price: parseFloat(a.price || a[0]),
        size: parseFloat(a.size || a[1]),
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

  private scheduleReconnect(tokenId: string) {
    // Clear existing timeout
    const existingTimeout = this.reconnectTimeouts.get(tokenId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Only reconnect if we still have a callback registered
    if (!this.callbacks.has(tokenId)) return;

    const timeout = setTimeout(() => {
      logger.info('Attempting to reconnect', { tokenId });
      this.connect(tokenId);
    }, 5000);

    this.reconnectTimeouts.set(tokenId, timeout);
  }

  /**
   * Unsubscribe from a token's orderbook updates.
   */
  unsubscribe(tokenId: string) {
    const ws = this.connections.get(tokenId);
    if (ws) {
      ws.close();
      this.connections.delete(tokenId);
    }
    this.callbacks.delete(tokenId);

    const timeout = this.reconnectTimeouts.get(tokenId);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(tokenId);
    }
  }

  /**
   * Disconnect all WebSocket connections.
   */
  disconnect() {
    for (const [tokenId, ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
    this.callbacks.clear();

    for (const timeout of this.reconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.reconnectTimeouts.clear();

    logger.info('All WebSocket connections closed');
  }

  /**
   * Check if connected to a specific token.
   */
  isConnected(tokenId: string): boolean {
    const ws = this.connections.get(tokenId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
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

