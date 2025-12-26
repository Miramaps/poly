'use client';

import { useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { StatusCard } from '@/components/StatusCard';
import { EquityChart } from '@/components/EquityChart';
import { OrderbookDisplay } from '@/components/OrderbookDisplay';
import { ConfigPanel } from '@/components/ConfigPanel';
import { MarketInfo } from '@/components/MarketInfo';
import { CycleInfo } from '@/components/CycleInfo';
import { Terminal } from '@/components/Terminal';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getEquity, getStatus } from '@/lib/api';
import { formatCurrency, formatPercent, formatDuration } from '@/lib/utils';

export default function DashboardPage() {
  const { isConnected, status, logs } = useWebSocket();
  const [equityHistory, setEquityHistory] = useState<any[]>([]);
  const [initialStatus, setInitialStatus] = useState<any>(null);
  const [tradingMode, setTradingMode] = useState<'PAPER' | 'LIVE'>('PAPER');

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [equityRes, statusRes] = await Promise.all([
          getEquity(500),
          getStatus(),
        ]);
        setEquityHistory(equityRes.data || []);
        setInitialStatus(statusRes.data);
        if (statusRes.data?.bot?.tradingMode) {
          setTradingMode(statusRes.data.bot.tradingMode);
        }
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      }
    };
    fetchData();
  }, []);

  // Update trading mode from WebSocket
  useEffect(() => {
    if (status?.bot?.tradingMode) {
      setTradingMode(status.bot.tradingMode);
    }
  }, [status?.bot?.tradingMode]);

  // Use WebSocket status or fall back to initial
  const currentStatus = status || initialStatus;

  const portfolio = currentStatus?.portfolio || {
    cash: 1000,
    positions: { UP: 0, DOWN: 0 },
    unrealizedPnL: 0,
    realizedPnL: 0,
    equity: 1000,
  };

  const botConfig = currentStatus?.bot?.config;
  const currentMarket = currentStatus?.currentMarket;
  const currentCycle = currentStatus?.currentCycle;
  const orderbooks = currentStatus?.orderbooks || { UP: null, DOWN: null };

  const upAsk = orderbooks.UP?.asks?.[0]?.price;
  const downAsk = orderbooks.DOWN?.asks?.[0]?.price;
  const upBid = orderbooks.UP?.bids?.[0]?.price;
  const downBid = orderbooks.DOWN?.bids?.[0]?.price;

  const pnlPct = ((portfolio.equity - 1000) / 1000) * 100;

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={currentStatus?.bot?.enabled}
        tradingMode={tradingMode}
        onTradingModeChange={setTradingMode}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatusCard
            title="Equity"
            value={formatCurrency(portfolio.equity)}
            subtitle={formatPercent(pnlPct)}
            trend={pnlPct > 0 ? 'up' : pnlPct < 0 ? 'down' : 'neutral'}
          />
          <StatusCard
            title="Cash"
            value={formatCurrency(portfolio.cash)}
            subtitle="Available"
          />
          <StatusCard
            title="Positions"
            value={`↑${portfolio.positions.UP} | ↓${portfolio.positions.DOWN}`}
            subtitle="UP | DOWN"
          />
          <StatusCard
            title="Realized P&L"
            value={formatCurrency(portfolio.realizedPnL)}
            trend={portfolio.realizedPnL > 0 ? 'up' : portfolio.realizedPnL < 0 ? 'down' : 'neutral'}
            subtitle="Locked profits"
          />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Left Column - Terminal */}
          <div className="lg:col-span-2 space-y-6">
            <Terminal logs={logs} className="h-[500px]" />
          </div>

          {/* Right Column - Info Panels */}
          <div className="space-y-6">
            <OrderbookDisplay
              upAsk={upAsk}
              downAsk={downAsk}
              upBid={upBid}
              downBid={downBid}
            />
            <MarketInfo
              market={currentMarket}
              watcherActive={currentStatus?.watcherActive}
              watcherSecondsRemaining={currentStatus?.watcherSecondsRemaining}
            />
            <CycleInfo cycle={currentCycle} />
            <ConfigPanel config={botConfig} />
          </div>
        </div>

        {/* Uptime */}
        <div className="text-center text-muted text-sm">
          Uptime: {currentStatus?.uptime ? formatDuration(currentStatus.uptime) : '—'}
        </div>
      </main>
    </div>
  );
}

