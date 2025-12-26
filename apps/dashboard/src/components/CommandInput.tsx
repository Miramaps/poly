'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { sendCommand } from '@/lib/api';

interface CommandResponse {
  command: string;
  response: string;
  success: boolean;
}

interface CommandInputProps {
  className?: string;
}

export function CommandInput({ className }: CommandInputProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [responses, setResponses] = useState<CommandResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const command = input.trim();
    setHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);
    setInput('');
    setIsLoading(true);

    try {
      const result = await sendCommand(command);
      // API returns { success: true, data: "response text" }
      const responseText = result.data || result.message || 'Command executed';
      setResponses((prev) => [
        ...prev,
        { 
          command, 
          response: typeof responseText === 'string' ? responseText : JSON.stringify(responseText, null, 2),
          success: result.success !== false
        },
      ]);
    } catch (err) {
      setResponses((prev) => [
        ...prev,
        { 
          command, 
          response: `Error: ${(err as Error).message}`,
          success: false
        },
      ]);
    } finally {
      setIsLoading(false);
      // Scroll to bottom
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    }
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

  const clearResponses = () => {
    setResponses([]);
  };

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-lg overflow-hidden shadow-card flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-black/30">
        <div className="flex items-center gap-2">
          <span className="text-lg">⌨️</span>
          <span className="text-muted text-sm font-mono">Command Terminal</span>
        </div>
        {responses.length > 0 && (
          <button
            onClick={clearResponses}
            className="text-xs text-muted hover:text-white px-2 py-1 rounded hover:bg-white/5"
          >
            Clear
          </button>
        )}
      </div>

      {/* Command history/responses */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-3"
      >
        {responses.length === 0 ? (
          <div className="text-muted text-center py-4 text-xs">
            Type a command below. Try <span className="text-accent">'help'</span> to see available commands.
          </div>
        ) : (
          responses.slice(-10).map((r, i) => (
            <div key={`resp-${i}`} className="space-y-1">
              <div className="text-accent flex items-center gap-2">
                <span className="text-muted">$</span> 
                <span>{r.command}</span>
              </div>
              <pre className={cn(
                'text-xs whitespace-pre-wrap pl-3 border-l-2',
                r.success ? 'border-accent/30 text-foreground/80' : 'border-red-500/30 text-red-400'
              )}>
                {r.response}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4 bg-black/30">
        <div className="flex items-center gap-3">
          <span className="text-accent font-mono text-lg">&gt;</span>
          <div className="flex-1 flex items-center bg-black/40 rounded-lg px-4 py-3 border border-border/50 focus-within:border-accent/50 transition-colors">
            <span className="text-accent font-mono mr-2">poly&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? 'Executing...' : "Enter command... (try 'help')"}
              disabled={isLoading}
              className="flex-1 bg-transparent border-none outline-none font-mono text-base text-foreground placeholder:text-muted/50 disabled:opacity-50"
              autoFocus
            />
          </div>
          {isLoading ? (
            <span className="text-muted animate-pulse text-xl">⏳</span>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-lg font-mono text-sm transition-colors"
            >
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

