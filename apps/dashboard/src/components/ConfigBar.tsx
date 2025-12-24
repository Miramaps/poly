'use client';

import { cn } from '@/lib/utils';

interface ConfigBarProps {
  config?: {
    shares: number;
    sumTarget: number;
    move: number;
    windowMin: number;
    dumpWindowSec: number;
    feeBps: number;
  };
  className?: string;
}

export function ConfigBar({ config, className }: ConfigBarProps) {
  if (!config) return null;

  const items = [
    { label: 'Shares', value: config.shares ?? '—', unit: '' },
    { label: 'Sum Target', value: config.sumTarget?.toFixed(2) ?? '—', unit: '' },
    { label: 'Move', value: config.move != null ? (config.move * 100).toFixed(1) : '—', unit: '%' },
    { label: 'Window', value: config.windowMin ?? '—', unit: 'min' },
    { label: 'Dump', value: config.dumpWindowSec ?? '—', unit: 'sec' },
    { label: 'Fee', value: config.feeBps ?? '0', unit: 'bps' },
  ];

  return (
    <div className={cn(
      'bg-black/40 border-b border-border/50 backdrop-blur-sm',
      className
    )}>
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          <span className="text-muted text-xs font-mono shrink-0">⚙️ CONFIG</span>
          <div className="flex items-center gap-6">
            {items.map((item) => (
              <div key={item.label} className="flex items-center gap-2 shrink-0">
                <span className="text-muted text-xs">{item.label}:</span>
                <span className="text-white font-mono text-sm">
                  {item.value}{item.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

