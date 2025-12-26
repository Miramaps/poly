'use client';

import { useEffect, useState } from 'react';
import { Navigation } from '@/components/Navigation';
import { CyclesTable } from '@/components/CyclesTable';
import { useWebSocket } from '@/hooks/useWebSocket';
import { getCycles } from '@/lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export default function CyclesPage() {
  const { isConnected, status } = useWebSocket();
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCycles = async () => {
      try {
        const res = await getCycles(50);
        setCycles(res.data || []);
      } catch (err) {
        console.error('Failed to fetch cycles:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCycles();
  }, []);

  // Filter completed cycles for distribution chart
  const completedCycles = cycles.filter(
    (c) => c.status === 'complete' && c.lockedInPct !== undefined
  );

  const chartData = completedCycles.map((c, i) => ({
    name: `#${completedCycles.length - i}`,
    pct: c.lockedInPct,
  }));

  const avgProfit =
    completedCycles.length > 0
      ? completedCycles.reduce((sum, c) => sum + (c.lockedInPct || 0), 0) /
        completedCycles.length
      : 0;

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={status?.bot?.enabled}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">Trading Cycles</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Total Cycles</div>
            <div className="text-2xl font-bold font-mono">{cycles.length}</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Completed</div>
            <div className="text-2xl font-bold font-mono text-accent">
              {completedCycles.length}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Incomplete</div>
            <div className="text-2xl font-bold font-mono text-danger">
              {cycles.filter((c) => c.status === 'incomplete').length}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 shadow-card">
            <div className="text-muted text-sm">Avg Locked %</div>
            <div className="text-2xl font-bold font-mono text-accent">
              {avgProfit.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Distribution Chart */}
        {chartData.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4 shadow-card mb-6">
            <h3 className="text-lg font-semibold mb-4">
              Locked-In Profit Distribution
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  stroke="#525252"
                  tick={{ fill: '#737373', fontSize: 10 }}
                />
                <YAxis
                  stroke="#525252"
                  tick={{ fill: '#737373', fontSize: 12 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111111',
                    border: '1px solid #262626',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`${value.toFixed(2)}%`, 'Profit']}
                />
                <ReferenceLine y={avgProfit} stroke="#737373" strokeDasharray="3 3" />
                <Bar
                  dataKey="pct"
                  fill="#22c55e"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cycles Table */}
        {loading ? (
          <div className="text-center py-12 text-muted">Loading cycles...</div>
        ) : (
          <CyclesTable cycles={cycles} />
        )}
      </main>
    </div>
  );
}


