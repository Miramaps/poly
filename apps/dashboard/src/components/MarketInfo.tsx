'use client';

import { cn, formatCountdown } from '@/lib/utils';

interface Market {
  slug: string;
  status: string;
  startTime?: string;
  endTime?: string;
}

interface MarketInfoProps {
  market?: Market | null;
  watcherActive?: boolean;
  watcherSecondsRemaining?: number;
  className?: string;
}

export function MarketInfo({
  market,
  watcherActive,
  watcherSecondsRemaining = 0,
  className,
}: MarketInfoProps) {
  const getTimeInfo = () => {
    if (!market) return { label: '', value: '' };

    const now = Date.now();

    if (market.status === 'upcoming' && market.startTime) {
      const timeToStart = Math.max(0, (new Date(market.startTime).getTime() - now) / 1000);
      return { label: 'Starts in', value: formatCountdown(timeToStart) };
    }

    if (market.status === 'live' && market.endTime) {
      const timeToEnd = Math.max(0, (new Date(market.endTime).getTime() - now) / 1000);
      return { label: 'Ends in', value: formatCountdown(timeToEnd) };
    }

    return { label: 'Status', value: market.status.toUpperCase() };
  };

  const timeInfo = getTimeInfo();

  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
      <h3 className="text-lg font-semibold mb-4">Current Market</h3>
      
      {!market ? (
        <div className="text-muted text-center py-4">No market selected</div>
      ) : (
        <div className="space-y-4">
          {/* Market slug */}
          <div>
            <div className="text-sm text-muted">Market</div>
            <div className="font-mono text-sm mt-1 truncate">{market.slug}</div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'px-2 py-1 rounded text-xs font-medium uppercase',
                {
                  'bg-muted/20 text-muted': market.status === 'upcoming',
                  'bg-accent/20 text-accent': market.status === 'live',
                  'bg-foreground/20 text-foreground': market.status === 'ended',
                }
              )}
            >
              {market.status}
            </span>
          </div>

          {/* Time info */}
          <div className="bg-foreground/5 rounded-lg p-3">
            <div className="text-sm text-muted">{timeInfo.label}</div>
            <div className="text-2xl font-mono font-bold">{timeInfo.value}</div>
          </div>

          {/* Watcher status */}
          {watcherActive && (
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="text-accent font-medium">Watcher Active</span>
              </div>
              <div className="text-2xl font-mono font-bold text-accent mt-1">
                {formatCountdown(watcherSecondsRemaining)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

