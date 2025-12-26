'use client';

import { useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { TradesTable } from '@/components/TradesTable';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getTrades } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

export default function TradesPage() {
  const { isConnected, status } = useWebSocket();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const res = await getTrades(100);
        setTrades(res.data || []);
      } catch (err) {
        console.error('Failed to fetch trades:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTrades();
  }, []);

  // Calculate stats
  const totalVolume = trades.reduce((sum, t) => sum + (t.cost || 0), 0);
  const avgPrice = trades.length > 0
    ? trades.reduce((sum, t) => sum + (t.price || 0), 0) / trades.length
    : 0;
  const leg1Trades = trades.filter((t) => t.leg === 1);
  const leg2Trades = trades.filter((t) => t.leg === 2);
  const upTrades = trades.filter((t) => t.side === 'UP');
  const downTrades = trades.filter((t) => t.side === 'DOWN');
  const upVolume = upTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
  const downVolume = downTrades.reduce((sum, t) => sum + (t.cost || 0), 0);

  // Calculate additional metrics
  const winningTrades = trades.filter((t) => (t.pnl || 0) > 0);
  const losingTrades = trades.filter((t) => (t.pnl || 0) < 0);
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  
  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const grossProfit = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  
  const avgTradeSize = trades.length > 0 ? totalVolume / trades.length : 0;
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length)
    : 0;
  
  const bestTrade = trades.length > 0 
    ? Math.max(...trades.map(t => t.pnl || 0))
    : 0;
  const worstTrade = trades.length > 0 
    ? Math.min(...trades.map(t => t.pnl || 0))
    : 0;

  const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={status?.bot?.enabled}
      />

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Trade Analytics Container */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] p-4 mb-4 shadow-xl">
          {/* Background decorations */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-warning/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          
          {/* Header */}
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                  Trade Analytics
                </h1>
                <p className="text-muted text-xs">Performance metrics & statistics</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10">
              <div className={`w-1.5 h-1.5 rounded-full ${trades.length > 0 ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
              <span className="text-[10px] text-muted font-medium">{trades.length} trades</span>
            </div>
          </div>

          {/* Win Rate Hero */}
          <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            {/* Win Rate Circle */}
            <div className="lg:col-span-1 flex items-center justify-center">
              <div className="relative w-28 h-28">
                {/* Background circle */}
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50" cy="50" r="42"
                    fill="none"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50" cy="50" r="42"
                    fill="none"
                    stroke="url(#winRateGradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${winRate * 2.64} 264`}
                    className="transition-all duration-1000 ease-out"
                  />
                  <defs>
                    <linearGradient id="winRateGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#22c55e" />
                      <stop offset="100%" stopColor="#16a34a" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Center text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold font-mono text-white">{winRate.toFixed(1)}%</span>
                  <span className="text-[10px] text-muted uppercase tracking-wider">Win Rate</span>
                </div>
              </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2">
              <MetricCard 
                label="Total Trades" 
                value={trades.length.toString()} 
                icon={
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                }
              />
              <MetricCard 
                label="Total Volume" 
                value={formatCurrency(totalVolume)} 
                icon={
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              <MetricCard 
                label="Winning" 
                value={winningTrades.length.toString()} 
                color="accent"
                icon={
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                }
              />
              <MetricCard 
                label="Losing" 
                value={losingTrades.length.toString()} 
                color="danger"
                icon={
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                }
              />
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
            <StatBox label="Total P&L" value={formatCurrency(totalPnL)} trend={totalPnL >= 0 ? 'up' : 'down'} />
            <StatBox label="Profit Factor" value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} />
            <StatBox label="Avg Trade" value={formatCurrency(avgTradeSize)} />
            <StatBox label="Avg Win" value={formatCurrency(avgWin)} trend="up" />
            <StatBox label="Avg Loss" value={formatCurrency(avgLoss)} trend="down" />
            <StatBox label="Risk/Reward" value={riskRewardRatio === Infinity ? '∞' : riskRewardRatio.toFixed(2)} />
          </div>

          {/* Leg & Side Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Leg Distribution */}
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                Trade Legs
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-warning/10 to-transparent border border-warning/20 rounded-md p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full bg-warning/20 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-warning">1</span>
                    </div>
                    <span className="text-xs text-muted">Leg 1</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-warning">{leg1Trades.length}</div>
                  <div className="text-[10px] text-muted">
                    {formatCurrency(leg1Trades.reduce((sum, t) => sum + (t.cost || 0), 0))} vol
                  </div>
                </div>
                <div className="bg-gradient-to-br from-accent/10 to-transparent border border-accent/20 rounded-md p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-accent">2</span>
                    </div>
                    <span className="text-xs text-muted">Leg 2</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-accent">{leg2Trades.length}</div>
                  <div className="text-[10px] text-muted">
                    {formatCurrency(leg2Trades.reduce((sum, t) => sum + (t.cost || 0), 0))} vol
                  </div>
                </div>
              </div>
            </div>

            {/* Side Distribution */}
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Trade Sides
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gradient-to-br from-accent/10 to-transparent border border-accent/20 rounded-md p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">▲</span>
                    <span className="text-xs text-muted">UP</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-accent">{upTrades.length}</div>
                  <div className="text-[10px] text-muted">{formatCurrency(upVolume)} vol</div>
                  <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-accent to-green-400 rounded-full transition-all duration-500"
                      style={{ width: `${trades.length > 0 ? (upTrades.length / trades.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="bg-gradient-to-br from-danger/10 to-transparent border border-danger/20 rounded-md p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">▼</span>
                    <span className="text-xs text-muted">DOWN</span>
                  </div>
                  <div className="text-lg font-bold font-mono text-danger">{downTrades.length}</div>
                  <div className="text-[10px] text-muted">{formatCurrency(downVolume)} vol</div>
                  <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-danger to-red-400 rounded-full transition-all duration-500"
                      style={{ width: `${trades.length > 0 ? (downTrades.length / trades.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Extremes */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="bg-gradient-to-r from-accent/5 to-transparent border border-accent/10 rounded-md p-2.5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] text-muted uppercase tracking-wider">Best Trade</div>
                <div className="text-sm font-bold font-mono text-accent">{formatCurrency(bestTrade)}</div>
              </div>
            </div>
            <div className="bg-gradient-to-r from-danger/5 to-transparent border border-danger/10 rounded-md p-2.5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-danger/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] text-muted uppercase tracking-wider">Worst Trade</div>
                <div className="text-sm font-bold font-mono text-danger">{formatCurrency(worstTrade)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Trades Table */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full" />
            <span className="ml-2 text-muted text-sm">Loading trades...</span>
          </div>
        ) : (
          <TradesTable trades={trades} />
        )}
      </main>
    </div>
  );
}

// Metric Card Component
function MetricCard({ label, value, color, icon }: { 
  label: string; 
  value: string; 
  color?: 'accent' | 'danger' | 'warning';
  icon?: React.ReactNode;
}) {
  const colorClasses = {
    accent: 'from-accent/20 to-accent/5 border-accent/20 text-accent',
    danger: 'from-danger/20 to-danger/5 border-danger/20 text-danger',
    warning: 'from-warning/20 to-warning/5 border-warning/20 text-warning',
  };
  
  const baseClasses = color 
    ? colorClasses[color]
    : 'from-white/10 to-white/5 border-white/10 text-white';

  return (
    <div className={`bg-gradient-to-br ${baseClasses} border rounded-lg p-2.5 transition-all hover:scale-[1.02]`}>
      <div className="flex items-center gap-1.5 mb-1 text-muted">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-base font-bold font-mono">{value}</div>
    </div>
  );
}

// Stat Box Component
function StatBox({ label, value, trend }: { 
  label: string; 
  value: string; 
  trend?: 'up' | 'down';
}) {
  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-md p-2">
      <div className="text-[10px] text-muted mb-0.5">{label}</div>
      <div className={`text-sm font-bold font-mono ${
        trend === 'up' ? 'text-accent' : 
        trend === 'down' ? 'text-danger' : 
        'text-white'
      }`}>
        {trend === 'up' && <span className="text-[10px] mr-0.5">+</span>}
        {value}
      </div>
    </div>
  );
}
