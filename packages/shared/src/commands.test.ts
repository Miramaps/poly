import { describe, it, expect } from 'vitest';
import { parseCommand, validateAutoOnParams } from './commands.js';

describe('parseCommand', () => {
  describe('auto on', () => {
    it('parses shorthand format: auto on 10 0.95 0.15 4', () => {
      const result = parseCommand('auto on 10 0.95 0.15 4');
      expect(result.type).toBe('auto_on');
      expect(result.params).toEqual({
        shares: 10,
        sumTarget: 0.95,
        move: 0.15,
        windowMin: 4,
        dumpWindowSec: 3, // default
      });
    });

    it('parses with all positional args', () => {
      const result = parseCommand('auto on 20 0.92 0.20 5 10');
      expect(result.type).toBe('auto_on');
      expect(result.params).toEqual({
        shares: 20,
        sumTarget: 0.92,
        move: 0.20,
        windowMin: 5,
        dumpWindowSec: 10,
      });
    });

    it('parses key=value format', () => {
      const result = parseCommand('auto on shares=15 sumTarget=0.90');
      expect(result.type).toBe('auto_on');
      expect(result.params.shares).toBe(15);
      expect(result.params.sumTarget).toBe(0.90);
    });

    it('uses defaults when no args provided', () => {
      const result = parseCommand('auto on');
      expect(result.type).toBe('auto_on');
      expect(result.params.shares).toBe(10);
      expect(result.params.sumTarget).toBe(0.95);
    });
  });

  describe('auto off', () => {
    it('parses auto off', () => {
      const result = parseCommand('auto off');
      expect(result.type).toBe('auto_off');
    });
  });

  describe('status', () => {
    it('parses status command', () => {
      const result = parseCommand('status');
      expect(result.type).toBe('status');
    });
  });

  describe('bankroll', () => {
    it('parses bankroll set', () => {
      const result = parseCommand('bankroll set 5000');
      expect(result.type).toBe('bankroll_set');
      expect(result.params.amount).toBe(5000);
    });

    it('parses bankroll reset', () => {
      const result = parseCommand('bankroll reset');
      expect(result.type).toBe('bankroll_reset');
    });
  });

  describe('config', () => {
    it('parses config show', () => {
      const result = parseCommand('config show');
      expect(result.type).toBe('config_show');
    });

    it('parses config set with multiple values', () => {
      const result = parseCommand('config set sumTarget=0.90 move=0.12');
      expect(result.type).toBe('config_set');
      expect(result.params.updates).toEqual({
        sumTarget: 0.90,
        move: 0.12,
      });
    });
  });

  describe('market', () => {
    it('parses market mode auto', () => {
      const result = parseCommand('market mode auto');
      expect(result.type).toBe('market_mode');
      expect(result.params.mode).toBe('auto');
    });

    it('parses market select', () => {
      const result = parseCommand('market select btc-updown-15m-2024-01-01');
      expect(result.type).toBe('market_select');
      expect(result.params.slug).toBe('btc-updown-15m-2024-01-01');
    });
  });

  describe('lists', () => {
    it('parses cycles list', () => {
      const result = parseCommand('cycles list 50');
      expect(result.type).toBe('cycles_list');
      expect(result.params.limit).toBe(50);
    });

    it('parses trades list with default', () => {
      const result = parseCommand('trades list');
      expect(result.type).toBe('trades_list');
      expect(result.params.limit).toBe(50);
    });

    it('parses logs tail', () => {
      const result = parseCommand('logs tail 200');
      expect(result.type).toBe('logs_tail');
      expect(result.params.limit).toBe(200);
    });
  });

  describe('unknown', () => {
    it('returns unknown for invalid commands', () => {
      const result = parseCommand('invalid command');
      expect(result.type).toBe('unknown');
    });
  });
});

describe('validateAutoOnParams', () => {
  it('validates correct params', () => {
    const result = validateAutoOnParams({
      shares: 10,
      sumTarget: 0.95,
      move: 0.15,
      windowMin: 2,
      dumpWindowSec: 3,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects negative shares', () => {
    const result = validateAutoOnParams({
      shares: -5,
      sumTarget: 0.95,
      move: 0.15,
      windowMin: 2,
      dumpWindowSec: 3,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid sumTarget', () => {
    const result = validateAutoOnParams({
      shares: 10,
      sumTarget: 1.5,
      move: 0.15,
      windowMin: 2,
      dumpWindowSec: 3,
    });
    expect(result.valid).toBe(false);
  });
});

