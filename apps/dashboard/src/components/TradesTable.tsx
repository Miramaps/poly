'use client';

import { cn, formatDate, formatCurrency } from '@/lib/utils';

interface Trade {
  id: string;
  timestamp: string;
  leg: number;
  side: string;
  shares: number;
  price: number;
  cost: number;
  cashAfter: number;
}

interface TradesTableProps {
  trades: Trade[];
  className?: string;
}

export function TradesTable({ trades, className }: TradesTableProps) {
  return (
    <div className={cn('bg-card border border-border rounded-lg shadow-card overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-lg font-semibold">Recent Trades</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-black/20">
              <th className="px-4 py-3 text-left text-muted font-medium">Time</th>
              <th className="px-4 py-3 text-left text-muted font-medium">Leg</th>
              <th className="px-4 py-3 text-left text-muted font-medium">Side</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Shares</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Price</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Cost</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Cash After</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No trades yet
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-border/50 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatDate(trade.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-foreground/10 font-mono">
                      L{trade.leg}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded font-mono font-medium',
                        trade.side === 'UP'
                          ? 'bg-accent/20 text-accent'
                          : 'bg-danger/20 text-danger'
                      )}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {trade.shares.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {trade.price.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {formatCurrency(trade.cost)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right text-muted">
                    {formatCurrency(trade.cashAfter)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

