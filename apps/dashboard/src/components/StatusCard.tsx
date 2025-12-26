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
  const trendColors = {
    up: 'from-accent/20 to-accent/5 border-accent/20',
    down: 'from-danger/20 to-danger/5 border-danger/20',
    neutral: 'from-white/10 to-white/5 border-white/10',
  };

  const gradientClass = trend ? trendColors[trend] : 'from-white/10 to-white/5 border-white/10';

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gradient-to-br border rounded-xl p-3 transition-all hover:scale-[1.02] shadow-lg',
        gradientClass,
        className
      )}
    >
      {/* Subtle glow effect */}
      {trend === 'up' && (
        <div className="absolute top-0 right-0 w-16 h-16 bg-accent/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
      )}
      {trend === 'down' && (
        <div className="absolute top-0 right-0 w-16 h-16 bg-danger/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
      )}
      
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-muted text-[10px] uppercase tracking-wider font-medium">{title}</p>
          <p className="text-lg font-bold mt-0.5 font-mono">{value}</p>
          {subtitle && (
            <p
              className={cn('text-xs mt-0.5 font-mono', {
                'text-accent': trend === 'up',
                'text-danger': trend === 'down',
                'text-muted': trend === 'neutral' || !trend,
              })}
            >
              {trend === 'up' && '↑ '}{trend === 'down' && '↓ '}{subtitle}
            </p>
          )}
        </div>
        {icon && (
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            trend === 'up' ? 'bg-accent/20 text-accent' :
            trend === 'down' ? 'bg-danger/20 text-danger' :
            'bg-white/10 text-muted'
          )}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
