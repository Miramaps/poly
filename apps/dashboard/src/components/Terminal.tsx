'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { sendCommand } from '@/lib/api';

interface LogEntry {
  timestamp: Date | string;
  level: string;
  name: string;
  message: string;
}

interface TerminalProps {
  logs: LogEntry[];
  onCommand?: (command: string) => void;
  className?: string;
}

export function Terminal({ logs, onCommand, className }: TerminalProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [responses, setResponses] = useState<Array<{ command: string; response: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, responses]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    const command = input.trim();
    setHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);
    setInput('');

    try {
      const result = await sendCommand(command);
      setResponses((prev) => [
        ...prev,
        { command, response: result.message || JSON.stringify(result) },
      ]);
    } catch (err) {
      setResponses((prev) => [
        ...prev,
        { command, response: `Error: ${(err as Error).message}` },
      ]);
    }

    onCommand?.(command);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[history.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const formatTime = (ts: Date | string) => {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return d.toLocaleTimeString('en-US', { hour12: false });
  };

  const getLevelClass = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'log-error';
      case 'warn':
        return 'log-warn';
      case 'info':
        return 'log-info';
      default:
        return 'log-debug';
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
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-danger/80" />
          <div className="w-3 h-3 rounded-full bg-warning/80" />
          <div className="w-3 h-3 rounded-full bg-accent/80" />
        </div>
        <span className="text-muted text-sm font-mono ml-2">poly-trader</span>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-0.5 min-h-[300px] max-h-[500px]"
      >
        {/* Command responses */}
        {responses.map((r, i) => (
          <div key={`resp-${i}`} className="space-y-1">
            <div className="text-accent">
              <span className="text-muted">$</span> {r.command}
            </div>
            <pre className="text-foreground/80 whitespace-pre-wrap pl-2 border-l border-border/50">
              {r.response}
            </pre>
          </div>
        ))}

        {/* Live logs */}
        {logs.slice(-50).map((log, i) => (
          <div key={`log-${i}`} className="flex gap-2 opacity-80 hover:opacity-100">
            <span className="text-muted shrink-0">[{formatTime(log.timestamp)}]</span>
            <span className={cn('shrink-0 uppercase', getLevelClass(log.level))}>
              {log.level.slice(0, 3)}
            </span>
            <span className="text-muted shrink-0">[{log.name}]</span>
            <span className="text-foreground/90">{log.message}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 bg-black/20">
        <div className="flex items-center gap-2">
          <span className="text-accent font-mono">💹 poly&gt;</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command... (try 'help')"
            className="flex-1 bg-transparent border-none outline-none font-mono text-foreground placeholder:text-muted/50"
            autoFocus
          />
          <span className="terminal-cursor text-accent">▌</span>
        </div>
      </div>
    </div>
  );
}

