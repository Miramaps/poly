'use client';

import { cn, formatPercent, formatCurrency } from '@/lib/utils';

interface Cycle {
  id: string;
  status: string;
  leg1Side?: string;
  leg1Price?: number;
  leg1Shares?: number;
  leg2Side?: string;
  leg2Price?: number;
  leg2Shares?: number;
  totalCost?: number;
  lockedInPct?: number;
  lockedInProfit?: number;
}

interface CycleInfoProps {
  cycle?: Cycle | null;
  orderbooks?: {
    UP: { bids?: { price: number }[]; asks?: { price: number }[] } | null;
    DOWN: { bids?: { price: number }[]; asks?: { price: number }[] } | null;
  };
  className?: string;
}

export function CycleInfo({ cycle, orderbooks, className }: CycleInfoProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'pending':
        return { color: 'text-muted', bg: 'bg-white/5', border: 'border-white/10' };
      case 'leg1_done':
        return { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' };
      case 'complete':
        return { color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30' };
      case 'incomplete':
        return { color: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30' };
      default:
        return { color: 'text-muted', bg: 'bg-white/5', border: 'border-white/10' };
    }
  };

  const statusConfig = cycle ? getStatusConfig(cycle.status) : getStatusConfig('pending');

  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Current Cycle</h3>
        {cycle && (
          <div className={cn('px-2 py-0.5 rounded text-[10px] font-medium uppercase', statusConfig.bg, statusConfig.border, statusConfig.color)}>
            {cycle.status.replace('_', ' ')}
          </div>
        )}
      </div>
      
      {!cycle ? (
        <div className="text-muted text-center py-4 text-xs">
          No active cycle
        </div>
      ) : (
        <div className="space-y-3">
          {/* Legs visualization */}
          <div className="grid grid-cols-2 gap-2">
            {/* Leg 1 */}
            <div
              className={cn(
                'rounded-lg p-2 border',
                cycle.leg1Price
                  ? 'bg-warning/10 border-warning/30'
                  : 'bg-white/5 border-border'
              )}
            >
              <span className="text-[10px] text-muted uppercase block mb-1">Leg 1</span>
              {cycle.leg1Price ? (
                <>
                  <div className={cn(
                    'text-sm font-mono font-bold',
                    cycle.leg1Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg1Side === 'UP' ? '▲' : '▼'} {cycle.leg1Side}
                  </div>
                  <div className="text-xs font-mono text-muted">
                    @ {cycle.leg1Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-sm font-mono text-muted">—</div>
              )}
            </div>

            {/* Leg 2 */}
            <div
              className={cn(
                'rounded-lg p-2 border',
                cycle.leg2Price
                  ? 'bg-accent/10 border-accent/30'
                  : 'bg-white/5 border-border'
              )}
            >
              <span className="text-[10px] text-muted uppercase block mb-1">Leg 2</span>
              {cycle.leg2Price ? (
                <>
                  <div className={cn(
                    'text-sm font-mono font-bold',
                    cycle.leg2Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg2Side === 'UP' ? '▲' : '▼'} {cycle.leg2Side}
                  </div>
                  <div className="text-xs font-mono text-muted">
                    @ {cycle.leg2Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-sm font-mono text-muted">—</div>
              )}
            </div>
          </div>

          {/* Summary */}
          {cycle.totalCost !== undefined && (
            <div className="pt-2 border-t border-border space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Total Cost</span>
                <span className="font-mono text-xs">${cycle.totalCost.toFixed(4)}</span>
              </div>
              
              {/* Live P&L for leg1_done status */}
              {cycle.status === 'leg1_done' && cycle.leg1Side && cycle.leg1Shares && orderbooks && (() => {
                const currentBid = orderbooks[cycle.leg1Side as 'UP' | 'DOWN']?.bids?.[0]?.price || 0;
                const currentValue = currentBid * cycle.leg1Shares;
                const unrealizedPnL = currentValue - cycle.totalCost!;
                const unrealizedPct = (unrealizedPnL / cycle.totalCost!) * 100;
                const isProfit = unrealizedPnL >= 0;
                
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">Value</span>
                      <span className="font-mono text-xs">{formatCurrency(currentValue)}</span>
                    </div>
                    <div className={cn(
                      'flex items-center justify-between p-1.5 rounded',
                      isProfit ? 'bg-accent/10' : 'bg-danger/10'
                    )}>
                      <span className="text-xs text-muted">Live P&L</span>
                      <span className={cn(
                        'font-mono text-xs font-bold',
                        isProfit ? 'text-accent' : 'text-danger'
                      )}>
                        {isProfit ? '+' : ''}{formatCurrency(unrealizedPnL)} ({isProfit ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                      </span>
                    </div>
                  </>
                );
              })()}

              {/* Locked profit for complete cycles */}
              {cycle.lockedInPct !== undefined && cycle.lockedInProfit !== undefined && (
                <div className={cn(
                  'flex items-center justify-between p-1.5 rounded',
                  cycle.lockedInPct > 0 ? 'bg-accent/10' : 'bg-danger/10'
                )}>
                  <span className="text-xs text-muted">Locked</span>
                  <span className={cn(
                    'font-mono text-xs font-bold',
                    cycle.lockedInPct > 0 ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.lockedInProfit > 0 ? '+' : ''}{formatCurrency(cycle.lockedInProfit)} ({formatPercent(cycle.lockedInPct)})
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
