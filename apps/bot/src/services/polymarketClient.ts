import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('polymarket-client');

/**
 * Polymarket API credentials from environment.
 */
interface PolymarketCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Get Polymarket credentials from environment variables.
 * Returns null if credentials are not configured.
 */
export function getCredentials(): PolymarketCredentials | null {
  const apiKey = process.env.POLYMARKET_API_KEY;
  const secret = process.env.POLYMARKET_SECRET;
  const passphrase = process.env.POLYMARKET_PASSPHRASE;

  if (!apiKey || !secret || !passphrase) {
    return null;
  }

  return { apiKey, secret, passphrase };
}

/**
 * Check if Polymarket credentials are configured.
 */
export function hasCredentials(): boolean {
  return getCredentials() !== null;
}

/**
 * PolymarketClient handles authenticated API requests.
 * 
 * This is prepared for future live trading implementation.
 * Currently used for paper trading - no real orders are placed.
 */
export class PolymarketClient {
  private credentials: PolymarketCredentials | null;
  private baseUrl: string;

  constructor() {
    this.credentials = getCredentials();
    this.baseUrl = process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com';

    if (this.credentials) {
      logger.info('Polymarket credentials loaded (ready for live trading)');
    } else {
      logger.info('No Polymarket credentials - paper trading only');
    }
  }

  /**
   * Check if client has valid credentials for live trading.
   */
  isAuthenticated(): boolean {
    return this.credentials !== null;
  }

  /**
   * Generate authentication headers for Polymarket CLOB API.
   * 
   * Note: This is a placeholder. Actual implementation would need
   * to follow Polymarket's signing requirements (HMAC-SHA256).
   */
  private getAuthHeaders(
    method: string,
    path: string,
    body?: string
  ): Record<string, string> {
    if (!this.credentials) {
      throw new Error('No credentials configured for authenticated requests');
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Note: Actual signing logic would go here
    // This is a placeholder structure matching Polymarket's expected format
    return {
      'POLY-API-KEY': this.credentials.apiKey,
      'POLY-PASSPHRASE': this.credentials.passphrase,
      'POLY-TIMESTAMP': timestamp,
      'POLY-SIGNATURE': '', // Would be computed signature
    };
  }

  /**
   * Fetch public market data (no auth required).
   */
  async getMarkets(): Promise<any[]> {
    const response = await fetch(`${this.baseUrl}/markets`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch markets: ${response.status}`);
    }

    return response.json() as Promise<any[]>;
  }

  /**
   * Fetch orderbook for a token (no auth required).
   */
  async getOrderbook(tokenId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/book?token_id=${tokenId}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch orderbook: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Place an order (LIVE TRADING - requires auth).
   * 
   * NOTE: This is NOT implemented for paper trading.
   * This is a placeholder for future live trading support.
   */
  async placeOrder(params: {
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
  }): Promise<any> {
    if (!this.credentials) {
      throw new Error('Cannot place orders without credentials');
    }

    // SAFETY: For paper trading, we don't actually call this
    throw new Error(
      'Live order placement is disabled. ' +
      'Implement placeOrder() in a LiveExecution class when ready for live trading.'
    );
  }

  /**
   * Cancel an order (LIVE TRADING - requires auth).
   */
  async cancelOrder(orderId: string): Promise<void> {
    if (!this.credentials) {
      throw new Error('Cannot cancel orders without credentials');
    }

    throw new Error('Live order cancellation is disabled for paper trading.');
  }

  /**
   * Get open orders (LIVE TRADING - requires auth).
   */
  async getOpenOrders(): Promise<any[]> {
    if (!this.credentials) {
      throw new Error('Cannot fetch orders without credentials');
    }

    throw new Error('Live order fetching is disabled for paper trading.');
  }
}

// Singleton instance
let clientInstance: PolymarketClient | null = null;

export function getPolymarketClient(): PolymarketClient {
  if (!clientInstance) {
    clientInstance = new PolymarketClient();
  }
  return clientInstance;
}

