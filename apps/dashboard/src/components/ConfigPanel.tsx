'use client';

import { cn } from '@/lib/utils';

interface Config {
  shares: number;
  sumTarget: number;
  move: number;
  windowMin: number;
  dumpWindowSec: number;
  feeBps: number;
}

interface ConfigPanelProps {
  config?: Config;
  className?: string;
}

export function ConfigPanel({ config, className }: ConfigPanelProps) {
  if (!config) {
    return (
      <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
        <h3 className="text-lg font-semibold mb-4">Configuration</h3>
        <div className="text-muted text-center py-4">Loading...</div>
      </div>
    );
  }

  const items = [
    { label: 'Shares per trade', value: config.shares, unit: '' },
    { label: 'Sum target', value: config.sumTarget, unit: '' },
    { label: 'Move threshold', value: (config.move * 100).toFixed(1), unit: '%' },
    { label: 'Watch window', value: config.windowMin, unit: 'min' },
    { label: 'Dump window', value: config.dumpWindowSec, unit: 'sec' },
    { label: 'Fee', value: config.feeBps, unit: 'bps' },
  ];

  return (
    <div className={cn('bg-card border border-border rounded-lg p-4 shadow-card', className)}>
      <h3 className="text-lg font-semibold mb-4">Configuration</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-muted text-sm">{item.label}</span>
            <span className="font-mono font-medium">
              {item.value}
              {item.unit && <span className="text-muted ml-1">{item.unit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


