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
      setResponses((prev) => [
        ...prev,
        { 
          command, 
          response: result.message || JSON.stringify(result, null, 2),
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
        'relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[#0d0d0d] via-[#111111] to-[#0a0a0a] flex flex-col',
        className
      )}
    >
      {/* Background decoration */}
      <div className="absolute bottom-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl translate-y-1/2 translate-x-1/2" />
      
      {/* Header */}
      <div className="relative flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-white">Command Terminal</span>
        </div>
        {responses.length > 0 && (
          <button
            onClick={clearResponses}
            className="text-[10px] text-muted hover:text-white px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Command history/responses */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto p-3 font-mono text-xs space-y-2"
      >
        {responses.length === 0 ? (
          <div className="text-muted text-center py-4 text-[10px]">
            Type a command below. Try <span className="text-accent">'help'</span> for available commands.
          </div>
        ) : (
          responses.slice(-10).map((r, i) => (
            <div key={`resp-${i}`} className="space-y-1">
              <div className="text-accent flex items-center gap-1.5">
                <span className="text-muted text-[10px]">$</span> 
                <span className="text-[11px]">{r.command}</span>
              </div>
              <pre className={cn(
                'text-[10px] whitespace-pre-wrap pl-2 border-l-2',
                r.success ? 'border-accent/30 text-foreground/70' : 'border-danger/30 text-danger/80'
              )}>
                {r.response}
              </pre>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="relative border-t border-white/5 p-3 bg-black/20">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-white/[0.02] rounded-lg px-3 py-2 border border-white/5 focus-within:border-accent/30 transition-colors">
            <span className="text-accent font-mono text-xs mr-2">poly&gt;</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? 'Executing...' : "Enter command..."}
              disabled={isLoading}
              className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-foreground placeholder:text-muted/50 disabled:opacity-50"
              autoFocus
            />
          </div>
          {isLoading ? (
            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-3 py-2 bg-gradient-to-br from-accent/20 to-accent/5 hover:from-accent/30 hover:to-accent/10 text-accent border border-accent/20 rounded-lg font-mono text-[10px] font-bold transition-all"
            >
              RUN
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
