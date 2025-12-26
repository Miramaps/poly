'use client';

import { cn, formatPercent, formatCurrency } from '@/lib/utils';

interface Cycle {
  id: string;
  status: string;
  leg1Side: string;
  leg1Price: number;
  leg1Shares: number;
  leg2Side?: string;
  leg2Price?: number;
  leg2Shares?: number;
  totalCost: number;
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
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] p-3', className)}>
      {/* Background decoration */}
      <div className="absolute bottom-0 right-0 w-24 h-24 bg-warning/5 rounded-full blur-3xl translate-y-1/2 translate-x-1/2" />
      
      {/* Header */}
      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-warning/20 to-warning/5 border border-warning/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Current Cycle</h3>
            <p className="text-[10px] text-muted">Trade progress</p>
          </div>
        </div>
        {cycle && (
          <div className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border', statusConfig.bg, statusConfig.border, statusConfig.color)}>
            {cycle.status.replace('_', ' ')}
          </div>
        )}
      </div>
      
      {!cycle || !cycle.active ? (
        <div className="relative text-muted text-center py-4 text-xs bg-white/[0.02] rounded-lg border border-white/5">
          No active cycle
        </div>
      ) : (
        <div className="relative space-y-3">
          {/* Legs visualization */}
          <div className="grid grid-cols-2 gap-2">
            {/* Leg 1 */}
            <div
              className={cn(
                'rounded-lg p-2.5 border',
                cycle.leg1Price
                  ? 'bg-gradient-to-br from-warning/15 to-warning/5 border-warning/30'
                  : 'bg-white/[0.02] border-white/5'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-full bg-warning/20 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-warning">1</span>
                </div>
                <span className="text-[10px] text-muted uppercase">Leg 1</span>
              </div>
              {cycle.leg1Price ? (
                <>
                  <div className={cn(
                    'text-base font-mono font-bold',
                    cycle.leg1Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg1Side === 'UP' ? '▲' : '▼'} {cycle.leg1Side}
                  </div>
                  <div className="text-xs font-mono text-muted">
                    @ {cycle.leg1Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-base font-mono text-muted">—</div>
              )}
            </div>

            {/* Leg 2 */}
            <div
              className={cn(
                'rounded-lg p-2.5 border',
                cycle.leg2Price
                  ? 'bg-gradient-to-br from-accent/15 to-accent/5 border-accent/30'
                  : 'bg-white/[0.02] border-white/5'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-accent">2</span>
                </div>
                <span className="text-[10px] text-muted uppercase">Leg 2</span>
              </div>
              {cycle.leg2Price ? (
                <>
                  <div className={cn(
                    'text-base font-mono font-bold',
                    cycle.leg2Side === 'UP' ? 'text-accent' : 'text-danger'
                  )}>
                    {cycle.leg2Side === 'UP' ? '▲' : '▼'} {cycle.leg2Side}
                  </div>
                  <div className="text-xs font-mono text-muted">
                    @ {cycle.leg2Price.toFixed(4)}
                  </div>
                </>
              ) : (
                <div className="text-base font-mono text-muted">—</div>
              )}
            </div>
          </div>

          {/* Summary */}
          {cycle.totalCost !== undefined && (
            <div className="pt-2 border-t border-white/5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted uppercase">Total Cost</span>
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
                      <span className="text-[10px] text-muted uppercase">Value</span>
                      <span className="font-mono text-xs">{formatCurrency(currentValue)}</span>
                    </div>
                    <div className={cn(
                      'flex items-center justify-between p-1.5 rounded-md',
                      isProfit ? 'bg-accent/10' : 'bg-danger/10'
                    )}>
                      <span className="text-[10px] text-muted uppercase">Live P&L</span>
                      <div className="text-right">
                        <span className={cn(
                          'font-mono font-bold text-xs',
                          isProfit ? 'text-accent' : 'text-danger'
                        )}>
                          {isProfit ? '+' : ''}{formatCurrency(unrealizedPnL)}
                        </span>
                        <span className={cn(
                          'font-mono text-[10px] ml-1',
                          isProfit ? 'text-accent/70' : 'text-danger/70'
                        )}>
                          ({isProfit ? '+' : ''}{unrealizedPct.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                    {/* Potential hedge */}
                    {(() => {
                      const oppositeSide = cycle.leg1Side === 'UP' ? 'DOWN' : 'UP';
                      const oppositeAsk = orderbooks[oppositeSide]?.asks?.[0]?.price || 0;
                      if (oppositeAsk > 0 && cycle.leg1Price) {
                        const potentialSum = cycle.leg1Price + oppositeAsk;
                        const potentialProfit = cycle.leg1Shares! * 1.0 - (cycle.totalCost! + oppositeAsk * cycle.leg1Shares!);
                        const potentialPct = (potentialProfit / (cycle.totalCost! + oppositeAsk * cycle.leg1Shares!)) * 100;
                        return (
                          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-white/5">
                            <span className="text-muted">Hedge @ {potentialSum.toFixed(3)}</span>
                            <span className={cn(
                              'font-mono',
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
                <div className={cn(
                  'flex items-center justify-between p-1.5 rounded-md',
                  cycle.lockedInPct > 0 ? 'bg-accent/10' : 'bg-danger/10'
                )}>
                  <span className="text-[10px] text-muted uppercase">Locked</span>
                  <div className="text-right">
                    <span className={cn(
                      'font-mono font-bold text-xs',
                      cycle.lockedInPct > 0 ? 'text-accent' : 'text-danger'
                    )}>
                      {cycle.lockedInProfit > 0 ? '+' : ''}{formatCurrency(cycle.lockedInProfit)}
                    </span>
                    <span className={cn(
                      'font-mono text-[10px] ml-1',
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
