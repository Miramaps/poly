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

  const getLevelColor = (level: string) => {
    const l = level?.toLowerCase() || 'info';
    switch (l) {
      case 'error':
        return 'text-red-500';
      case 'warn':
        return 'text-yellow-500';
      case 'trade':
        return 'text-green-400';
      case 'signal':
        return 'text-cyan-400';
      case 'market':
        return 'text-purple-400';
      case 'price':
        return 'text-blue-400';
      default:
        return 'text-muted';
    }
  };

  const getMessageColor = (level: string) => {
    const l = level?.toLowerCase() || 'info';
    switch (l) {
      case 'error':
        return 'text-red-300';
      case 'warn':
        return 'text-yellow-200';
      case 'trade':
        return 'text-green-300';
      case 'signal':
        return 'text-cyan-300';
      case 'market':
        return 'text-purple-300';
      default:
        return 'text-foreground/80';
    }
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] flex flex-col',
        className
      )}
    >
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2" />
      
      {/* Header */}
      <div className="relative flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5 border border-blue-500/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-white">Live Logs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] text-muted">{logs.length} entries</span>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-muted text-center py-6 text-xs">Waiting for logs...</div>
        ) : (
          logs.slice(-100).map((log, i) => (
            <div 
              key={`log-${i}`} 
              className="flex gap-2 py-0.5 hover:bg-white/[0.02] rounded px-1 -mx-1"
            >
              <span className="text-muted/50 shrink-0">
                [{formatTime(log.timestamp)}]
              </span>
              <span className={cn('shrink-0 uppercase font-semibold w-12', getLevelColor(log.level))}>
                {log.level?.slice(0, 6) || 'LOG'}
              </span>
              <span className={cn('break-all', getMessageColor(log.level))}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
