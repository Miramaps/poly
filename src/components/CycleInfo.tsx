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
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'text-muted';
      case 'leg1_done':
        return 'text-warning';
      case 'complete':
        return 'text-accent';
      case 'incomplete':
        return 'text-danger';
      default:
        return 'text-muted';
    }
  };

  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
      <h3 className="text-lg font-semibold mb-4">Current Cycle</h3>
      
      {!cycle ? (
        <div className="text-muted text-center py-4">No active cycle</div>
      ) : (
        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-muted">Status</span>
            <span className={cn('font-medium uppercase', getStatusColor(cycle.status))}>
              {cycle.status.replace('_', ' ')}
            </span>
          </div>

          {/* Legs visualization */}
          <div className="grid grid-cols-2 gap-3">
            {/* Leg 1 */}
            <div
              className={cn(
                'rounded-lg p-3 border',
                cycle.leg1Price
                  ? 'bg-warning/10 border-warning/30'
                  : 'bg-foreground/5 border-border'
              )}
            >
              <div className="text-xs text-muted">LEG 1</div>
              {cycle.leg1Price ? (
                <>
                  <div className={cn(
                    'text-lg font-mono font-bold mt-1',
                    cycle.leg1Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg1Side}
                  </div>
                  <div className="text-sm font-mono text-muted">
                    @ {cycle.leg1Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-lg font-mono text-muted mt-1">—</div>
              )}
            </div>

            {/* Leg 2 */}
            <div
              className={cn(
                'rounded-lg p-3 border',
                cycle.leg2Price
                  ? 'bg-accent/10 border-accent/30'
                  : 'bg-foreground/5 border-border'
              )}
            >
              <div className="text-xs text-muted">LEG 2</div>
              {cycle.leg2Price ? (
                <>
                  <div className={cn(
                    'text-lg font-mono font-bold mt-1',
                    cycle.leg2Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg2Side}
                  </div>
                  <div className="text-sm font-mono text-muted">
                    @ {cycle.leg2Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-lg font-mono text-muted mt-1">—</div>
              )}
            </div>
          </div>

          {/* Summary */}
          {cycle.totalCost !== undefined && (
            <div className="pt-3 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted">Total Cost</span>
                <span className="font-mono">${cycle.totalCost.toFixed(4)}</span>
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
                      <span className="text-muted">Current Value</span>
                      <span className="font-mono">{formatCurrency(currentValue)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted">Live P&L</span>
                      <div className="text-right">
                        <span className={cn(
                          'font-mono font-bold',
                          isProfit ? 'text-accent' : 'text-danger'
                        )}>
                          {isProfit ? '+' : ''}{formatCurrency(unrealizedPnL)}
                        </span>
                        <span className={cn(
                          'font-mono text-xs ml-1',
                          isProfit ? 'text-accent/70' : 'text-danger/70'
                        )}>
                          ({isProfit ? '+' : ''}{unrealizedPct.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                    {/* Potential hedge profit indicator */}
                    {(() => {
                      const oppositeSide = cycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
                      const oppositeAsk = orderbooks[oppositeSide]?.asks?.[0]?.price || 0;
                      if (oppositeAsk > 0 && cycle.leg1Price) {
                        const potentialSum = cycle.leg1Price + oppositeAsk;
                        const potentialProfit = cycle.leg1Shares! * 1.0 - (cycle.totalCost! + oppositeAsk * cycle.leg1Shares!);
                        const potentialPct = (potentialProfit / (cycle.totalCost! + oppositeAsk * cycle.leg1Shares!)) * 100;
                        return (
                          <div className="flex items-center justify-between pt-1 border-t border-border/50">
                            <span className="text-muted text-xs">If hedge now (sum: {potentialSum.toFixed(3)})</span>
                            <span className={cn(
                              'font-mono text-xs',
                              potentialProfit > 0 ? 'text-accent' : 'text-danger'
                            )}>
                              {potentialProfit > 0 ? '+' : ''}{formatCurrency(potentialProfit)} ({potentialPct.toFixed(1)}%)
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </>
                );
              })()}

              {/* Locked profit for complete cycles */}
              {cycle.lockedInPct !== undefined && cycle.lockedInProfit !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Locked Profit</span>
                  <div className="text-right">
                    <span className={cn(
                      'font-mono font-bold',
                      cycle.lockedInPct > 0 ? 'text-accent' : 'text-danger'
                    )}>
                      {cycle.lockedInProfit > 0 ? '+' : ''}{formatCurrency(cycle.lockedInProfit)}
                    </span>
                    <span className={cn(
                      'font-mono text-xs ml-1',
                      cycle.lockedInPct > 0 ? 'text-accent/70' : 'text-danger/70'
                    )}>
                      ({formatPercent(cycle.lockedInPct)})
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

