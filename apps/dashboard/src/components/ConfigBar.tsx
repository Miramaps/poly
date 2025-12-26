'use client';

import { cn } from '@/lib/utils';

interface ConfigBarProps {
  config?: {
    entryThreshold?: number;
    shares?: number;
    sumTarget?: number;
    dcaEnabled?: boolean;
    tradingWindowSec?: number;
  };
  className?: string;
}

export function ConfigBar({ config, className }: ConfigBarProps) {
  // Default C++ bot config
  const settings = {
    entryThreshold: config?.entryThreshold ?? 0.36,
    shares: config?.shares ?? 10,
    sumTarget: config?.sumTarget ?? 0.99,
    dcaEnabled: config?.dcaEnabled ?? true,
    tradingWindowSec: config?.tradingWindowSec ?? 120,
  };

  const items = [
    { label: 'Entry', value: `$${settings.entryThreshold.toFixed(2)}`, color: 'text-yellow-400' },
    { label: 'Shares', value: settings.shares.toString(), color: 'text-white' },
    { label: 'Sum Target', value: `$${settings.sumTarget.toFixed(2)}`, color: 'text-green-400' },
    { label: 'DCA', value: settings.dcaEnabled ? 'ON' : 'OFF', color: settings.dcaEnabled ? 'text-green-400' : 'text-red-400' },
    { label: 'Trading Window', value: `${settings.tradingWindowSec}s`, color: 'text-blue-400' },
    { label: 'Strategy', value: 'BULLETPROOF', color: 'text-purple-400' },
  ];

  return (
    <div className={cn(
      'bg-gradient-to-r from-black/60 via-black/40 to-black/60 border-b border-border/30 backdrop-blur-md sticky top-16 z-40',
      className
    )}>
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-white/80">⚙️ SETTINGS</span>
            <span className="w-px h-4 bg-border/50" />
          </div>
          <div className="flex items-center gap-6">
            {items.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 shrink-0">
                <span className="text-muted text-xs uppercase tracking-wide">{item.label}</span>
                <span className={cn("font-mono text-sm font-semibold", item.color)}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
