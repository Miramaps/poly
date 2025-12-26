'use client';

import { useEffect, useRef } from 'react';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface LogViewerProps {
  logs: LogEntry[];
}

export function LogViewer({ logs }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'info': return 'text-emerald-400';
      default: return 'text-gray-400';
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { hour12: false });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, rgba(20,20,25,0.95) 0%, rgba(10,10,15,0.98) 100%)',
        boxShadow: '0 0 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
      
      {/* Subtle glow accent */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
      
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-white/90 flex items-center gap-2">
            <span className="text-emerald-400">📊</span> Live Logs
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          </h3>
          <span className="text-xs text-white/40">{logs.length} entries</span>
        </div>
        
        {/* Fixed height container with internal scroll */}
        <div 
          ref={containerRef}
          className="h-48 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          style={{ scrollBehavior: 'smooth' }}
        >
          {logs.length === 0 ? (
            <div className="text-white/40 text-sm text-center py-8">
              Waiting for logs...
            </div>
          ) : (
            logs.slice(-50).map((log, i) => (
              <div 
                key={i} 
                className="flex items-start gap-2 text-xs font-mono py-1 px-2 rounded hover:bg-white/5 transition-colors"
              >
                <span className="text-white/30 shrink-0">[{formatTime(log.timestamp)}]</span>
                <span className={`shrink-0 ${getLevelColor(log.level)}`}>{log.level}</span>
                <span className="text-white/70 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
