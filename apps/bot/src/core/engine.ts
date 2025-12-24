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
  HedgeCondition,
} from '@poly-trader/shared';
import { DEFAULT_CONFIG, CYCLE_STATUS, SIDE } from '@poly-trader/shared';
import { Database } from '../services/database.js';
import { WebSocketManager } from '../services/websocket.js';
import { MarketDiscovery } from '../services/marketDiscovery.js';
import { PaperExecution } from './paperExecution.js';
import { createBufferedLogger } from '../utils/logger.js';

const logger = createBufferedLogger('engine');

/**
 * BULLETPROOF TRADING STRATEGY
 * 
 * 1. ENTRY: Wait until one side drops below entryThreshold (default 0.35)
 * 2. DCA: Buy more at each dcaLevel (0.30, 0.25, 0.20, etc.)
 * 3. HEDGE: When avgCost + oppositeAsk <= sumTarget (0.99), buy opposite
 * 4. EXIT: If no hedge, wait until price >= avgCost (breakeven) before selling
 */
export class TradingEngine extends EventEmitter {
  private db: Database;
  private wsManager: WebSocketManager;
  private marketDiscovery: MarketDiscovery;
  private execution: PaperExecution;

  private state: BotState = {
    enabled: false,
    mode: 'auto',
    tradingMode: 'PAPER',
    selectedMarket: null,
    config: { ...DEFAULT_CONFIG } as BotConfig,
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
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();

  // DCA tracking
  private dcaLevelsBought: Set<number> = new Set();
  private leg1TotalCost: number = 0;
  private leg1TotalShares: number = 0;

  constructor(db: Database, wsManager: WebSocketManager, marketDiscovery: MarketDiscovery) {
    super();
    this.db = db;
    this.wsManager = wsManager;
    this.marketDiscovery = marketDiscovery;
    this.execution = new PaperExecution(db);
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
        config: { ...DEFAULT_CONFIG, ...(savedState.config as Partial<BotConfig>) } as BotConfig,
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

    logger.info('Engine initialized with BULLETPROOF strategy', {
      enabled: this.state.enabled,
      cash: this.portfolio.cash,
      entryThreshold: this.state.config.entryThreshold,
      dcaLevels: this.state.config.dcaLevels,
      sumTarget: this.state.config.sumTarget,
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
      await this.checkMarket();

      if (this.currentMarket && this.currentMarket.status === 'live') {
        await this.processStrategy();
      }
    } catch (err) {
      logger.error('Main loop error', { error: (err as Error).message });
    }
  }

  private async checkMarket() {
    if (!this.currentMarket) {
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
  }

  private async setCurrentMarket(market: Market) {
    this.currentMarket = market;
    this.currentCycle = null;
    this.resetDCATracking();

    const marketLink = `https://polymarket.com/event/${market.slug}`;
    logger.info('═══════════════════════════════════════════════════════════════');
    logger.info('🎯 NEW MARKET - BULLETPROOF STRATEGY');
    logger.info(`   📊 ${market.question || market.slug}`);
    logger.info(`   🔗 ${marketLink}`);
    logger.info(`   💰 Entry: Buy when price < $${this.state.config.entryThreshold}`);
    logger.info(`   📈 DCA: ${this.state.config.dcaLevels?.join(', ') || 'disabled'}`);
    logger.info(`   🎯 Hedge: When sum ≤ ${this.state.config.sumTarget}`);
    logger.info(`   🛡️ Breakeven: ${this.state.config.breakevenEnabled ? 'ON' : 'OFF'}`);
    logger.info('═══════════════════════════════════════════════════════════════');

    await this.db.upsertMarket(market);

    // If market is already live, start immediately
    if (market.status === 'live') {
      await this.onMarketStart();
    }

    // Unsubscribe from old tokens and subscribe to new ones
    this.wsManager.disconnect();

    if (market.tokenUp && market.tokenDown) {
      let lastLogTime = 0;
      
      this.wsManager.subscribeToOrderbook(market.tokenUp, (ob) => {
        this.orderbooks.UP = ob;
        this.emit('orderbook', { side: 'UP', orderbook: ob });
        
        const now = Date.now();
        if (now - lastLogTime > 5000) {
          this.logPriceUpdate();
          lastLogTime = now;
        }
      });

      this.wsManager.subscribeToOrderbook(market.tokenDown, (ob) => {
        this.orderbooks.DOWN = ob;
        this.emit('orderbook', { side: 'DOWN', orderbook: ob });
      });
    }
  }

  private resetDCATracking() {
    this.dcaLevelsBought.clear();
    this.leg1TotalCost = 0;
    this.leg1TotalShares = 0;
  }

  private getAverageCost(): number {
    if (this.leg1TotalShares === 0) return 0;
    return this.leg1TotalCost / this.leg1TotalShares;
  }

  private logPriceUpdate() {
    const upAsk = this.orderbooks.UP?.asks[0]?.price;
    const upBid = this.orderbooks.UP?.bids[0]?.price;
    const downAsk = this.orderbooks.DOWN?.asks[0]?.price;
    const downBid = this.orderbooks.DOWN?.bids[0]?.price;
    
    const avgCost = this.getAverageCost();
    const status = this.currentCycle?.status || 'pending';
    
    let statusIcon = '👁️';
    let hedgeInfo = '';
    
    if (status === 'leg1_done' || status === 'buying') {
      statusIcon = '⏳';
      const oppAsk = this.currentCycle?.leg1Side === 'UP' ? downAsk : upAsk;
      if (avgCost && oppAsk) {
        const sum = avgCost + oppAsk;
        hedgeInfo = ` | Sum: ${sum.toFixed(3)} (need ≤${this.state.config.sumTarget})`;
      }
    }
    
    const posInfo = this.leg1TotalShares > 0 
      ? ` | Pos: ${this.leg1TotalShares} @ avg $${avgCost.toFixed(3)}`
      : '';
    
    logger.info(`${statusIcon} LIVE | UP: ${upBid?.toFixed(2) || '—'}/${upAsk?.toFixed(2) || '—'} | DOWN: ${downBid?.toFixed(2) || '—'}/${downAsk?.toFixed(2) || '—'}${posInfo}${hedgeInfo}`);
  }

  private async onMarketStart() {
    logger.info('');
    logger.info('🚀 ═══════════════════════════════════════════════════════════');
    logger.info('🚀 MARKET STARTED - WATCHING FOR ENTRY');
    logger.info(`🚀 Will buy when any side drops below $${this.state.config.entryThreshold}`);
    logger.info('🚀 ═══════════════════════════════════════════════════════════');
    logger.info('');

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

    if (this.currentCycle && this.currentCycle.status !== 'complete') {
      await this.handleMarketEndExit();
    }

    this.currentMarket = null;
    this.currentCycle = null;
    this.orderbooks = { UP: null, DOWN: null };
    this.resetDCATracking();
  }

  private async handleMarketEndExit() {
    if (!this.currentCycle) return;

    const avgCost = this.getAverageCost();
    const side = this.currentCycle.leg1Side;
    
    if (!side || this.leg1TotalShares === 0) {
      // No position, just mark as incomplete
      this.currentCycle.status = 'incomplete';
      this.currentCycle.endedAt = new Date();
      await this.db.updateCycle(this.currentCycle);
      return;
    }

    const currentBid = this.orderbooks[side]?.bids[0]?.price || 0;
    const exitValue = this.leg1TotalShares * currentBid;
    const pnl = exitValue - this.leg1TotalCost;

    logger.warn('');
    logger.warn('⚠️ ═══════════════════════════════════════════════════════════');
    logger.warn('⚠️ MARKET ENDED - FORCED EXIT');
    logger.warn(`⚠️ Position: ${this.leg1TotalShares} ${side} @ avg $${avgCost.toFixed(4)}`);
    logger.warn(`⚠️ Exit price: $${currentBid.toFixed(4)}`);
    logger.warn(`⚠️ P&L: $${pnl.toFixed(2)} (${((pnl / this.leg1TotalCost) * 100).toFixed(1)}%)`);
    logger.warn('⚠️ ═══════════════════════════════════════════════════════════');
    logger.warn('');

    // Update portfolio
    this.portfolio.cash += exitValue;
    this.portfolio.realizedPnL += pnl;
    this.portfolio.positions[side] = 0;

    // Update cycle
    this.currentCycle.status = 'incomplete';
    this.currentCycle.endedAt = new Date();
    this.currentCycle.exitPrice = currentBid;
    this.currentCycle.exitPnL = pnl;

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();
  }

  /**
   * MAIN STRATEGY LOGIC
   */
  private async processStrategy() {
    if (!this.currentCycle) return;

    const { config } = this.state;

    // Get current prices
    const upAsk = this.orderbooks.UP?.asks[0]?.price || 1;
    const downAsk = this.orderbooks.DOWN?.asks[0]?.price || 1;

    // PHASE 1: ENTRY - Check if either side is below entry threshold
    if (this.currentCycle.status === 'pending') {
      if (upAsk < config.entryThreshold) {
        await this.executeBuy('UP', upAsk, 'ENTRY');
      } else if (downAsk < config.entryThreshold) {
        await this.executeBuy('DOWN', downAsk, 'ENTRY');
      }
      return;
    }

    // PHASE 2: DCA - Check if we should buy more
    if (this.currentCycle.status === 'buying' || this.currentCycle.status === 'leg1_done') {
      const side = this.currentCycle.leg1Side!;
      const currentAsk = this.orderbooks[side]?.asks[0]?.price || 1;

      // Check DCA levels
      if (config.dcaEnabled && config.dcaLevels) {
        for (const level of config.dcaLevels) {
          if (currentAsk <= level && !this.dcaLevelsBought.has(level)) {
            await this.executeBuy(side, currentAsk, `DCA@${level}`);
            this.dcaLevelsBought.add(level);
            break; // Only one DCA buy per loop
          }
        }
      }

      // PHASE 3: CHECK HEDGE CONDITION
      const hedge = this.checkHedgeCondition();
      if (hedge.met) {
        await this.executeHedge(hedge);
        return;
      }

      // PHASE 4: CHECK BREAKEVEN EXIT (if enabled and price recovered)
      if (config.breakevenEnabled && this.currentCycle.status === 'leg1_done') {
        const avgCost = this.getAverageCost();
        const currentBid = this.orderbooks[side]?.bids[0]?.price || 0;
        
        // If we can exit at breakeven or profit, do it
        if (currentBid >= avgCost) {
          await this.executeBreakevenExit(side, currentBid, avgCost);
        }
      }
    }
  }

  private async executeBuy(side: 'UP' | 'DOWN', price: number, reason: string) {
    if (!this.currentCycle) return;

    const { config } = this.state;
    
    // Calculate shares (with DCA multiplier if applicable)
    let shares = config.shares;
    if (reason.startsWith('DCA') && config.dcaMultiplier) {
      const dcaBuyCount = this.dcaLevelsBought.size;
      shares = Math.round(config.shares * Math.pow(config.dcaMultiplier, dcaBuyCount));
    }

    const cost = shares * price;

    // Check if we have enough cash
    if (cost > this.portfolio.cash) {
      logger.warn(`Insufficient cash for ${reason}`, { cost, cash: this.portfolio.cash });
      return;
    }

    logger.info('');
    logger.info('💰 ═══════════════════════════════════════════════════════════');
    logger.info(`💰 ${reason}: BUYING ${side}`);
    logger.info(`💰 Price: $${price.toFixed(4)} (threshold: $${config.entryThreshold})`);
    logger.info(`💰 Shares: ${shares} @ $${price.toFixed(4)} = $${cost.toFixed(2)}`);
    if (this.leg1TotalShares > 0) {
      const newAvg = (this.leg1TotalCost + cost) / (this.leg1TotalShares + shares);
      logger.info(`💰 New avg cost: $${newAvg.toFixed(4)}`);
    }
    logger.info('💰 ═══════════════════════════════════════════════════════════');
    logger.info('');

    // Execute trade
    const trade = await this.execution.buy({
      marketSlug: this.currentMarket!.slug,
      leg: 1,
      side,
      tokenId: side === 'UP' ? this.currentMarket!.tokenUp! : this.currentMarket!.tokenDown!,
      shares,
      price,
      cycleId: this.currentCycle.id,
      currentCash: this.portfolio.cash,
      feeBps: config.feeBps,
    });

    // Update portfolio
    this.portfolio.cash = trade.cashAfter;
    this.portfolio.positions[side] += shares;

    // Update DCA tracking
    this.leg1TotalCost += cost;
    this.leg1TotalShares += shares;

    // Update cycle
    if (!this.currentCycle.leg1Side) {
      this.currentCycle.leg1Side = side;
      this.currentCycle.leg1Time = new Date();
    }
    this.currentCycle.leg1Price = this.getAverageCost();
    this.currentCycle.leg1Shares = this.leg1TotalShares;
    this.currentCycle.leg1TotalCost = this.leg1TotalCost;
    this.currentCycle.leg1Buys = (this.currentCycle.leg1Buys || 0) + 1;
    this.currentCycle.totalCost = this.leg1TotalCost;
    this.currentCycle.status = 'leg1_done';

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();

    this.emit('trade', trade);
    this.emit('leg1', { cycle: this.currentCycle, trade });
  }

  private checkHedgeCondition(): HedgeCondition {
    if (!this.currentCycle || !this.currentCycle.leg1Side || this.leg1TotalShares === 0) {
      return { met: false, avgCost: 0, oppositeAsk: 0, sum: 0, target: this.state.config.sumTarget, potentialProfit: 0 };
    }

    const oppositeSide = this.currentCycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
    const oppositeOrderbook = this.orderbooks[oppositeSide];

    if (!oppositeOrderbook || !oppositeOrderbook.asks[0]) {
      return { met: false, avgCost: this.getAverageCost(), oppositeAsk: 0, sum: 0, target: this.state.config.sumTarget, potentialProfit: 0 };
    }

    const avgCost = this.getAverageCost();
    const oppositeAsk = oppositeOrderbook.asks[0].price;
    const sum = avgCost + oppositeAsk;
    
    // Calculate potential profit: shares * $1 payout - total cost
    const potentialTotalCost = this.leg1TotalCost + (this.leg1TotalShares * oppositeAsk);
    const potentialProfit = this.leg1TotalShares * 1.0 - potentialTotalCost;

    return {
      met: sum <= this.state.config.sumTarget,
      avgCost,
      oppositeAsk,
      sum,
      target: this.state.config.sumTarget,
      potentialProfit,
    };
  }

  private async executeHedge(hedge: HedgeCondition) {
    if (!this.currentCycle || !this.currentCycle.leg1Side) return;

    const { config } = this.state;
    const side = this.currentCycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
    const price = hedge.oppositeAsk;
    const shares = this.leg1TotalShares; // Match leg1 shares for full hedge
    const cost = shares * price;

    if (cost > this.portfolio.cash) {
      logger.warn('Insufficient cash for hedge', { cost, cash: this.portfolio.cash });
      return;
    }

    const totalCost = this.leg1TotalCost + cost;
    const lockedProfit = shares * 1.0 - totalCost;
    const lockedPct = ((1.0 - (totalCost / shares)) * 100);

    logger.info('');
    logger.info('🎯 ═══════════════════════════════════════════════════════════');
    logger.info('🎯 HEDGE CONDITION MET! LOCKING PROFIT');
    logger.info(`🎯 Avg cost: $${hedge.avgCost.toFixed(4)} + Opposite ask: $${price.toFixed(4)} = $${hedge.sum.toFixed(4)}`);
    logger.info(`🎯 Target: ≤ $${config.sumTarget}`);
    logger.info(`🎯 Buying ${shares} ${side} @ $${price.toFixed(4)}`);
    logger.info(`🎯 ✅ LOCKED PROFIT: $${lockedProfit.toFixed(2)} (${lockedPct.toFixed(1)}%)`);
    logger.info('🎯 ═══════════════════════════════════════════════════════════');
    logger.info('');

    // Execute trade
    const trade = await this.execution.buy({
      marketSlug: this.currentMarket!.slug,
      leg: 2,
      side,
      tokenId: side === 'UP' ? this.currentMarket!.tokenUp! : this.currentMarket!.tokenDown!,
      shares,
      price,
      cycleId: this.currentCycle.id,
      currentCash: this.portfolio.cash,
      feeBps: config.feeBps,
    });

    // Update portfolio
    this.portfolio.cash = trade.cashAfter;
    this.portfolio.positions[side] += shares;

    // Update cycle
    this.currentCycle.leg2Side = side;
    this.currentCycle.leg2Price = price;
    this.currentCycle.leg2Time = new Date();
    this.currentCycle.leg2Shares = shares;
    this.currentCycle.totalCost = totalCost;
    this.currentCycle.lockedInProfit = lockedProfit;
    this.currentCycle.lockedInPct = lockedPct;
    this.currentCycle.status = 'complete';
    this.currentCycle.endedAt = new Date();

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();

    this.emit('trade', trade);
    this.emit('leg2', { cycle: this.currentCycle, trade });
    this.emit('cycleComplete', this.currentCycle);

    // Reset for next cycle
    this.currentCycle = null;
    this.resetDCATracking();
  }

  private async executeBreakevenExit(side: 'UP' | 'DOWN', currentBid: number, avgCost: number) {
    if (!this.currentCycle) return;

    const exitValue = this.leg1TotalShares * currentBid;
    const pnl = exitValue - this.leg1TotalCost;

    // Only exit if truly at breakeven or profit
    if (pnl < 0) return;

    logger.info('');
    logger.info('🛡️ ═══════════════════════════════════════════════════════════');
    logger.info('🛡️ BREAKEVEN EXIT - PRICE RECOVERED');
    logger.info(`🛡️ Avg cost: $${avgCost.toFixed(4)} | Current bid: $${currentBid.toFixed(4)}`);
    logger.info(`🛡️ Selling ${this.leg1TotalShares} ${side} for $${exitValue.toFixed(2)}`);
    logger.info(`🛡️ P&L: $${pnl.toFixed(2)} (${((pnl / this.leg1TotalCost) * 100).toFixed(1)}%)`);
    logger.info('🛡️ ═══════════════════════════════════════════════════════════');
    logger.info('');

    // Update portfolio
    this.portfolio.cash += exitValue;
    this.portfolio.realizedPnL += pnl;
    this.portfolio.positions[side] = 0;

    // Update cycle
    this.currentCycle.status = 'complete';
    this.currentCycle.endedAt = new Date();
    this.currentCycle.exitPrice = currentBid;
    this.currentCycle.exitPnL = pnl;
    this.currentCycle.lockedInProfit = pnl;
    this.currentCycle.lockedInPct = (pnl / this.leg1TotalCost) * 100;

    await this.db.updateCycle(this.currentCycle);
    await this.saveEquitySnapshot();

    // Reset for next cycle
    this.currentCycle = null;
    this.resetDCATracking();
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

  // ─── Public API Methods ────────────────────────────────────────────────────

  async enable(config: Partial<BotConfig>) {
    this.state.enabled = true;
    this.state.config = { ...this.state.config, ...config };
    await this.db.saveBotState(this.state);
    logger.info('Bot enabled with BULLETPROOF strategy', { 
      entryThreshold: this.state.config.entryThreshold,
      dcaLevels: this.state.config.dcaLevels,
      sumTarget: this.state.config.sumTarget,
      breakevenEnabled: this.state.config.breakevenEnabled,
    });
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

    return {
      bot: this.state,
      portfolio: this.portfolio,
      currentMarket: this.currentMarket,
      orderbooks: this.orderbooks,
      currentCycle: this.currentCycle,
      watcherActive: this.currentCycle?.status === 'pending',
      watcherSecondsRemaining: 0,
      uptime: now - this.startTime,
      lastUpdate: now,
      executionMetrics: this.getExecutionMetrics(),
    };
  }

  private getExecutionMetrics() {
    if (this.state.tradingMode === 'PAPER') {
      return {
        ordersSent: 0,
        ordersFilled: 0,
        avgLatencyMs: 0.5,
        fillRate: 'N/A (Paper)',
        lastError: null,
      };
    }
    
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
