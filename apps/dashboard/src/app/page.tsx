'use client';

import { useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { ConfigBar } from '@/components/ConfigBar';
import { StatusCard } from '@/components/StatusCard';
import { OrderbookDisplay } from '@/components/OrderbookDisplay';
import { MarketInfo } from '@/components/MarketInfo';
import { CycleInfo } from '@/components/CycleInfo';
import { LogViewer } from '@/components/LogViewer';
import { CommandInput } from '@/components/CommandInput';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getEquity, getStatus, getLogs } from '@/lib/api';
import { formatCurrency, formatPercent, formatDuration } from '@/lib/utils';

export default function DashboardPage() {
  const { isConnected, status, logs: wsLogs } = useWebSocket();
  const [equityHistory, setEquityHistory] = useState<any[]>([]);
  const [initialStatus, setInitialStatus] = useState<any>(null);
  const [tradingMode, setTradingMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [polledLogs, setPolledLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [equityRes, statusRes, logsRes] = await Promise.all([
          getEquity(500),
          getStatus(),
          getLogs(100),
        ]);
        setEquityHistory(equityRes.data || []);
        setInitialStatus(statusRes.data);
        setPolledLogs(logsRes.data || []);
        if (statusRes.data?.bot?.tradingMode) {
          setTradingMode(statusRes.data.bot.tradingMode);
        }
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      }
    };
    fetchData();
    
    const pollInterval = setInterval(async () => {
      try {
        const [statusRes, logsRes] = await Promise.all([
          getStatus(),
          getLogs(100),
        ]);
        setInitialStatus(statusRes.data);
        setPolledLogs(logsRes.data || []);
        if (statusRes.data?.bot?.tradingMode) {
          setTradingMode(statusRes.data.bot.tradingMode);
        }
      } catch (err) {
        console.error('Status poll failed:', err);
      }
    }, 500);
    
    return () => clearInterval(pollInterval);
  }, []);

  useEffect(() => {
    if (status?.bot?.tradingMode) {
      setTradingMode(status.bot.tradingMode);
    }
  }, [status?.bot?.tradingMode]);

  const currentStatus = status || initialStatus;

  const portfolio = currentStatus?.portfolio || {
    cash: 1000,
    positions: { UP: 0, DOWN: 0 },
    unrealizedPnL: 0,
    realizedPnL: 0,
    equity: 1000,
  };

  const botConfig = currentStatus?.bot?.config;
  const windowData = currentStatus?.window;
  const currentCycle = currentStatus?.currentCycle;
  const orderbooks = currentStatus?.orderbooks || { UP: null, DOWN: null };

  const windowSecondsLeft = currentStatus?.currentMarket?.timeLeft ?? 0;
  const rawMarket = currentStatus?.currentMarket;
  const currentMarket = rawMarket ? {
    slug: currentStatus.currentMarket.slug,
    status: windowSecondsLeft > 0 ? 'live' : 'ended',
    secondsLeft: currentStatus?.currentMarket?.timeLeft ?? 0,
    startTime: windowData?.windowStart ? new Date(windowData.windowStart * 1000).toISOString() : undefined,
    endTime: windowData?.windowEnd ? new Date(windowData.windowEnd * 1000).toISOString() : undefined,
  } : null;

  const upAsk = orderbooks.UP?.bestAsk;
  const downAsk = orderbooks.DOWN?.bestAsk;
  const upBid = orderbooks.UP?.bestBid;
  const downBid = orderbooks.DOWN?.bestBid;

  const pnlPct = ((portfolio.equity - 1000) / 1000) * 100;

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={currentStatus?.bot?.enabled}
        tradingMode={tradingMode}
        onTradingModeChange={setTradingMode}
      />
      <ConfigBar config={botConfig} />

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Portfolio Stats Container */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] p-4 mb-4">
          {/* Background decorations */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          
          {/* Header */}
          <div className="relative flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Portfolio Overview</h2>
              <p className="text-[10px] text-muted">Real-time metrics</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-accent animate-pulse' : 'bg-danger'}`} />
              <span className="text-[10px] text-muted">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatusCard
              title="Equity"
              value={formatCurrency(portfolio.equity)}
              subtitle={formatPercent(pnlPct)}
              trend={pnlPct > 0 ? 'up' : pnlPct < 0 ? 'down' : 'neutral'}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatusCard
              title="Cash"
              value={formatCurrency(portfolio.cash)}
              subtitle="Available"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              }
            />
            <StatusCard
              title="Positions"
              value={`↑${portfolio.positions.UP} | ↓${portfolio.positions.DOWN}`}
              subtitle="UP | DOWN"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              }
            />
            <StatusCard
              title="Realized P&L"
              value={formatCurrency(portfolio.realizedPnL)}
              trend={portfolio.realizedPnL > 0 ? 'up' : portfolio.realizedPnL < 0 ? 'down' : 'neutral'}
              subtitle="Locked profits"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          </div>
        </div>

        {/* Market Info Bar */}
        <MarketInfo market={currentMarket} className="mb-4" />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Left Column - Logs & Commands */}
          <div className="lg:col-span-2 space-y-4">
            <LogViewer logs={wsLogs.length > 0 ? wsLogs : polledLogs.map(l => ({ ...l, name: 'BOT' }))} className="h-[280px]" />
            <CommandInput className="h-[320px]" />
          </div>

          {/* Right Column - Info Panels */}
          <div className="space-y-4">
            <OrderbookDisplay
              upAsk={upAsk}
              downAsk={downAsk}
              upBid={upBid}
              downBid={downBid}
            />
            <CycleInfo cycle={currentStatus?.currentCycle} orderbooks={orderbooks} />
          </div>
        </div>

        {/* Uptime Footer */}
        <div className="text-center py-2">
          <span className="text-[10px] text-muted bg-white/[0.02] border border-white/5 rounded-full px-3 py-1">
            Uptime: {currentStatus?.uptime ? formatDuration(currentStatus.uptime) : '—'}
          </span>
        </div>
      </main>
    </div>
  );
}
