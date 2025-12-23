'use client';

import { cn, formatPercent } from '@/lib/utils';

interface Cycle {
  id: string;
  status: string;
  leg1Side?: string;
  leg1Price?: number;
  leg2Side?: string;
  leg2Price?: number;
  totalCost?: number;
  lockedInPct?: number;
}

interface CycleInfoProps {
  cycle?: Cycle | null;
  className?: string;
}

export function CycleInfo({ cycle, className }: CycleInfoProps) {
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
              {cycle.lockedInPct !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Locked Profit</span>
                  <span className={cn(
                    'font-mono font-bold',
                    cycle.lockedInPct > 0 ? 'text-accent' : 'text-danger'
                  )}>
                    {formatPercent(cycle.lockedInPct)}
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

