import type { DumpDetection, PriceSnapshot } from '@poly-trader/shared';

/**
 * DumpDetector tracks price snapshots and detects rapid price drops.
 * 
 * Detection logic:
 * - Maintains a rolling window of price snapshots for each side (UP/DOWN)
 * - A "dump" is detected when: (maxPrice - currentPrice) / maxPrice >= move threshold
 * - The max price is the highest price seen within the dumpWindowSec timeframe
 * - Uses best ask as the price reference (conservative - this is what you'd pay to buy)
 */
export class DumpDetector {
  private snapshots: {
    UP: PriceSnapshot[];
    DOWN: PriceSnapshot[];
  } = { UP: [], DOWN: [] };

  private triggered: { UP: boolean; DOWN: boolean } = { UP: false, DOWN: false };
  private maxWindowMs = 60000; // Keep max 60 seconds of history

  reset() {
    this.snapshots = { UP: [], DOWN: [] };
    this.triggered = { UP: false, DOWN: false };
  }

  // Minimum valid price - below this is considered empty orderbook
  private readonly MIN_VALID_PRICE = 0.05;

  addPriceSnapshot(side: 'UP' | 'DOWN', price: number) {
    // Ignore invalid prices (0, negative, or empty orderbook indicator)
    if (price <= 0 || price < this.MIN_VALID_PRICE) return;

    const now = Date.now();
    this.snapshots[side].push({ timestamp: now, price });

    // Trim old snapshots
    const cutoff = now - this.maxWindowMs;
    this.snapshots[side] = this.snapshots[side].filter(s => s.timestamp >= cutoff);
  }

  /**
   * Detect if a dump has occurred on either side.
   * 
   * @param moveThreshold - Minimum price drop percentage (e.g., 0.15 = 15%)
   * @param dumpWindowSec - Time window in seconds to look for the max price
   * @returns DumpDetection result
   */
  detectDump(moveThreshold: number, dumpWindowSec: number): DumpDetection {
    const now = Date.now();
    const windowMs = dumpWindowSec * 1000;

    // Check each side
    for (const side of ['UP', 'DOWN'] as const) {
      // Skip if already triggered for this side
      if (this.triggered[side]) continue;

      const detection = this.detectDumpForSide(side, moveThreshold, windowMs, now);
      if (detection.detected) {
        this.triggered[side] = true;
        return detection;
      }
    }

    return {
      detected: false,
      side: null,
      dropPct: 0,
      maxPrice: 0,
      currentPrice: 0,
    };
  }

  private detectDumpForSide(
    side: 'UP' | 'DOWN',
    moveThreshold: number,
    windowMs: number,
    now: number
  ): DumpDetection {
    const snapshots = this.snapshots[side];
    if (snapshots.length < 2) {
      return { detected: false, side: null, dropPct: 0, maxPrice: 0, currentPrice: 0 };
    }

    const cutoff = now - windowMs;
    const recentSnapshots = snapshots.filter(s => s.timestamp >= cutoff);
    
    if (recentSnapshots.length < 2) {
      return { detected: false, side: null, dropPct: 0, maxPrice: 0, currentPrice: 0 };
    }

    // Find max price in window
    const maxPrice = Math.max(...recentSnapshots.map(s => s.price));
    const currentPrice = recentSnapshots[recentSnapshots.length - 1].price;

    // Calculate drop percentage
    const dropPct = (maxPrice - currentPrice) / maxPrice;

    if (dropPct >= moveThreshold) {
      return {
        detected: true,
        side,
        dropPct,
        maxPrice,
        currentPrice,
      };
    }

    return { detected: false, side: null, dropPct, maxPrice, currentPrice };
  }

  /**
   * Check if a specific side has been triggered (already bought)
   */
  isTriggered(side: 'UP' | 'DOWN'): boolean {
    return this.triggered[side];
  }

  /**
   * Get current dump detection status for logging.
   */
  getStatus(): { dropPct: number; maxPrice: number; currentPrice: number; side: 'UP' | 'DOWN' | null } {
    let maxDrop = 0;
    let maxSide: 'UP' | 'DOWN' | null = null;
    let maxPrice = 0;
    let currentPrice = 0;

    for (const side of ['UP', 'DOWN'] as const) {
      const snapshots = this.snapshots[side];
      if (snapshots.length < 2) continue;

      const max = Math.max(...snapshots.map(s => s.price));
      const current = snapshots[snapshots.length - 1]?.price || 0;
      const drop = max > 0 ? (max - current) / max : 0;

      if (drop > maxDrop) {
        maxDrop = drop;
        maxSide = side;
        maxPrice = max;
        currentPrice = current;
      }
    }

    return { dropPct: maxDrop, maxPrice, currentPrice, side: maxSide };
  }

  /**
   * Get current prices for debugging
   */
  getCurrentPrices(): { UP: number | null; DOWN: number | null } {
    const upSnapshots = this.snapshots.UP;
    const downSnapshots = this.snapshots.DOWN;

    return {
      UP: upSnapshots.length > 0 ? upSnapshots[upSnapshots.length - 1].price : null,
      DOWN: downSnapshots.length > 0 ? downSnapshots[downSnapshots.length - 1].price : null,
    };
  }

  /**
   * Get snapshot count for debugging
   */
  getSnapshotCounts(): { UP: number; DOWN: number } {
    return {
      UP: this.snapshots.UP.length,
      DOWN: this.snapshots.DOWN.length,
    };
  }
}

// Unit tests for dump detection
export function testDumpDetection() {
  const detector = new DumpDetector();

  // Simulate price sequence: 0.60 -> 0.55 -> 0.50 (16.7% drop)
  const baseTime = Date.now();

  detector.addPriceSnapshot('UP', 0.60);
  detector.addPriceSnapshot('UP', 0.58);
  detector.addPriceSnapshot('UP', 0.55);
  detector.addPriceSnapshot('UP', 0.52);
  detector.addPriceSnapshot('UP', 0.50);

  const result = detector.detectDump(0.15, 10);

  console.log('Test result:', result);
  console.log('Expected: detected=true, side=UP, dropPct>=0.15');

  return result.detected && result.side === 'UP' && result.dropPct >= 0.15;
}

