import type { Market } from '@poly-trader/shared';
import { Database } from './database.js';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('marketDiscovery');

/**
 * MarketDiscovery handles finding and tracking Polymarket BTC Up/Down markets.
 * 
 * Strategy:
 * 1. Search for events by slug pattern (btc-updown-15m-{timestamp})
 * 2. Fetch full event details by ID to get token IDs
 * 3. Extract clobTokenIds and match with outcomes
 */
export class MarketDiscovery {
  private db: Database;
  private gammaUrl: string;
  private lastFetch: number = 0;
  private fetchIntervalMs = 10000; // 10 seconds between API calls
  private cachedMarkets: Market[] = [];

  constructor(db: Database) {
    this.db = db;
    this.gammaUrl = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com';
  }

  /**
   * Find the next upcoming BTC Up/Down 15-minute market.
   */
  async findNextBTCUpDownMarket(): Promise<Market | null> {
    try {
      const now = Date.now();
      if (now - this.lastFetch < this.fetchIntervalMs && this.cachedMarkets.length > 0) {
        return this.getNextFromCache();
      }

      const markets = await this.fetchBTCUpDownMarkets();
      this.cachedMarkets = markets;
      this.lastFetch = now;

      if (markets.length > 0) {
        logger.info(`📡 Found ${markets.length} BTC Up/Down markets`);
        for (const m of markets.slice(0, 3)) {
          const link = `https://polymarket.com/event/${m.slug}`;
          const status = m.status === 'live' ? '🟢 LIVE' : m.status === 'upcoming' ? '🟡 SOON' : '⚫ ENDED';
          logger.info(`   ${status} ${m.slug} → ${link}`);
        }
        if (markets.length > 3) {
          logger.info(`   ... and ${markets.length - 3} more`);
        }
      }

      return this.getNextFromCache();
    } catch (err) {
      logger.error('Failed to find BTC Up/Down market', { error: (err as Error).message });
      return null;
    }
  }

  private getNextFromCache(): Market | null {
    const now = new Date();
    
    // Find upcoming or live markets sorted by start time
    const upcoming = this.cachedMarkets
      .filter(m => m.status === 'upcoming' || m.status === 'live')
      .filter(m => !m.endTime || m.endTime > now)
      .sort((a, b) => {
        const aTime = a.startTime?.getTime() || 0;
        const bTime = b.startTime?.getTime() || 0;
        return aTime - bTime;
      });

    return upcoming[0] || null;
  }

  /**
   * Fetch BTC Up/Down markets from Polymarket Gamma API.
   */
  private async fetchBTCUpDownMarkets(): Promise<Market[]> {
    const markets: Market[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSec / 900) * 900; // Round to 15-min

    // Search for markets in the next 2 hours (8 x 15-minute windows)
    const slugPromises: Promise<Market | null>[] = [];
    
    for (let i = -1; i < 8; i++) {
      const targetTime = windowStart + (i * 900);
      const slug = `btc-updown-15m-${targetTime}`;
      slugPromises.push(this.fetchMarketBySlug(slug));
    }

    const results = await Promise.all(slugPromises);
    
    for (const market of results) {
      if (market && market.tokenUp && market.tokenDown) {
        markets.push(market);
      }
    }

    return markets;
  }

  /**
   * Fetch a specific market by slug, including full token details.
   */
  private async fetchMarketBySlug(slug: string): Promise<Market | null> {
    try {
      // Step 1: Get event ID from slug search
      const searchUrl = `${this.gammaUrl}/events?slug=${slug}`;
      const searchRes = await fetch(searchUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (!searchRes.ok) return null;

      const searchData = await searchRes.json() as any[];
      if (!searchData || searchData.length === 0) return null;

      const eventId = searchData[0].id;
      if (!eventId) return null;

      // Step 2: Fetch full event details by ID
      const detailUrl = `${this.gammaUrl}/events/${eventId}`;
      const detailRes = await fetch(detailUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (!detailRes.ok) return null;

      const event = await detailRes.json() as any;
      
      // Step 3: Extract market data
      const eventMarkets = event.markets || [];
      if (eventMarkets.length === 0) return null;

      const market = eventMarkets[0];
      
      // Parse token IDs from clobTokenIds JSON string
      let tokenIds: string[] = [];
      let outcomes: string[] = [];
      
      try {
        tokenIds = JSON.parse(market.clobTokenIds || '[]');
        outcomes = JSON.parse(market.outcomes || '[]');
      } catch {
        return null;
      }

      if (tokenIds.length < 2 || outcomes.length < 2) return null;

      // Match token IDs with outcomes
      const upIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'up');
      const downIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'down');
      
      if (upIndex === -1 || downIndex === -1) return null;

      const tokenUp = tokenIds[upIndex];
      const tokenDown = tokenIds[downIndex];

      // Parse timing
      const startTime = market.eventStartTime 
        ? new Date(market.eventStartTime)
        : this.parseTimestampFromSlug(slug);
      
      const endTime = startTime 
        ? new Date(startTime.getTime() + 15 * 60 * 1000)
        : undefined;

      // Determine status
      const now = new Date();
      let status: Market['status'] = 'upcoming';
      
      if (market.closed) {
        status = 'ended';
      } else if (startTime && now >= startTime) {
        status = endTime && now >= endTime ? 'ended' : 'live';
      }

      logger.debug('Fetched market', {
        slug,
        conditionId: market.conditionId?.slice(0, 20),
        tokenUp: tokenUp?.slice(0, 20),
        status,
      });

      return {
        slug,
        question: market.question || event.title,
        startTime,
        endTime,
        tokenUp,
        tokenDown,
        conditionId: market.conditionId,
        status,
        resolution: null,
      };
    } catch (err) {
      // Silently fail for individual market fetches
      return null;
    }
  }

  /**
   * Parse timestamp from slug (btc-updown-15m-{timestamp})
   */
  private parseTimestampFromSlug(slug: string): Date | undefined {
    const match = slug.match(/(\d{10,})/);
    if (match) {
      const ts = parseInt(match[1], 10);
      return new Date(ts * 1000);
    }
    return undefined;
  }

  /**
   * Get a specific market by slug.
   */
  async getMarketBySlug(slug: string): Promise<Market | null> {
    // Check cache first
    const cached = this.cachedMarkets.find(m => m.slug === slug);
    if (cached) return cached;

    // Check database
    const dbMarket = await this.db.getMarketBySlug(slug);
    if (dbMarket) return dbMarket;

    // Fetch from API
    return this.fetchMarketBySlug(slug);
  }

  /**
   * Get all cached markets.
   */
  getCachedMarkets(): Market[] {
    return [...this.cachedMarkets];
  }

  /**
   * Force refresh of market cache.
   */
  async refresh(): Promise<void> {
    this.lastFetch = 0;
    await this.findNextBTCUpDownMarket();
  }
}
