import {
  parseCommand,
  validateAutoOnParams,
  getHelpText,
  type CommandResponse,
  type BotConfig,
} from '@poly-trader/shared';
import { TradingEngine } from '../core/engine.js';
import { Database } from '../services/database.js';
import { createBufferedLogger, getRecentLogs } from '../utils/logger.js';

const logger = createBufferedLogger('command');

export class CommandHandler {
  private engine: TradingEngine;
  private db: Database;

  constructor(engine: TradingEngine, db: Database) {
    this.engine = engine;
    this.db = db;
  }

  async execute(input: string): Promise<CommandResponse> {
    const parsed = parseCommand(input);
    logger.info(`Command received: ${parsed.type}`, { raw: parsed.raw });

    try {
      switch (parsed.type) {
        case 'auto_on':
          return await this.handleAutoOn(parsed.params);

        case 'auto_off':
          return await this.handleAutoOff();

        case 'status':
          return this.handleStatus();

        case 'bankroll_set':
          return await this.handleBankrollSet(parsed.params);

        case 'bankroll_reset':
          return await this.handleBankrollReset();

        case 'config_show':
          return this.handleConfigShow();

        case 'config_set':
          return await this.handleConfigSet(parsed.params);

        case 'market_mode':
          return await this.handleMarketMode(parsed.params);

        case 'market_select':
          return await this.handleMarketSelect(parsed.params);

        case 'cycles_list':
          return await this.handleCyclesList(parsed.params);

        case 'trades_list':
          return await this.handleTradesList(parsed.params);

        case 'logs_tail':
          return this.handleLogsTail(parsed.params);

        case 'help':
          return { success: true, message: getHelpText() };

        case 'unknown':
        default:
          return {
            success: false,
            message: `Unknown command: "${parsed.raw}". Type "help" for available commands.`,
          };
      }
    } catch (err) {
      logger.error(`Command failed: ${(err as Error).message}`);
      return {
        success: false,
        message: `Error: ${(err as Error).message}`,
      };
    }
  }

  private async handleAutoOn(params: Record<string, unknown>): Promise<CommandResponse> {
    const validation = validateAutoOnParams(params);

    if (!validation.valid) {
      return {
        success: false,
        message: `Invalid parameters:\n${validation.errors.join('\n')}`,
      };
    }

    const config: Partial<BotConfig> = {
      shares: validation.data!.shares,
      sumTarget: validation.data!.sumTarget,
      move: validation.data!.move,
      windowMin: validation.data!.windowMin,
      dumpWindowSec: validation.data!.dumpWindowSec,
    };

    await this.engine.enable(config);

    return {
      success: true,
      message: `Bot enabled with config:
  Shares: ${config.shares}
  Sum Target: ${config.sumTarget}
  Move Threshold: ${(config.move! * 100).toFixed(1)}%
  Watch Window: ${config.windowMin} min
  Dump Window: ${config.dumpWindowSec} sec`,
      data: config,
    };
  }

  private async handleAutoOff(): Promise<CommandResponse> {
    await this.engine.disable();
    return {
      success: true,
      message: 'Bot disabled. Current positions maintained.',
    };
  }

  private handleStatus(): CommandResponse {
    const status = this.engine.getStatus();
    const { bot, portfolio, currentMarket, currentCycle, watcherActive, watcherSecondsRemaining } = status;

    let marketInfo = 'No market selected';
    if (currentMarket) {
      const timeToStart = currentMarket.startTime
        ? Math.max(0, (currentMarket.startTime.getTime() - Date.now()) / 1000)
        : 0;
      const timeToEnd = currentMarket.endTime
        ? Math.max(0, (currentMarket.endTime.getTime() - Date.now()) / 1000)
        : 0;

      marketInfo = `Market: ${currentMarket.slug}
  Status: ${currentMarket.status}
  Time to start: ${timeToStart > 0 ? `${Math.floor(timeToStart / 60)}:${Math.floor(timeToStart % 60).toString().padStart(2, '0')}` : 'LIVE'}
  Time to end: ${Math.floor(timeToEnd / 60)}:${Math.floor(timeToEnd % 60).toString().padStart(2, '0')}`;
    }

    let cycleInfo = 'No active cycle';
    if (currentCycle) {
      cycleInfo = `Cycle: ${currentCycle.id.slice(0, 8)}...
  Status: ${currentCycle.status}
  Leg1: ${currentCycle.leg1Side || '-'} @ ${currentCycle.leg1Price?.toFixed(4) || '-'}
  Leg2: ${currentCycle.leg2Side || '-'} @ ${currentCycle.leg2Price?.toFixed(4) || '-'}`;
    }

    const upAsk = status.orderbooks.UP?.asks[0]?.price?.toFixed(4) || '-';
    const downAsk = status.orderbooks.DOWN?.asks[0]?.price?.toFixed(4) || '-';

    return {
      success: true,
      message: `
═══════════════════════════════════════════════════════════════════
                         POLY TRADER STATUS
═══════════════════════════════════════════════════════════════════

Bot: ${bot.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
Mode: ${bot.mode.toUpperCase()}
${marketInfo}

Watcher: ${watcherActive ? `ACTIVE (${Math.floor(watcherSecondsRemaining)}s remaining)` : 'INACTIVE'}

${cycleInfo}

─── ORDERBOOK ──────────────────────────────────────────────────────
UP Best Ask:   ${upAsk}
DOWN Best Ask: ${downAsk}

─── PORTFOLIO ──────────────────────────────────────────────────────
Cash:        $${portfolio.cash.toFixed(2)}
Positions:   UP: ${portfolio.positions.UP} | DOWN: ${portfolio.positions.DOWN}
Unrealized:  $${portfolio.unrealizedPnL.toFixed(2)}
Realized:    $${portfolio.realizedPnL.toFixed(2)}
Equity:      $${portfolio.equity.toFixed(2)}

═══════════════════════════════════════════════════════════════════
`.trim(),
      data: status,
    };
  }

  private async handleBankrollSet(params: Record<string, unknown>): Promise<CommandResponse> {
    const amount = params.amount as number;

    if (!amount || amount <= 0) {
      return { success: false, message: 'Invalid amount. Usage: bankroll set <amount>' };
    }

    await this.engine.setBankroll(amount);
    return {
      success: true,
      message: `Bankroll set to $${amount.toFixed(2)}`,
    };
  }

  private async handleBankrollReset(): Promise<CommandResponse> {
    await this.engine.resetBankroll();
    return {
      success: true,
      message: 'Bankroll reset to $1000.00. Positions cleared.',
    };
  }

  private handleConfigShow(): CommandResponse {
    const config = this.engine.getConfig();

    return {
      success: true,
      message: `
─── CURRENT CONFIG ─────────────────────────────────────────────────
Shares:         ${config.shares}
Sum Target:     ${config.sumTarget} (${((1 - config.sumTarget) * 100).toFixed(1)}% min profit)
Move Threshold: ${(config.move * 100).toFixed(1)}%
Watch Window:   ${config.windowMin} min
Dump Window:    ${config.dumpWindowSec} sec
Fee (bps):      ${config.feeBps}
───────────────────────────────────────────────────────────────────`.trim(),
      data: config,
    };
  }

  private async handleConfigSet(params: Record<string, unknown>): Promise<CommandResponse> {
    const updates = params.updates as Record<string, string | number>;

    if (!updates || Object.keys(updates).length === 0) {
      return {
        success: false,
        message: 'No updates provided. Usage: config set key=value ...',
      };
    }

    // Convert string values to appropriate types
    const typedUpdates: Partial<BotConfig> = {};
    
    for (const [key, value] of Object.entries(updates)) {
      const numValue = typeof value === 'number' ? value : parseFloat(value);
      
      if (key in { shares: 1, sumTarget: 1, move: 1, windowMin: 1, dumpWindowSec: 1, feeBps: 1 }) {
        (typedUpdates as any)[key] = numValue;
      }
    }

    await this.engine.setConfig(typedUpdates);

    return {
      success: true,
      message: `Config updated: ${JSON.stringify(typedUpdates)}`,
      data: this.engine.getConfig(),
    };
  }

  private async handleMarketMode(params: Record<string, unknown>): Promise<CommandResponse> {
    const mode = params.mode as string;

    if (mode !== 'auto' && mode !== 'manual') {
      return {
        success: false,
        message: 'Invalid mode. Use: market mode auto',
      };
    }

    await this.engine.setMarketMode(mode);
    return {
      success: true,
      message: `Market mode set to: ${mode.toUpperCase()}`,
    };
  }

  private async handleMarketSelect(params: Record<string, unknown>): Promise<CommandResponse> {
    const slug = params.slug as string;

    if (!slug) {
      return {
        success: false,
        message: 'No market slug provided. Usage: market select <slug>',
      };
    }

    try {
      await this.engine.selectMarket(slug);
      return {
        success: true,
        message: `Market selected: ${slug}`,
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
      };
    }
  }

  private async handleCyclesList(params: Record<string, unknown>): Promise<CommandResponse> {
    const limit = (params.limit as number) || 20;
    const cycles = await this.db.getCycles(limit);

    if (cycles.length === 0) {
      return { success: true, message: 'No cycles found.' };
    }

    const lines = cycles.map((c, i) => {
      const time = new Date(c.startedAt).toLocaleString();
      const leg1 = c.leg1Price ? `${c.leg1Side}@${c.leg1Price.toFixed(4)}` : '-';
      const leg2 = c.leg2Price ? `${c.leg2Side}@${c.leg2Price.toFixed(4)}` : '-';
      const pct = c.lockedInPct ? `${c.lockedInPct.toFixed(2)}%` : '-';

      return `${i + 1}. [${c.status.toUpperCase().padEnd(10)}] ${time} | L1: ${leg1} | L2: ${leg2} | Lock: ${pct}`;
    });

    return {
      success: true,
      message: `─── RECENT CYCLES ──────────────────────────────────────────────────\n${lines.join('\n')}`,
      data: cycles,
    };
  }

  private async handleTradesList(params: Record<string, unknown>): Promise<CommandResponse> {
    const limit = (params.limit as number) || 50;
    const trades = await this.db.getTrades(limit);

    if (trades.length === 0) {
      return { success: true, message: 'No trades found.' };
    }

    const lines = trades.map((t, i) => {
      const time = new Date(t.timestamp).toLocaleString();
      return `${i + 1}. L${t.leg} ${t.side.padEnd(4)} ${t.shares.toFixed(2)} @ ${t.price.toFixed(4)} = $${t.cost.toFixed(4)} | Cash: $${t.cashAfter.toFixed(2)}`;
    });

    return {
      success: true,
      message: `─── RECENT TRADES ──────────────────────────────────────────────────\n${lines.join('\n')}`,
      data: trades,
    };
  }

  private handleLogsTail(params: Record<string, unknown>): CommandResponse {
    const limit = (params.limit as number) || 100;
    const logs = getRecentLogs(limit);

    if (logs.length === 0) {
      return { success: true, message: 'No logs found.' };
    }

    const lines = logs.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString();
      const levelBadge = {
        info: 'INF',
        warn: 'WRN',
        error: 'ERR',
        debug: 'DBG',
      }[l.level] || l.level.toUpperCase();

      return `[${time}] ${levelBadge} [${l.name}] ${l.message}`;
    });

    return {
      success: true,
      message: lines.join('\n'),
      data: logs,
    };
  }
}

