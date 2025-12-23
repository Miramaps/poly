'use client';

import { cn } from '@/lib/utils';

interface StatusCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  className?: string;
}

export function StatusCard({ title, value, subtitle, trend, icon, className }: StatusCardProps) {
  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg p-4 shadow-card card-hover',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted text-sm font-medium">{title}</p>
          <p className="text-2xl font-bold mt-1 font-mono">{value}</p>
          {subtitle && (
            <p
              className={cn('text-sm mt-1', {
                'text-accent': trend === 'up',
                'text-danger': trend === 'down',
                'text-muted': trend === 'neutral' || !trend,
              })}
            >
              {subtitle}
            </p>
          )}
        </div>
        {icon && <div className="text-muted">{icon}</div>}
      </div>
    </div>
  );
}

