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

  const formatTime = (ts: Date | string) => {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return d.toLocaleTimeString('en-US', { hour12: false });
  };

  const getLevelClass = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-red-500';
      case 'warn':
        return 'text-yellow-500';
      case 'trade':
        return 'text-green-400 font-bold';
      case 'signal':
        return 'text-cyan-400';
      case 'market':
        return 'text-blue-400';
      case 'info':
        return 'text-gray-400';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg overflow-hidden shadow-card flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-black/30">
        <span className="text-muted text-sm font-mono">📊 Live Logs</span>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-muted text-center py-8">Waiting for logs...</div>
        ) : (
          logs.slice(-100).map((log, i) => (
            <div key={`log-${i}`} className="flex gap-2 opacity-90 hover:opacity-100">
              <span className="text-muted shrink-0 text-[10px]">[{formatTime(log.timestamp)}]</span>
              <span className={cn('shrink-0 uppercase text-[10px] w-12', getLevelClass(log.level))}>
                {log.level?.slice(0, 6) || 'LOG'}
              </span>
              <span className="text-foreground break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

