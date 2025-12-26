'use client';

import { cn } from '@/lib/utils';

interface OrderbookDisplayProps {
  upAsk?: number;
  downAsk?: number;
  upBid?: number;
  downBid?: number;
  className?: string;
}

export function OrderbookDisplay({
  upAsk,
  downAsk,
  upBid,
  downBid,
  className,
}: OrderbookDisplayProps) {
  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return '—';
    return price.toFixed(4);
  };

  const sum = upAsk && downAsk ? upAsk + downAsk : null;

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] p-3', className)}>
      {/* Background decorations */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-20 h-20 bg-danger/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
      
      {/* Header */}
      <div className="relative flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Live Orderbook</h3>
          <p className="text-[10px] text-muted">Best prices</p>
        </div>
      </div>
      
      <div className="relative grid grid-cols-2 gap-2">
        {/* UP Token */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-accent text-sm">▲</span>
            <span className="text-xs font-bold text-accent">UP</span>
          </div>
          <div className="bg-gradient-to-br from-accent/15 to-accent/5 border border-accent/20 rounded-lg p-2">
            <div className="text-[9px] text-muted uppercase">Ask</div>
            <div className="text-lg font-mono font-bold text-accent">
              {formatPrice(upAsk)}
            </div>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2">
            <div className="text-[9px] text-muted uppercase">Bid</div>
            <div className="text-sm font-mono text-muted">
              {formatPrice(upBid)}
            </div>
          </div>
        </div>

        {/* DOWN Token */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-danger text-sm">▼</span>
            <span className="text-xs font-bold text-danger">DOWN</span>
          </div>
          <div className="bg-gradient-to-br from-danger/15 to-danger/5 border border-danger/20 rounded-lg p-2">
            <div className="text-[9px] text-muted uppercase">Ask</div>
            <div className="text-lg font-mono font-bold text-danger">
              {formatPrice(downAsk)}
            </div>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2">
            <div className="text-[9px] text-muted uppercase">Bid</div>
            <div className="text-sm font-mono text-muted">
              {formatPrice(downBid)}
            </div>
          </div>
        </div>
      </div>

      {/* Sum indicator */}
      {sum !== null && (
        <div className="relative mt-3 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted uppercase">Ask Sum</span>
            <span
              className={cn(
                'font-mono font-bold text-sm',
                sum <= 0.95 ? 'text-accent' : sum <= 1.0 ? 'text-warning' : 'text-danger'
              )}
            >
              {sum.toFixed(4)}
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                sum <= 0.95 ? 'bg-gradient-to-r from-accent to-green-400' : 
                sum <= 1.0 ? 'bg-gradient-to-r from-warning to-yellow-400' : 
                'bg-gradient-to-r from-danger to-red-400'
              )}
              style={{ width: `${Math.min(100, sum * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
