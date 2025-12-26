'use client';

import { useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { ConfigBar } from '@/components/ConfigBar';
import { StatusCard } from '@/components/StatusCard';
import { EquityChart } from '@/components/EquityChart';
import { OrderbookDisplay } from '@/components/OrderbookDisplay';
import { MarketInfo } from '@/components/MarketInfo';
import { CycleInfo } from '@/components/CycleInfo';
import { LogViewer } from '@/components/LogViewer';
import { CommandInput } from '@/components/CommandInput';
import { useWebSocket } from '@/hooks/useWebSocket';
import { formatCurrency, formatPercent } from '@/lib/utils';

export default function DashboardPage() {
  // Single polling source - useWebSocket handles everything
  const { isConnected, status, logs } = useWebSocket();
  const [tradingMode, setTradingMode] = useState<'PAPER' | 'LIVE'>('PAPER');

  // Update trading mode from status
  useEffect(() => {
    if (status?.bot?.tradingMode) {
      setTradingMode(status.bot.tradingMode);
    }
  }, [status?.bot?.tradingMode]);

  const portfolio = status?.portfolio || {
    cash: 1000,
    positions: { UP: 0, DOWN: 0 },
    unrealizedPnL: 0,
    realizedPnL: 0,
    equity: 1000,
  };

  const botConfig = status?.bot?.config;
  const currentCycle = status?.currentCycle;
  const orderbooks = status?.orderbooks || { UP: null, DOWN: null };

  const marketData = status?.currentMarket;
  const timeLeft = marketData?.timeLeft ?? 0;
  const currentMarket = marketData ? {
    slug: marketData.slug,
    status: timeLeft > 0 ? 'live' : 'ended',
    secondsLeft: timeLeft,
    inTradingWindow: marketData.inTradingWindow,
    title: marketData.title,
  } : null;

  const upAsk = orderbooks.UP?.bestAsk;
  const downAsk = orderbooks.DOWN?.bestAsk;
  const upBid = orderbooks.UP?.bestBid;
  const downBid = orderbooks.DOWN?.bestBid;

  const startingEquity = 1000;
  const equityChange = ((portfolio.equity - startingEquity) / startingEquity) * 100;

  return (
    <div className="min-h-screen bg-background">
      <Navigation
        isConnected={isConnected}
        botEnabled={status?.bot?.enabled || false}
        tradingMode={tradingMode}
        onTradingModeChange={setTradingMode}
      />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <StatusCard
            title="Equity"
            value={formatCurrency(portfolio.equity)}
            subtitle={formatPercent(equityChange)}
            trend={equityChange >= 0 ? 'up' : 'down'}
          />
          <StatusCard
            title="Cash"
            value={formatCurrency(portfolio.cash)}
            subtitle="Available"
          />
          <StatusCard
            title="Positions"
            value={`↑${portfolio.positions?.UP || 0} | ↓${portfolio.positions?.DOWN || 0}`}
            subtitle="UP | DOWN"
          />
          <StatusCard
            title="Realized P&L"
            value={formatCurrency(portfolio.realizedPnL)}
            subtitle="Locked profits"
            trend={portfolio.realizedPnL >= 0 ? 'up' : 'down'}
          />
        </div>

        <MarketInfo 
          market={currentMarket} 
          tradingWindowSec={botConfig?.tradingWindowSec || 120}
        />

        <ConfigBar config={botConfig} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-6">
            <LogViewer logs={logs || []} />
            <CommandInput />
          </div>

          <div className="col-span-4 space-y-6">
            <OrderbookDisplay
              upAsk={upAsk}
              downAsk={downAsk}
              upBid={upBid}
              downBid={downBid}
            />
            <CycleInfo cycle={currentCycle} />
          </div>
        </div>
      </main>
    </div>
  );
}
