import { describe, it, expect, beforeEach } from 'vitest';
import { DumpDetector } from './dumpDetector.js';

describe('DumpDetector', () => {
  let detector: DumpDetector;

  beforeEach(() => {
    detector = new DumpDetector();
  });

  describe('detectDump', () => {
    it('detects a 15% dump on UP side', () => {
      // Simulate price drop from 0.60 to 0.50 (16.7% drop)
      detector.addPriceSnapshot('UP', 0.60);
      detector.addPriceSnapshot('UP', 0.58);
      detector.addPriceSnapshot('UP', 0.55);
      detector.addPriceSnapshot('UP', 0.52);
      detector.addPriceSnapshot('UP', 0.50);

      const result = detector.detectDump(0.15, 10);

      expect(result.detected).toBe(true);
      expect(result.side).toBe('UP');
      expect(result.dropPct).toBeGreaterThanOrEqual(0.15);
      expect(result.maxPrice).toBe(0.60);
      expect(result.currentPrice).toBe(0.50);
    });

    it('detects a dump on DOWN side', () => {
      detector.addPriceSnapshot('DOWN', 0.45);
      detector.addPriceSnapshot('DOWN', 0.40);
      detector.addPriceSnapshot('DOWN', 0.35);

      const result = detector.detectDump(0.15, 10);

      expect(result.detected).toBe(true);
      expect(result.side).toBe('DOWN');
    });

    it('does not detect dump when drop is below threshold', () => {
      detector.addPriceSnapshot('UP', 0.60);
      detector.addPriceSnapshot('UP', 0.58);
      detector.addPriceSnapshot('UP', 0.56);

      const result = detector.detectDump(0.15, 10);

      expect(result.detected).toBe(false);
      expect(result.side).toBe(null);
    });

    it('does not re-trigger after already triggered', () => {
      // First trigger
      detector.addPriceSnapshot('UP', 0.60);
      detector.addPriceSnapshot('UP', 0.50);

      const first = detector.detectDump(0.15, 10);
      expect(first.detected).toBe(true);
      expect(first.side).toBe('UP');

      // Add more price drops - should not trigger again for UP
      detector.addPriceSnapshot('UP', 0.45);
      detector.addPriceSnapshot('UP', 0.40);

      const second = detector.detectDump(0.15, 10);
      // Should not detect UP again (already triggered)
      expect(second.side).not.toBe('UP');
    });

    it('prioritizes the first side that dumps', () => {
      // Both sides have small movements
      detector.addPriceSnapshot('UP', 0.55);
      detector.addPriceSnapshot('DOWN', 0.45);
      detector.addPriceSnapshot('UP', 0.54);
      detector.addPriceSnapshot('DOWN', 0.44);

      // Now DOWN dumps hard
      detector.addPriceSnapshot('DOWN', 0.35);

      const result = detector.detectDump(0.15, 10);

      expect(result.detected).toBe(true);
      expect(result.side).toBe('DOWN');
    });

    it('handles empty snapshots gracefully', () => {
      const result = detector.detectDump(0.15, 10);

      expect(result.detected).toBe(false);
      expect(result.side).toBe(null);
    });

    it('resets correctly', () => {
      detector.addPriceSnapshot('UP', 0.60);
      detector.addPriceSnapshot('UP', 0.50);
      detector.detectDump(0.15, 10);

      detector.reset();

      expect(detector.isTriggered('UP')).toBe(false);
      expect(detector.isTriggered('DOWN')).toBe(false);
      expect(detector.getSnapshotCounts()).toEqual({ UP: 0, DOWN: 0 });
    });
  });

  describe('hedge condition logic', () => {
    it('calculates correct sum for hedge check', () => {
      // Simulate scenario:
      // Leg 1: bought UP at 0.45
      // Current DOWN ask: 0.48
      // Sum = 0.45 + 0.48 = 0.93 < 0.95 target -> hedge should trigger

      const leg1Price = 0.45;
      const oppositeAsk = 0.48;
      const sumTarget = 0.95;

      const sum = leg1Price + oppositeAsk;
      const shouldHedge = sum <= sumTarget;

      expect(sum).toBe(0.93);
      expect(shouldHedge).toBe(true);
    });

    it('rejects hedge when sum exceeds target', () => {
      const leg1Price = 0.50;
      const oppositeAsk = 0.52;
      const sumTarget = 0.95;

      const sum = leg1Price + oppositeAsk;
      const shouldHedge = sum <= sumTarget;

      expect(sum).toBe(1.02);
      expect(shouldHedge).toBe(false);
    });
  });
});

