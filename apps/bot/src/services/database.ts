import { PrismaClient } from '@prisma/client';
import type { BotState, Market, Trade, Cycle, EquitySnapshot, Positions } from '@poly-trader/shared';
import { DEFAULT_CONFIG } from '@poly-trader/shared';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

export class Database {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async connect() {
    await this.prisma.$connect();
    logger.info('Connected to database');
  }

  async disconnect() {
    await this.prisma.$disconnect();
    logger.info('Disconnected from database');
  }

  // Bot State
  async getBotState(): Promise<BotState | null> {
    const state = await this.prisma.botState.findFirst();
    if (!state) return null;

    return {
      enabled: state.enabled,
      mode: state.mode as 'auto' | 'manual',
      tradingMode: ((state as any).tradingMode || 'PAPER') as 'PAPER' | 'LIVE',
      selectedMarket: state.selectedMarket,
      config: { ...DEFAULT_CONFIG, ...(state.config as object) },
    };
  }

  async saveBotState(state: BotState) {
    await this.prisma.botState.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        enabled: state.enabled,
        mode: state.mode,
        tradingMode: state.tradingMode,
        selectedMarket: state.selectedMarket,
        config: state.config as object,
      },
      update: {
        enabled: state.enabled,
        mode: state.mode,
        tradingMode: state.tradingMode,
        selectedMarket: state.selectedMarket,
        config: state.config as object,
      },
    });
  }

  // Markets
  async upsertMarket(market: Market) {
    await this.prisma.market.upsert({
      where: { slug: market.slug },
      create: {
        slug: market.slug,
        question: market.question,
        startTime: market.startTime,
        endTime: market.endTime,
        tokenUp: market.tokenUp,
        tokenDown: market.tokenDown,
        conditionId: market.conditionId,
        status: market.status,
        resolution: market.resolution,
      },
      update: {
        question: market.question,
        startTime: market.startTime,
        endTime: market.endTime,
        tokenUp: market.tokenUp,
        tokenDown: market.tokenDown,
        conditionId: market.conditionId,
        status: market.status,
        resolution: market.resolution,
      },
    });
  }

  async getMarketBySlug(slug: string): Promise<Market | null> {
    const market = await this.prisma.market.findUnique({
      where: { slug },
    });

    if (!market) return null;

    return {
      slug: market.slug,
      question: market.question || undefined,
      startTime: market.startTime || undefined,
      endTime: market.endTime || undefined,
      tokenUp: market.tokenUp || undefined,
      tokenDown: market.tokenDown || undefined,
      conditionId: market.conditionId || undefined,
      status: market.status as Market['status'],
      resolution: market.resolution as Market['resolution'],
    };
  }

  async getUpcomingMarkets(): Promise<Market[]> {
    const markets = await this.prisma.market.findMany({
      where: {
        status: { in: ['upcoming', 'live'] },
        startTime: { gte: new Date() },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    });

    return markets.map(m => ({
      slug: m.slug,
      question: m.question || undefined,
      startTime: m.startTime || undefined,
      endTime: m.endTime || undefined,
      tokenUp: m.tokenUp || undefined,
      tokenDown: m.tokenDown || undefined,
      conditionId: m.conditionId || undefined,
      status: m.status as Market['status'],
      resolution: m.resolution as Market['resolution'],
    }));
  }

  // Trades
  async createTrade(trade: Trade) {
    await this.prisma.trade.create({
      data: {
        id: trade.id,
        timestamp: trade.timestamp,
        marketSlug: trade.marketSlug,
        leg: trade.leg,
        side: trade.side,
        tokenId: trade.tokenId,
        shares: trade.shares,
        price: trade.price,
        cost: trade.cost,
        fee: trade.fee,
        cashAfter: trade.cashAfter,
        cycleId: trade.cycleId,
      },
    });
  }

  async getTrades(limit = 50): Promise<Trade[]> {
    const trades = await this.prisma.trade.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return trades.map(t => ({
      id: t.id,
      timestamp: t.timestamp,
      marketSlug: t.marketSlug,
      leg: t.leg as 1 | 2,
      side: t.side as 'UP' | 'DOWN',
      tokenId: t.tokenId,
      shares: t.shares,
      price: t.price,
      cost: t.cost,
      fee: t.fee,
      cashAfter: t.cashAfter,
      cycleId: t.cycleId || undefined,
    }));
  }

  async getOpenPositions(): Promise<Positions> {
    // Sum up all buy trades that haven't been settled
    const result = await this.prisma.trade.groupBy({
      by: ['side'],
      _sum: { shares: true },
      where: {
        cycle: {
          status: { notIn: ['settled'] },
        },
      },
    });

    const positions: Positions = { UP: 0, DOWN: 0 };
    for (const row of result) {
      if (row.side === 'UP' || row.side === 'DOWN') {
        positions[row.side] = row._sum.shares || 0;
      }
    }

    return positions;
  }

  // Cycles
  async createCycle(cycle: Cycle) {
    await this.prisma.cycle.create({
      data: {
        id: cycle.id,
        marketSlug: cycle.marketSlug,
        startedAt: cycle.startedAt,
        status: cycle.status,
      },
    });
  }

  async updateCycle(cycle: Cycle) {
    await this.prisma.cycle.update({
      where: { id: cycle.id },
      data: {
        endedAt: cycle.endedAt,
        leg1Side: cycle.leg1Side,
        leg1Price: cycle.leg1Price,
        leg1Time: cycle.leg1Time,
        leg1Shares: cycle.leg1Shares,
        leg2Side: cycle.leg2Side,
        leg2Price: cycle.leg2Price,
        leg2Time: cycle.leg2Time,
        leg2Shares: cycle.leg2Shares,
        totalCost: cycle.totalCost,
        lockedInProfit: cycle.lockedInProfit,
        lockedInPct: cycle.lockedInPct,
        status: cycle.status,
      },
    });
  }

  async getCycles(limit = 20): Promise<Cycle[]> {
    const cycles = await this.prisma.cycle.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });

    return cycles.map(c => ({
      id: c.id,
      marketSlug: c.marketSlug,
      startedAt: c.startedAt,
      endedAt: c.endedAt || undefined,
      leg1Side: c.leg1Side as 'UP' | 'DOWN' | undefined,
      leg1Price: c.leg1Price || undefined,
      leg1Time: c.leg1Time || undefined,
      leg1Shares: c.leg1Shares || undefined,
      leg2Side: c.leg2Side as 'UP' | 'DOWN' | undefined,
      leg2Price: c.leg2Price || undefined,
      leg2Time: c.leg2Time || undefined,
      leg2Shares: c.leg2Shares || undefined,
      totalCost: c.totalCost || undefined,
      lockedInProfit: c.lockedInProfit || undefined,
      lockedInPct: c.lockedInPct || undefined,
      status: c.status as Cycle['status'],
    }));
  }

  // Equity Snapshots
  async createEquitySnapshot(snapshot: Omit<EquitySnapshot, 'timestamp'>) {
    await this.prisma.equitySnapshot.create({
      data: {
        cash: snapshot.cash,
        equity: snapshot.equity,
        unrealized: snapshot.unrealized,
        realized: snapshot.realized,
      },
    });
  }

  async getLatestEquitySnapshot(): Promise<EquitySnapshot | null> {
    const snapshot = await this.prisma.equitySnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
    });

    if (!snapshot) return null;

    return {
      timestamp: snapshot.timestamp,
      cash: snapshot.cash,
      equity: snapshot.equity,
      unrealized: snapshot.unrealized,
      realized: snapshot.realized,
    };
  }

  async getEquityHistory(limit = 1000): Promise<EquitySnapshot[]> {
    const snapshots = await this.prisma.equitySnapshot.findMany({
      orderBy: { timestamp: 'asc' },
      take: limit,
    });

    return snapshots.map(s => ({
      timestamp: s.timestamp,
      cash: s.cash,
      equity: s.equity,
      unrealized: s.unrealized,
      realized: s.realized,
    }));
  }

  // Log entries (for persistent important events)
  async createLogEntry(level: string, message: string, meta?: Record<string, unknown>) {
    await this.prisma.logEntry.create({
      data: {
        level,
        message,
        meta: meta as object,
      },
    });
  }

  async getLogEntries(limit = 100) {
    return this.prisma.logEntry.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  // Wallet
  async getActiveWallet() {
    return this.prisma.wallet.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async saveWallet(wallet: {
    address: string;
    encryptedPrivateKey: string;
    iv: string;
  }) {
    // Deactivate existing wallets
    await this.prisma.wallet.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // Create new active wallet
    return this.prisma.wallet.create({
      data: {
        address: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
        iv: wallet.iv,
        isActive: true,
      },
    });
  }

  async getAllWallets() {
    return this.prisma.wallet.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}

