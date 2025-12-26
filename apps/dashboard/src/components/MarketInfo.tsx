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

const TRADING_WINDOW_SEC = 120; // 2 minutes trading window at start
const WINDOW_DURATION_SEC = 900; // 15 minutes total

export function MarketInfo({
  market,
  className,
}: MarketInfoProps) {
  const secondsLeft = market?.secondsLeft ?? 0;
  const secondsElapsed = WINDOW_DURATION_SEC - secondsLeft;
  
  // Determine trading phase
  const isInTradingWindow = secondsElapsed < TRADING_WINDOW_SEC && secondsLeft > 0;
  const isWatching = secondsElapsed >= TRADING_WINDOW_SEC && secondsLeft > 0;
  const isEnded = secondsLeft <= 0;
  
  // Time in trading window
  const tradingSecondsLeft = Math.max(0, TRADING_WINDOW_SEC - secondsElapsed);
  
  // Progress bar percentage
  const progressPct = Math.min(100, (secondsElapsed / WINDOW_DURATION_SEC) * 100);
  const tradingPct = (TRADING_WINDOW_SEC / WINDOW_DURATION_SEC) * 100;

  if (!market) {
    return (
      <div className={cn('bg-black/40 border border-border/50 rounded-lg p-3', className)}>
        <div className="text-gray-500 text-center text-sm">No market selected</div>
      </div>
    );
  }

  return (
    <div className={cn('bg-black/40 border border-border/50 rounded-lg backdrop-blur-sm', className)}>
      <div className="flex items-center gap-4 p-3">
        
        {/* Status Badge */}
        <div className={cn(
          'px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide shrink-0 min-w-[100px] text-center',
          isInTradingWindow && 'bg-green-500/20 text-green-400 border border-green-500/50',
          isWatching && 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50',
          isEnded && 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
        )}>
          {isInTradingWindow ? '🔥 TRADING' : isWatching ? '👁️ WATCHING' : '⏹️ ENDED'}
        </div>

        {/* Market Slug */}
        <div className="shrink-0">
          <div className="text-[10px] text-gray-500 uppercase">Market</div>
          <a
            href={`https://polymarket.com/event/${market.slug}/${market.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {market.slug} ↗
          </a>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-700 shrink-0" />

        {/* Trading Phase Timer */}
        <div className={cn(
          'px-3 py-1 rounded-lg shrink-0 text-center min-w-[90px]',
          isInTradingWindow ? 'bg-green-500/10 border border-green-500/30' : 'bg-gray-800/50'
        )}>
          <div className="text-[10px] text-gray-500 uppercase">Trading</div>
          <div className={cn(
            'text-lg font-mono font-bold',
            isInTradingWindow ? 'text-green-400' : 'text-gray-600'
          )}>
            {isInTradingWindow ? formatCountdown(tradingSecondsLeft) : '0:00'}
          </div>
        </div>

        {/* Window Timer */}
        <div className={cn(
          'px-3 py-1 rounded-lg shrink-0 text-center min-w-[90px]',
          isWatching ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-gray-800/50'
        )}>
          <div className="text-[10px] text-gray-500 uppercase">Window</div>
          <div className={cn(
            'text-lg font-mono font-bold',
            isWatching ? 'text-yellow-400' : isEnded ? 'text-gray-600' : 'text-white'
          )}>
            {secondsLeft > 0 ? formatCountdown(secondsLeft) : '0:00'}
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-700 shrink-0" />

        {/* Progress Bar - Flexible Width */}
        <div className="flex-1 min-w-[200px]">
          <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden relative">
            {/* Trading zone background */}
            <div 
              className="absolute h-full bg-green-500/20 left-0"
              style={{ width: `${tradingPct}%` }}
            />
            {/* Progress fill */}
            <div 
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isInTradingWindow ? 'bg-gradient-to-r from-green-500 to-green-400' : 'bg-gradient-to-r from-yellow-500 to-yellow-400'
              )}
              style={{ width: `${progressPct}%` }}
            />
            {/* Divider line */}
            <div 
              className="absolute h-full w-0.5 bg-white/40"
              style={{ left: `${tradingPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-1">
            <span>← 2min Trading →</span>
            <span>← 13min Watching →</span>
            <span>15:00</span>
          </div>
        </div>

        {/* Next Market */}
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-gray-500 uppercase">Next Market</div>
          <div className="text-sm font-mono text-gray-400">
            {secondsLeft > 0 ? formatCountdown(secondsLeft) : 'Loading...'}
          </div>
        </div>
      </div>
    </div>
  );
}

