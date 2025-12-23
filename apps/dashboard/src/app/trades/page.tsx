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
  const totalVolume = trades.reduce((sum, t) => sum + t.cost, 0);
  const avgPrice = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.price, 0) / trades.length
    : 0;
  const leg1Trades = trades.filter((t) => t.leg === 1);
  const leg2Trades = trades.filter((t) => t.leg === 2);

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={status?.bot?.enabled}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">Trade History</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Total Trades</div>
            <div className="text-2xl font-bold font-mono">{trades.length}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Total Volume</div>
            <div className="text-2xl font-bold font-mono">
              {formatCurrency(totalVolume)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Leg 1 Trades</div>
            <div className="text-2xl font-bold font-mono text-warning">
              {leg1Trades.length}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Leg 2 Trades</div>
            <div className="text-2xl font-bold font-mono text-accent">
              {leg2Trades.length}
            </div>
          </div>
        </div>

        {/* Side breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-accent text-xl">▲</span>
              <span className="font-semibold">UP Trades</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-muted text-sm">Count</div>
                <div className="text-xl font-mono">
                  {trades.filter((t) => t.side === 'UP').length}
                </div>
              </div>
              <div>
                <div className="text-muted text-sm">Volume</div>
                <div className="text-xl font-mono">
                  {formatCurrency(
                    trades
                      .filter((t) => t.side === 'UP')
                      .reduce((sum, t) => sum + t.cost, 0)
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-danger text-xl">▼</span>
              <span className="font-semibold">DOWN Trades</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-muted text-sm">Count</div>
                <div className="text-xl font-mono">
                  {trades.filter((t) => t.side === 'DOWN').length}
                </div>
              </div>
              <div>
                <div className="text-muted text-sm">Volume</div>
                <div className="text-xl font-mono">
                  {formatCurrency(
                    trades
                      .filter((t) => t.side === 'DOWN')
                      .reduce((sum, t) => sum + t.cost, 0)
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trades Table */}
        {loading ? (
          <div className="text-center py-12 text-muted">Loading trades...</div>
        ) : (
          <TradesTable trades={trades} />
        )}
      </main>
    </div>
  );
}

