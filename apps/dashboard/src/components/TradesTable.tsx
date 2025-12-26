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
  pnl?: number;
}

interface TradesTableProps {
  trades: Trade[];
  className?: string;
}

export function TradesTable({ trades, className }: TradesTableProps) {
  // Calculate P&L for trades - pair leg1 with leg2
  const tradesWithPnL = trades.map((trade, index) => {
    let pnl: number | undefined = undefined;
    
    if (trade.leg === 2) {
      // Find the matching Leg 1 trade (previous trade with leg === 1)
      const leg1Trade = trades.slice(index + 1).find(t => t.leg === 1);
      if (leg1Trade) {
        // P&L = (1.0 - leg1_price - leg2_price) * shares
        pnl = (1.0 - leg1Trade.price - trade.price) * trade.shares;
      }
    }
    
    return { ...trade, pnl };
  });

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
              <th className="px-4 py-3 text-right text-muted font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {tradesWithPnL.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  No trades yet
                </td>
              </tr>
            ) : (
              tradesWithPnL.map((trade) => (
                <tr
                  key={trade.id}
                  className="border-b border-border/50 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatDate(trade.timestamp)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "px-2 py-0.5 rounded font-mono",
                      trade.leg === 1 ? "bg-yellow-500/20 text-yellow-400" : "bg-green-500/20 text-green-400"
                    )}>
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
                    {trade.shares.toFixed(0)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    ${trade.price.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {formatCurrency(trade.cost)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right text-muted">
                    {formatCurrency(trade.cashAfter)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {trade.pnl !== undefined ? (
                      <span className={cn(
                        "font-bold",
                        trade.pnl > 0 ? "text-green-400" : trade.pnl < 0 ? "text-red-400" : "text-muted"
                      )}>
                        {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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

