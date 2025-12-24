import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import type {
  BotConfig,
  BotState,
  Market,
  Cycle,
  Portfolio,
  LiveStatus,
  TokenOrderbooks,
  DumpDetection,
  HedgeCondition,
} from '@poly-trader/shared';
import { DEFAULT_CONFIG, CYCLE_STATUS, SIDE } from '@poly-trader/shared';
import { Database } from '../services/database.js';
import { WebSocketManager } from '../services/websocket.js';
import { MarketDiscovery } from '../services/marketDiscovery.js';
import { PaperExecution } from './paperExecution.js';
import { DumpDetector } from './dumpDetector.js';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('engine');

export class TradingEngine extends EventEmitter {
  private db: Database;
  private wsManager: WebSocketManager;
  private marketDiscovery: MarketDiscovery;
  private execution: PaperExecution;
  private dumpDetector: DumpDetector;

  private state: BotState = {
    enabled: false,
    mode: 'auto',
    tradingMode: 'PAPER',
    selectedMarket: null,
    config: { ...DEFAULT_CONFIG },
  };

  private portfolio: Portfolio = {
    cash: DEFAULT_CONFIG.initialBankroll,
    positions: { UP: 0, DOWN: 0 },
    unrealizedPnL: 0,
    realizedPnL: 0,
    equity: DEFAULT_CONFIG.initialBankroll,
  };

  private currentMarket: Market | null = null;
  private currentCycle: Cycle | null = null;
  private orderbooks: TokenOrderbooks = { UP: null, DOWN: null };
  private watcherActive = false;
  private watcherStartTime: number | null = null;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();

  constructor(db: Database, wsManager: WebSocketManager, marketDiscovery: MarketDiscovery) {
    super();
    this.db = db;
    this.wsManager = wsManager;
    this.marketDiscovery = marketDiscovery;
    this.execution = new PaperExecution(db);
    this.dumpDetector = new DumpDetector();
  }

  async initialize() {
    // Load state from database
    const savedState = await this.db.getBotState();
    if (savedState) {
      this.state = {
        enabled: savedState.enabled,
        mode: savedState.mode as 'auto' | 'manual',
        tradingMode: (savedState as any).tradingMode || 'PAPER',
        selectedMarket: savedState.selectedMarket,
        config: { ...DEFAULT_CONFIG, ...(savedState.config as Partial<BotConfig>) },
      };
    }

    // Load portfolio
    const latestEquity = await this.db.getLatestEquitySnapshot();
    if (latestEquity) {
      this.portfolio.cash = latestEquity.cash;
      this.portfolio.realizedPnL = latestEquity.realized;
    }

    // Load positions from open trades
    const positions = await this.db.getOpenPositions();
    this.portfolio.positions = positions;

    logger.info('Engine initialized', {
      enabled: this.state.enabled,
      cash: this.portfolio.cash,
      positions: this.portfolio.positions,
    });
  }

  start() {
    if (this.mainLoopInterval) return;

    this.mainLoopInterval = setInterval(() => this.mainLoop(), 100);
    logger.info('Engine main loop started');
  }

  async stop() {
    if (this.mainLoopInterval) {
      clearInterval(this.mainLoopInterval);
      this.mainLoopInterval = null;
    }
    
    this.wsManager.disconnect();
    logger.info('Engine stopped');
  }

  private async mainLoop() {
    if (!this.state.enabled) return;

    try {
      // Check for market updates
      await this.checkMarket();

      // If we have an active market, check for trade signals
      if (this.currentMarket && this.currentMarket.status === 'live') {
        await this.processSignals();
      }
    } catch (err) {
      logger.error('Main loop error', { error: (err as Error).message });
    }
  }

  private async checkMarket() {
    if (!this.currentMarket) {
      // Find next market
      if (this.state.mode === 'auto') {
        const market = await this.marketDiscovery.findNextBTCUpDownMarket();
        if (market) {
          await this.setCurrentMarket(market);
        }
      }
      return;
    }

    const now = Date.now();

    // Check if market has started
    if (this.currentMarket.status === 'upcoming' && this.currentMarket.startTime) {
      if (now >= this.currentMarket.startTime.getTime()) {
        this.currentMarket.status = 'live';
        await this.onMarketStart();
      }
    }

    // Check if market has ended
    if (this.currentMarket.status === 'live' && this.currentMarket.endTime) {
      if (now >= this.currentMarket.endTime.getTime()) {
        this.currentMarket.status = 'ended';
        await this.onMarketEnd();
      }
    }

    // Check watcher window
    if (this.watcherActive && this.watcherStartTime) {
      const elapsed = (now - this.watcherStartTime) / 1000 / 60;
      if (elapsed >= this.state.config.windowMin) {
        this.watcherActive = false;
        logger.info('Watcher window expired, no dump detected');
      }
    }
  }

  private async setCurrentMarket(market: Market) {
    this.currentMarket = market;
    this.currentCycle = null;
    this.watcherActive = false;
    this.watcherStartTime = null;
    this.dumpDetector.reset();

    // Log detailed market info with link
    const marketLink = `https://polymarket.com/event/${market.slug}`;
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('🎯 NEW MARKET SELECTED');
    logger.info(`   📊 ${market.question || market.slug}`);
    logger.info(`   🔗 ${marketLink}`);
    logger.info(`   ⏰ Status: ${market.status?.toUpperCase()}`);
    if (market.startTime) {
      logger.info(`   🕐 Start: ${market.startTime.toLocaleTimeString()}`);
    }
    if (market.endTime) {
      logger.info(`   🕐 End: ${market.endTime.toLocaleTimeString()}`);
    }
    logger.info(`   🪙 Token UP: ${market.tokenUp?.slice(0, 20)}...`);
    logger.info(`   🪙 Token DOWN: ${market.tokenDown?.slice(0, 20)}...`);
    logger.info('═══════════════════════════════════════════════════════════════');

    // Save market to database first (required for foreign key)
    await this.db.upsertMarket(market);

    // If market is already live and within watcher window, activate watcher immediately
    if (market.status === 'live' && market.startTime) {
      const elapsedMin = (Date.now() - market.startTime.getTime()) / 1000 / 60;
      if (elapsedMin < this.state.config.windowMin) {
        logger.info(`🔔 Market already LIVE - activating watcher (${elapsedMin.toFixed(1)} min elapsed)`);
        this.watcherActive = true;
        this.watcherStartTime = market.startTime.getTime();
        
        // Create pending cycle
        this.currentCycle = {
          id: nanoid(),
          marketSlug: market.slug,
          startedAt: new Date(),
          status: 'pending',
        };
        await this.db.createCycle(this.currentCycle);
      } else {
        logger.warn(`⏰ Market LIVE but watcher window expired (${elapsedMin.toFixed(1)} min > ${this.state.config.windowMin} min)`);
      }
    }

    // Unsubscribe from ALL old tokens before subscribing to new ones
    this.wsManager.disconnect();

    // Subscribe to orderbook updates
    if (market.tokenUp && market.tokenDown) {
      let lastLogTime = 0;
      
      this.wsManager.subscribeToOrderbook(market.tokenUp, (ob) => {
        this.orderbooks.UP = ob;
        const price = ob.asks[0]?.price || 0;
        this.dumpDetector.addPriceSnapshot('UP', price);
        this.emit('orderbook', { side: 'UP', orderbook: ob });
        
        // Log price updates every 5 seconds
        const now = Date.now();
        if (now - lastLogTime > 5000) {
          this.logPriceUpdate();
          lastLogTime = now;
        }
      });

      this.wsManager.subscribeToOrderbook(market.tokenDown, (ob) => {
        this.orderbooks.DOWN = ob;
        const price = ob.asks[0]?.price || 0;
        this.dumpDetector.addPriceSnapshot('DOWN', price);
        this.emit('orderbook', { side: 'DOWN', orderbook: ob });
      });
    }

    await this.db.upsertMarket(market);
  }

  private logPriceUpdate() {
    const upAsk = this.orderbooks.UP?.asks[0]?.price;
    const upBid = this.orderbooks.UP?.bids[0]?.price;
    const downAsk = this.orderbooks.DOWN?.asks[0]?.price;
    const downBid = this.orderbooks.DOWN?.bids[0]?.price;
    
    const sum = (upAsk || 0) + (downAsk || 0);
    const dumpStatus = this.dumpDetector.getStatus();
    
    let statusIcon = '👁️';
    if (this.currentCycle?.status === 'leg1_done') {
      statusIcon = '⏳';
    } else if (dumpStatus.dropPct > 0.05) {
      statusIcon = '📉';
    }
    
    logger.info(`${statusIcon} LIVE | UP: ${upBid?.toFixed(2) || '—'}/${upAsk?.toFixed(2) || '—'} | DOWN: ${downBid?.toFixed(2) || '—'}/${downAsk?.toFixed(2) || '—'} | Sum: ${sum.toFixed(3)} | Drop: ${(dumpStatus.dropPct * 100).toFixed(1)}%`);
  }

  private async onMarketStart() {
    const link = `https://polymarket.com/event/${this.currentMarket?.slug}`;
    
    logger.info('');
    logger.info('🚀 ═══════════════════════════════════════════════════════════');
    logger.info('🚀 MARKET STARTED - WATCHER ACTIVE');
    logger.info(`🚀 ${this.currentMarket?.question || this.currentMarket?.slug}`);
    logger.info(`🚀 Link: ${link}`);
    logger.info(`🚀 Watching for ${this.state.config.windowMin} min window`);
    logger.info(`🚀 Dump threshold: ${(this.state.config.move * 100).toFixed(0)}% drop in ${this.state.config.dumpWindowSec}s`);
    logger.info(`🚀 Shares per trade: ${this.state.config.shares}`);
    logger.info('🚀 ═══════════════════════════════════════════════════════════');
    logger.info('');

    this.watcherActive = true;
    this.watcherStartTime = Date.now();
    this.dumpDetector.reset();

    // Create new pending cycle
    this.currentCycle = {
      id: nanoid(),
      marketSlug: this.currentMarket!.slug,
      startedAt: new Date(),
      status: 'pending',
    };

    await this.db.createCycle(this.currentCycle);
  }

  private async onMarketEnd() {
    logger.info('Market ended', { market: this.currentMarket?.slug });

    // Handle incomplete cycle
    if (this.currentCycle && this.currentCycle.status !== 'complete') {
      await this.handleIncompleteCycle();
    }

    // Reset for next market
    this.currentMarket = null;
    this.currentCycle = null;
    this.watcherActive = false;
    this.orderbooks = { UP: null, DOWN: null };
  }

  private async handleIncompleteCycle() {
    if (!this.currentCycle) return;

    logger.warn('Handling incomplete cycle', { cycleId: this.currentCycle.id });

    // Mark as incomplete
    this.currentCycle.status = 'incomplete';
    this.currentCycle.endedAt = new Date();

    // Flatten positions at best bid (paper)
    const upBid = this.orderbooks.UP?.bids[0]?.price || 0;
    const downBid = this.orderbooks.DOWN?.bids[0]?.price || 0;

    const flattenValue =
      this.portfolio.positions.UP * upBid +
      this.portfolio.positions.DOWN * downBid;

    this.portfolio.cash += flattenValue;
    this.portfolio.realizedPnL += flattenValue - (this.currentCycle.totalCost || 0);
    this.portfolio.positions = { UP: 0, DOWN: 0 };

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();
  }

  private async processSignals() {
    if (!this.currentCycle || !this.watcherActive) return;

    const { config } = this.state;

    // Leg 1: Check for dump
    if (this.currentCycle.status === 'pending') {
      const dump = this.dumpDetector.detectDump(
        config.move,
        config.dumpWindowSec
      );

      if (dump.detected && dump.side) {
        await this.executeLeg1(dump);
      }
    }

    // Leg 2: Check for hedge
    if (this.currentCycle.status === 'leg1_done') {
      const hedge = this.checkHedgeCondition();

      if (hedge.met) {
        await this.executeLeg2(hedge);
      }
    }
  }

  private async executeLeg1(dump: DumpDetection) {
    if (!this.currentCycle || !dump.side) return;

    const { config } = this.state;
    const side = dump.side;
    const orderbook = this.orderbooks[side];
    if (!orderbook || !orderbook.asks[0]) return;

    const price = orderbook.asks[0].price;
    const cost = config.shares * price;

    // Check if we have enough cash
    if (cost > this.portfolio.cash) {
      logger.warn('Insufficient cash for Leg 1', { cost, cash: this.portfolio.cash });
      return;
    }

    logger.info('');
    logger.info('💥 ═══════════════════════════════════════════════════════════');
    logger.info('💥 DUMP DETECTED! EXECUTING LEG 1');
    logger.info(`💥 Side: ${side} dropped ${(dump.dropPct * 100).toFixed(1)}%`);
    logger.info(`💥 Buying ${config.shares} shares @ $${price.toFixed(4)}`);
    logger.info(`💥 Cost: $${cost.toFixed(2)}`);
    logger.info(`💥 Market: https://polymarket.com/event/${this.currentMarket?.slug}`);
    logger.info('💥 ═══════════════════════════════════════════════════════════');
    logger.info('');

    // Execute paper trade
    const trade = await this.execution.buy({
      marketSlug: this.currentMarket!.slug,
      leg: 1,
      side,
      tokenId: side === 'UP' ? this.currentMarket!.tokenUp! : this.currentMarket!.tokenDown!,
      shares: config.shares,
      price,
      cycleId: this.currentCycle.id,
      currentCash: this.portfolio.cash,
      feeBps: config.feeBps,
    });

    // Update portfolio
    this.portfolio.cash = trade.cashAfter;
    this.portfolio.positions[side] += config.shares;

    // Update cycle
    this.currentCycle.leg1Side = side;
    this.currentCycle.leg1Price = price;
    this.currentCycle.leg1Time = new Date();
    this.currentCycle.leg1Shares = config.shares;
    this.currentCycle.totalCost = cost;
    this.currentCycle.status = 'leg1_done';

    // Stop watching for dumps on this side
    this.watcherActive = false;

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();

    this.emit('trade', trade);
    this.emit('leg1', { cycle: this.currentCycle, trade });
  }

  private checkHedgeCondition(): HedgeCondition {
    if (!this.currentCycle || !this.currentCycle.leg1Price || !this.currentCycle.leg1Side) {
      return { met: false, leg1Price: 0, oppositeAsk: 0, sum: 0, target: this.state.config.sumTarget };
    }

    const oppositeSide = this.currentCycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
    const oppositeOrderbook = this.orderbooks[oppositeSide];

    if (!oppositeOrderbook || !oppositeOrderbook.asks[0]) {
      return { met: false, leg1Price: this.currentCycle.leg1Price, oppositeAsk: 0, sum: 0, target: this.state.config.sumTarget };
    }

    const leg1Price = this.currentCycle.leg1Price;
    const oppositeAsk = oppositeOrderbook.asks[0].price;
    const sum = leg1Price + oppositeAsk;

    return {
      met: sum <= this.state.config.sumTarget,
      leg1Price,
      oppositeAsk,
      sum,
      target: this.state.config.sumTarget,
    };
  }

  private async executeLeg2(hedge: HedgeCondition) {
    if (!this.currentCycle || !this.currentCycle.leg1Side) return;

    const { config } = this.state;
    const side = this.currentCycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
    const price = hedge.oppositeAsk;
    const cost = config.shares * price;

    // Check if we have enough cash
    if (cost > this.portfolio.cash) {
      logger.warn('Insufficient cash for Leg 2', { cost, cash: this.portfolio.cash });
      return;
    }

    const lockedProfit = config.shares * 1.0 - (cost + (this.currentCycle.totalCost || 0));
    
    logger.info('');
    logger.info('🎯 ═══════════════════════════════════════════════════════════');
    logger.info('🎯 HEDGE CONDITION MET! EXECUTING LEG 2');
    logger.info(`🎯 Hedging ${side} @ $${price.toFixed(4)}`);
    logger.info(`🎯 Sum: ${hedge.sum.toFixed(4)} (target: ${config.sumTarget})`);
    logger.info(`🎯 Buying ${config.shares} shares`);
    logger.info(`🎯 Cost: $${cost.toFixed(2)}`);
    logger.info(`🎯 LOCKED PROFIT: $${lockedProfit.toFixed(2)} (${((lockedProfit / config.shares) * 100).toFixed(1)}%)`);
    logger.info(`🎯 Market: https://polymarket.com/event/${this.currentMarket?.slug}`);
    logger.info('🎯 ═══════════════════════════════════════════════════════════');
    logger.info('');

    // Execute paper trade
    const trade = await this.execution.buy({
      marketSlug: this.currentMarket!.slug,
      leg: 2,
      side,
      tokenId: side === 'UP' ? this.currentMarket!.tokenUp! : this.currentMarket!.tokenDown!,
      shares: config.shares,
      price,
      cycleId: this.currentCycle.id,
      currentCash: this.portfolio.cash,
      feeBps: config.feeBps,
    });

    // Update portfolio
    this.portfolio.cash = trade.cashAfter;
    this.portfolio.positions[side] += config.shares;

    // Calculate locked-in profit
    const totalCost = (this.currentCycle.totalCost || 0) + cost;
    const lockedInProfit = config.shares * 1.0 - totalCost; // Payout is $1 per share
    const lockedInPct = ((1.0 - (totalCost / config.shares)) * 100);

    // Update cycle
    this.currentCycle.leg2Side = side;
    this.currentCycle.leg2Price = price;
    this.currentCycle.leg2Time = new Date();
    this.currentCycle.leg2Shares = config.shares;
    this.currentCycle.totalCost = totalCost;
    this.currentCycle.lockedInProfit = lockedInProfit;
    this.currentCycle.lockedInPct = lockedInPct;
    this.currentCycle.status = 'complete';
    this.currentCycle.endedAt = new Date();

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();

    logger.info('Cycle complete - Profit locked in', {
      cycleId: this.currentCycle.id,
      totalCost: totalCost.toFixed(4),
      lockedInProfit: lockedInProfit.toFixed(4),
      lockedInPct: lockedInPct.toFixed(2) + '%',
    });

    this.emit('trade', trade);
    this.emit('leg2', { cycle: this.currentCycle, trade });
    this.emit('cycleComplete', this.currentCycle);

    // Reset for next cycle
    this.currentCycle = null;
  }

  private async saveEquitySnapshot() {
    const unrealized = this.calculateUnrealizedPnL();
    const equity = this.portfolio.cash + unrealized;

    await this.db.createEquitySnapshot({
      cash: this.portfolio.cash,
      equity,
      unrealized,
      realized: this.portfolio.realizedPnL,
    });

    this.portfolio.unrealizedPnL = unrealized;
    this.portfolio.equity = equity;
  }

  private calculateUnrealizedPnL(): number {
    const upBid = this.orderbooks.UP?.bids[0]?.price || 0;
    const downBid = this.orderbooks.DOWN?.bids[0]?.price || 0;

    return (
      this.portfolio.positions.UP * upBid +
      this.portfolio.positions.DOWN * downBid
    );
  }

  // Public API methods

  async enable(config: Partial<BotConfig>) {
    this.state.enabled = true;
    this.state.config = { ...this.state.config, ...config };
    await this.db.saveBotState(this.state);
    logger.info('Bot enabled', { config: this.state.config });
  }

  async disable() {
    this.state.enabled = false;
    await this.db.saveBotState(this.state);
    logger.info('Bot disabled');
  }

  async setBankroll(amount: number) {
    this.portfolio.cash = amount;
    this.portfolio.equity = amount + this.calculateUnrealizedPnL();
    await this.saveEquitySnapshot();
    logger.info('Bankroll set', { amount });
  }

  async resetBankroll() {
    this.portfolio = {
      cash: DEFAULT_CONFIG.initialBankroll,
      positions: { UP: 0, DOWN: 0 },
      unrealizedPnL: 0,
      realizedPnL: 0,
      equity: DEFAULT_CONFIG.initialBankroll,
    };
    await this.saveEquitySnapshot();
    logger.info('Bankroll reset to default', { amount: DEFAULT_CONFIG.initialBankroll });
  }

  async setConfig(updates: Partial<BotConfig>) {
    this.state.config = { ...this.state.config, ...updates };
    await this.db.saveBotState(this.state);
    logger.info('Config updated', { updates });
  }

  async setMarketMode(mode: 'auto' | 'manual') {
    this.state.mode = mode;
    await this.db.saveBotState(this.state);
    logger.info('Market mode set', { mode });
  }

  async setTradingMode(mode: 'PAPER' | 'LIVE') {
    // Don't allow switching while bot is enabled with open positions
    if (this.state.enabled && (this.portfolio.positions.UP > 0 || this.portfolio.positions.DOWN > 0)) {
      throw new Error('Cannot switch trading mode while bot has open positions. Close positions first.');
    }

    this.state.tradingMode = mode;
    await this.db.saveBotState(this.state);
    logger.info(`Trading mode switched to ${mode}`, { 
      mode,
      warning: mode === 'LIVE' ? '🔴 REAL MONEY TRADES ENABLED!' : undefined 
    });
  }

  async selectMarket(slug: string) {
    const market = await this.marketDiscovery.getMarketBySlug(slug);
    if (market) {
      this.state.mode = 'manual';
      this.state.selectedMarket = slug;
      await this.setCurrentMarket(market);
      await this.db.saveBotState(this.state);
    } else {
      throw new Error(`Market not found: ${slug}`);
    }
  }

  getStatus(): LiveStatus {
    const now = Date.now();
    let watcherSecondsRemaining = 0;

    if (this.watcherActive && this.watcherStartTime) {
      const elapsed = (now - this.watcherStartTime) / 1000;
      const windowSec = this.state.config.windowMin * 60;
      watcherSecondsRemaining = Math.max(0, windowSec - elapsed);
    }

    return {
      bot: this.state,
      portfolio: this.portfolio,
      currentMarket: this.currentMarket,
      orderbooks: this.orderbooks,
      currentCycle: this.currentCycle,
      watcherActive: this.watcherActive,
      watcherSecondsRemaining,
      uptime: now - this.startTime,
      lastUpdate: now,
      executionMetrics: this.getExecutionMetrics(),
    };
  }

  /**
   * Get execution metrics for live trading status display.
   */
  private getExecutionMetrics() {
    // Return mock metrics for paper mode, real metrics for live mode
    if (this.state.tradingMode === 'PAPER') {
      return {
        ordersSent: 0,
        ordersFilled: 0,
        avgLatencyMs: 0.5, // Paper trading latency
        fillRate: 'N/A (Paper)',
        lastError: null,
      };
    }
    
    // For live mode, this would come from the LiveExecution instance
    return {
      ordersSent: 0,
      ordersFilled: 0,
      avgLatencyMs: 0,
      fillRate: 'N/A',
      lastError: null,
    };
  }

  getConfig(): BotConfig {
    return { ...this.state.config };
  }

  isEnabled(): boolean {
    return this.state.enabled;
  }
}

