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
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
      <h3 className="text-lg font-semibold mb-4">Live Orderbook</h3>
      
      <div className="grid grid-cols-2 gap-4">
        {/* UP Token */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-accent font-bold">▲ UP</span>
          </div>
          <div className="bg-accent/10 rounded-lg p-3">
            <div className="text-sm text-muted">Best Ask</div>
            <div className="text-2xl font-mono font-bold text-accent">
              {formatPrice(upAsk)}
            </div>
          </div>
          <div className="bg-foreground/5 rounded-lg p-3">
            <div className="text-sm text-muted">Best Bid</div>
            <div className="text-xl font-mono text-muted">
              {formatPrice(upBid)}
            </div>
          </div>
        </div>

        {/* DOWN Token */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-danger font-bold">▼ DOWN</span>
          </div>
          <div className="bg-danger/10 rounded-lg p-3">
            <div className="text-sm text-muted">Best Ask</div>
            <div className="text-2xl font-mono font-bold text-danger">
              {formatPrice(downAsk)}
            </div>
          </div>
          <div className="bg-foreground/5 rounded-lg p-3">
            <div className="text-sm text-muted">Best Bid</div>
            <div className="text-xl font-mono text-muted">
              {formatPrice(downBid)}
            </div>
          </div>
        </div>
      </div>

      {/* Sum indicator */}
      {sum !== null && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-muted">Ask Sum (UP + DOWN)</span>
            <span
              className={cn(
                'font-mono font-bold text-lg',
                sum <= 0.95 ? 'text-accent' : sum <= 1.0 ? 'text-warning' : 'text-danger'
              )}
            >
              {sum.toFixed(4)}
            </span>
          </div>
          <div className="mt-2 h-2 bg-foreground/10 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-all duration-300',
                sum <= 0.95 ? 'bg-accent' : sum <= 1.0 ? 'bg-warning' : 'bg-danger'
              )}
              style={{ width: `${Math.min(100, sum * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

