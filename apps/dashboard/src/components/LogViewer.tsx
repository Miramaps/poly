'use client';

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface LogEntry {
  timestamp: Date | string;
  level: string;
  name: string;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
  className?: string;
}

export function LogViewer({ logs, className }: LogViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = (ts: Date | string | number | undefined) => {
    if (!ts) return '--:--:--';
    try {
      const d = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(d.getTime())) return '--:--:--';
      return d.toLocaleTimeString('en-US', { hour12: false });
    } catch {
      return '--:--:--';
    }
  };

  const getLogStyle = (level: string) => {
    const l = level?.toLowerCase() || 'info';
    switch (l) {
      case 'error':
        return { icon: '✕', bg: 'bg-red-500/5', border: 'border-l-red-500/50', text: 'text-red-400' };
      case 'warn':
        return { icon: '!', bg: 'bg-yellow-500/5', border: 'border-l-yellow-500/40', text: 'text-yellow-400' };
      case 'trade':
        return { icon: '◆', bg: 'bg-emerald-500/5', border: 'border-l-emerald-500/50', text: 'text-emerald-400' };
      case 'signal':
        return { icon: '◎', bg: 'bg-cyan-500/5', border: 'border-l-cyan-500/40', text: 'text-cyan-400' };
      case 'market':
        return { icon: '●', bg: 'bg-blue-500/5', border: 'border-l-blue-500/40', text: 'text-blue-400' };
      default:
        return { icon: '·', bg: '', border: 'border-l-white/10', text: 'text-white/50' };
    }
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-white/80">Live Logs</span>
        </div>
        <span className="text-[10px] text-white/30 font-mono">{logs.length} entries</span>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 font-mono text-[11px] space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-white/30 text-center py-8 text-xs">Waiting for logs...</div>
        ) : (
          logs.slice(-100).map((log, i) => {
            const style = getLogStyle(log.level);
            return (
              <div 
                key={`log-${i}`} 
                className={cn(
                  'flex items-start gap-2 px-2 py-1 rounded border-l-2 transition-all',
                  style.bg,
                  style.border,
                  'hover:bg-white/[0.03]'
                )}
              >
                {/* Icon */}
                <span className={cn('w-3 text-center shrink-0', style.text)}>
                  {style.icon}
                </span>
                
                {/* Timestamp */}
                <span className="text-white/25 shrink-0 tabular-nums">
                  {formatTime(log.timestamp)}
                </span>
                
                {/* Level badge */}
                <span className={cn('shrink-0 uppercase font-medium w-12', style.text)}>
                  {log.level?.slice(0, 6) || 'LOG'}
                </span>
                
                {/* Message */}
                <span className="text-white/70 break-all leading-relaxed">
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
