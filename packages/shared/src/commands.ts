import { z } from 'zod';
import { DEFAULT_CONFIG } from './constants.js';

// Command types
export type CommandType =
  | 'auto_on'
  | 'auto_off'
  | 'status'
  | 'bankroll_set'
  | 'bankroll_reset'
  | 'config_show'
  | 'config_set'
  | 'market_mode'
  | 'market_select'
  | 'cycles_list'
  | 'trades_list'
  | 'logs_tail'
  | 'help'
  | 'unknown';

// Parsed command result
export interface ParsedCommand {
  type: CommandType;
  params: Record<string, unknown>;
  raw: string;
}

// Command parser
export function parseCommand(input: string): ParsedCommand {
  const raw = input.trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || '';

  // auto on <shares> [sum=0.95] [move=0.15] [windowMin=2] [dumpWindowSec=3]
  // Also accepts shorthand: auto on 10 0.95 0.15 4
  if (cmd === 'auto' && parts[1]?.toLowerCase() === 'on') {
    const args = parts.slice(2);
    
    if (args.length === 0) {
      return {
        type: 'auto_on',
        params: {
          shares: DEFAULT_CONFIG.shares,
          sumTarget: DEFAULT_CONFIG.sumTarget,
          move: DEFAULT_CONFIG.move,
          windowMin: DEFAULT_CONFIG.windowMin,
          dumpWindowSec: DEFAULT_CONFIG.dumpWindowSec,
        },
        raw,
      };
    }

    // Check if using key=value format or positional
    const hasKeyValue = args.some(a => a.includes('='));
    
    if (hasKeyValue) {
      // Parse key=value format
      const params: Record<string, number> = {
        shares: DEFAULT_CONFIG.shares,
        sumTarget: DEFAULT_CONFIG.sumTarget,
        move: DEFAULT_CONFIG.move,
        windowMin: DEFAULT_CONFIG.windowMin,
        dumpWindowSec: DEFAULT_CONFIG.dumpWindowSec,
      };
      
      for (const arg of args) {
        if (arg.includes('=')) {
          const [key, val] = arg.split('=');
          const num = parseFloat(val);
          if (!isNaN(num)) {
            // Map common aliases
            const normalizedKey = key.toLowerCase()
              .replace('sum', 'sumTarget')
              .replace('window', 'windowMin')
              .replace('dump', 'dumpWindowSec');
            params[normalizedKey] = num;
          }
        } else {
          // First non-key=value is shares
          const num = parseFloat(arg);
          if (!isNaN(num) && params.shares === DEFAULT_CONFIG.shares) {
            params.shares = num;
          }
        }
      }
      
      return { type: 'auto_on', params, raw };
    } else {
      // Positional format: shares sum move windowMin [dumpWindowSec]
      const shares = parseFloat(args[0]) || DEFAULT_CONFIG.shares;
      const sumTarget = parseFloat(args[1]) || DEFAULT_CONFIG.sumTarget;
      const move = parseFloat(args[2]) || DEFAULT_CONFIG.move;
      const windowMin = parseFloat(args[3]) || DEFAULT_CONFIG.windowMin;
      const dumpWindowSec = parseFloat(args[4]) || DEFAULT_CONFIG.dumpWindowSec;
      
      return {
        type: 'auto_on',
        params: { shares, sumTarget, move, windowMin, dumpWindowSec },
        raw,
      };
    }
  }

  // auto off
  if (cmd === 'auto' && parts[1]?.toLowerCase() === 'off') {
    return { type: 'auto_off', params: {}, raw };
  }

  // status
  if (cmd === 'status') {
    return { type: 'status', params: {}, raw };
  }

  // bankroll set <amount>
  if (cmd === 'bankroll' && parts[1]?.toLowerCase() === 'set') {
    const amount = parseFloat(parts[2]) || 0;
    return { type: 'bankroll_set', params: { amount }, raw };
  }

  // bankroll reset
  if (cmd === 'bankroll' && parts[1]?.toLowerCase() === 'reset') {
    return { type: 'bankroll_reset', params: {}, raw };
  }

  // config show
  if (cmd === 'config' && parts[1]?.toLowerCase() === 'show') {
    return { type: 'config_show', params: {}, raw };
  }

  // config set key=value ...
  if (cmd === 'config' && parts[1]?.toLowerCase() === 'set') {
    const updates: Record<string, string | number> = {};
    for (const arg of parts.slice(2)) {
      if (arg.includes('=')) {
        const [key, val] = arg.split('=');
        const num = parseFloat(val);
        updates[key] = isNaN(num) ? val : num;
      }
    }
    return { type: 'config_set', params: { updates }, raw };
  }

  // market mode auto
  if (cmd === 'market' && parts[1]?.toLowerCase() === 'mode') {
    const mode = parts[2]?.toLowerCase() || 'auto';
    return { type: 'market_mode', params: { mode }, raw };
  }

  // market select <slug>
  if (cmd === 'market' && parts[1]?.toLowerCase() === 'select') {
    const slug = parts[2] || '';
    return { type: 'market_select', params: { slug }, raw };
  }

  // cycles list
  if (cmd === 'cycles' && parts[1]?.toLowerCase() === 'list') {
    const limit = parseInt(parts[2]) || 20;
    return { type: 'cycles_list', params: { limit }, raw };
  }

  // trades list
  if (cmd === 'trades' && parts[1]?.toLowerCase() === 'list') {
    const limit = parseInt(parts[2]) || 50;
    return { type: 'trades_list', params: { limit }, raw };
  }

  // logs tail
  if (cmd === 'logs' && parts[1]?.toLowerCase() === 'tail') {
    const limit = parseInt(parts[2]) || 100;
    return { type: 'logs_tail', params: { limit }, raw };
  }

  // help
  if (cmd === 'help') {
    return { type: 'help', params: {}, raw };
  }

  return { type: 'unknown', params: {}, raw };
}

// Validate auto_on params
export function validateAutoOnParams(params: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  data?: {
    shares: number;
    sumTarget: number;
    move: number;
    windowMin: number;
    dumpWindowSec: number;
  };
} {
  const schema = z.object({
    shares: z.number().positive('Shares must be positive'),
    sumTarget: z.number().min(0.5, 'Sum target must be >= 0.5').max(1, 'Sum target must be <= 1'),
    move: z.number().min(0.01, 'Move must be >= 0.01').max(0.5, 'Move must be <= 0.5'),
    windowMin: z.number().positive('Window must be positive').max(15, 'Window must be <= 15'),
    dumpWindowSec: z.number().positive('Dump window must be positive').max(60, 'Dump window must be <= 60'),
  });

  const result = schema.safeParse(params);
  
  if (result.success) {
    return { valid: true, errors: [], data: result.data as {
      shares: number;
      sumTarget: number;
      move: number;
      windowMin: number;
      dumpWindowSec: number;
    }};
  }
  
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

// Generate help text
export function getHelpText(): string {
  return `
Available Commands:
───────────────────────────────────────────────────────────────────
  auto on <shares> [sum] [move] [windowMin] [dumpWindowSec]
      Start the bot with specified parameters
      Example: auto on 10 0.95 0.15 4
      
  auto off
      Stop the bot
      
  status
      Show current bot status, positions, and PnL
      
  bankroll set <amount>
      Set the paper trading bankroll
      
  bankroll reset
      Reset bankroll to $1000
      
  config show
      Show current configuration
      
  config set key=value ...
      Update configuration values
      Example: config set sumTarget=0.92 move=0.12
      
  market mode auto
      Auto-detect next BTC Up/Down round
      
  market select <slug>
      Manually select a market by slug
      
  cycles list [limit]
      List recent trading cycles
      
  trades list [limit]
      List recent trades
      
  logs tail [limit]
      Show recent log entries
      
  help
      Show this help message
───────────────────────────────────────────────────────────────────
`.trim();
}

