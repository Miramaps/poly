'use client';

import { cn, formatDate, formatPercent } from '@/lib/utils';

interface Cycle {
  id: string;
  marketSlug: string;
  startedAt: string;
  status: string;
  leg1Side?: string;
  leg1Price?: number;
  leg2Side?: string;
  leg2Price?: number;
  totalCost?: number;
  lockedInPct?: number;
}

interface CyclesTableProps {
  cycles: Cycle[];
  className?: string;
}

export function CyclesTable({ cycles, className }: CyclesTableProps) {
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-muted/20 text-muted',
      leg1_done: 'bg-warning/20 text-warning',
      complete: 'bg-accent/20 text-accent',
      incomplete: 'bg-danger/20 text-danger',
      settled: 'bg-foreground/20 text-foreground',
    };
    return styles[status] || styles.pending;
  };

  return (
    <div className={cn('bg-card border border-border rounded-lg shadow-card overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-lg font-semibold">Recent Cycles</h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-black/20">
              <th className="px-4 py-3 text-left text-muted font-medium">Time</th>
              <th className="px-4 py-3 text-left text-muted font-medium">Status</th>
              <th className="px-4 py-3 text-left text-muted font-medium">Leg 1</th>
              <th className="px-4 py-3 text-left text-muted font-medium">Leg 2</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Total Cost</th>
              <th className="px-4 py-3 text-right text-muted font-medium">Locked %</th>
            </tr>
          </thead>
          <tbody>
            {cycles.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No cycles yet
                </td>
              </tr>
            ) : (
              cycles.map((cycle) => (
                <tr
                  key={cycle.id}
                  className="border-b border-border/50 hover:bg-white/5 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {formatDate(cycle.startedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'px-2 py-1 rounded text-xs font-medium uppercase',
                        getStatusBadge(cycle.status)
                      )}
                    >
                      {cycle.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {cycle.leg1Side && cycle.leg1Price ? (
                      <span className={cycle.leg1Side === 'UP' ? 'text-accent' : 'text-danger'}>
                        {cycle.leg1Side} @ {cycle.leg1Price.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {cycle.leg2Side && cycle.leg2Price ? (
                      <span className={cycle.leg2Side === 'UP' ? 'text-accent' : 'text-danger'}>
                        {cycle.leg2Side} @ {cycle.leg2Price.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {cycle.totalCost ? `$${cycle.totalCost.toFixed(4)}` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-right">
                    {cycle.lockedInPct !== undefined ? (
                      <span className={cycle.lockedInPct > 0 ? 'text-accent' : 'text-danger'}>
                        {formatPercent(cycle.lockedInPct)}
                      </span>
                    ) : (
                      '—'
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


