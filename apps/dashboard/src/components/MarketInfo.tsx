'use client';

import { cn, formatCountdown } from '@/lib/utils';

interface Market {
  slug: string;
  status: string;
  secondsLeft?: number;
  startTime?: string;
  endTime?: string;
}

interface MarketInfoProps {
  market?: Market | null;
  watcherActive?: boolean;
  watcherSecondsRemaining?: number;
  className?: string;
}

const TRADING_WINDOW_SEC = 120;
const WINDOW_DURATION_SEC = 900;

export function MarketInfo({
  market,
  className,
}: MarketInfoProps) {
  const secondsLeft = market?.secondsLeft ?? 0;
  const secondsElapsed = WINDOW_DURATION_SEC - secondsLeft;
  
  const isInTradingWindow = secondsElapsed < TRADING_WINDOW_SEC && secondsLeft > 0;
  const isWatching = secondsElapsed >= TRADING_WINDOW_SEC && secondsLeft > 0;
  const isEnded = secondsLeft <= 0;
  
  const tradingSecondsLeft = Math.max(0, TRADING_WINDOW_SEC - secondsElapsed);
  const progressPct = Math.min(100, (secondsElapsed / WINDOW_DURATION_SEC) * 100);
  const tradingPct = (TRADING_WINDOW_SEC / WINDOW_DURATION_SEC) * 100;

  if (!market) {
    return (
      <div className={cn('relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] p-3', className)}>
        <div className="text-muted text-center text-xs">No market selected</div>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a]', className)}>
      {/* Background decorations */}
      {isInTradingWindow && (
        <div className="absolute top-0 left-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
      )}
      {isWatching && (
        <div className="absolute top-0 left-0 w-32 h-32 bg-warning/10 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
      )}
      
      <div className="relative flex items-center gap-3 p-3">
        {/* Status Badge */}
        <div className={cn(
          'px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide shrink-0 min-w-[80px] text-center border',
          isInTradingWindow && 'bg-gradient-to-br from-accent/20 to-accent/5 text-accent border-accent/30',
          isWatching && 'bg-gradient-to-br from-warning/20 to-warning/5 text-warning border-warning/30',
          isEnded && 'bg-gradient-to-br from-white/10 to-white/5 text-muted border-white/10'
        )}>
          {isInTradingWindow ? '🔥 TRADING' : isWatching ? '👁️ WATCH' : '⏹️ END'}
        </div>

        {/* Market Slug */}
        <div className="shrink-0">
          <div className="text-[9px] text-muted uppercase">Market</div>
          <a
            href={`https://polymarket.com/event/${market.slug}/${market.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            {market.slug?.slice(0, 20)}... ↗
          </a>
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Trading Timer */}
        <div className={cn(
          'px-2 py-1 rounded-lg shrink-0 text-center min-w-[70px] border',
          isInTradingWindow ? 'bg-gradient-to-br from-accent/20 to-accent/5 border-accent/30' : 'bg-white/[0.02] border-white/5'
        )}>
          <div className="text-[9px] text-muted uppercase">Trading</div>
          <div className={cn(
            'text-sm font-mono font-bold',
            isInTradingWindow ? 'text-accent' : 'text-muted'
          )}>
            {isInTradingWindow ? formatCountdown(tradingSecondsLeft) : '0:00'}
          </div>
        </div>

        {/* Window Timer */}
        <div className={cn(
          'px-2 py-1 rounded-lg shrink-0 text-center min-w-[70px] border',
          isWatching ? 'bg-gradient-to-br from-warning/20 to-warning/5 border-warning/30' : 'bg-white/[0.02] border-white/5'
        )}>
          <div className="text-[9px] text-muted uppercase">Window</div>
          <div className={cn(
            'text-sm font-mono font-bold',
            isWatching ? 'text-warning' : isEnded ? 'text-muted' : 'text-white'
          )}>
            {secondsLeft > 0 ? formatCountdown(secondsLeft) : '0:00'}
          </div>
        </div>

        <div className="h-6 w-px bg-white/10 shrink-0" />

        {/* Progress Bar */}
        <div className="flex-1 min-w-[120px]">
          <div className="h-2 bg-white/5 rounded-full overflow-hidden relative">
            <div 
              className="absolute h-full bg-accent/10 left-0"
              style={{ width: `${tradingPct}%` }}
            />
            <div 
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isInTradingWindow ? 'bg-gradient-to-r from-accent to-green-400' : 'bg-gradient-to-r from-warning to-yellow-400'
              )}
              style={{ width: `${progressPct}%` }}
            />
            <div 
              className="absolute h-full w-px bg-white/30"
              style={{ left: `${tradingPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[8px] text-muted font-mono mt-0.5">
            <span>2m Trade</span>
            <span>13m Watch</span>
          </div>
        </div>

        {/* Next */}
        <div className="shrink-0 text-right">
          <div className="text-[9px] text-muted uppercase">Next</div>
          <div className="text-xs font-mono text-white">
            {secondsLeft > 0 ? formatCountdown(secondsLeft) : '...'}
          </div>
        </div>
      </div>
    </div>
  );
}
