'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface EquityChartProps {
  data: Array<{
    timestamp: string | Date;
    equity: number;
    cash: number;
  }>;
  initialBankroll?: number;
}

export function EquityChart({ data, initialBankroll = 1000 }: EquityChartProps) {
  const chartData = data.map((d) => ({
    time: new Date(d.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    equity: d.equity,
    cash: d.cash,
  }));

  const minEquity = Math.min(...data.map((d) => d.equity), initialBankroll) * 0.95;
  const maxEquity = Math.max(...data.map((d) => d.equity), initialBankroll) * 1.05;

  return (
    <div className="bg-card border border-border rounded-lg p-4 shadow-card">
      <h3 className="text-lg font-semibold mb-4">Equity Curve</h3>
      
      {data.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-muted">
          No equity data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="time"
              stroke="#525252"
              tick={{ fill: '#737373', fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              domain={[minEquity, maxEquity]}
              stroke="#525252"
              tick={{ fill: '#737373', fontSize: 12 }}
              tickLine={false}
              tickFormatter={(v) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111111',
                border: '1px solid #262626',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#737373' }}
              formatter={(value: number) => [formatCurrency(value), 'Equity']}
            />
            <ReferenceLine
              y={initialBankroll}
              stroke="#525252"
              strokeDasharray="3 3"
              label={{
                value: 'Initial',
                position: 'right',
                fill: '#737373',
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="equity"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}


