'use client';

import { Navigation } from '@/components/Navigation';
import { Terminal } from '@/components/Terminal';
import { useWebSocket } from '@/hooks/useWebSocket';

export default function TerminalPage() {
  const { isConnected, status, logs, clearLogs } = useWebSocket();

  return (
    <div className="min-h-screen">
      <Navigation
        isConnected={isConnected}
        botEnabled={status?.bot?.enabled}
      />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Terminal</h1>
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 text-sm bg-card border border-border rounded hover:bg-foreground/5 transition-colors"
          >
            Clear Logs
          </button>
        </div>

        <Terminal logs={logs} className="h-[calc(100vh-200px)]" />

        {/* Quick Commands */}
        <div className="mt-6 bg-card border border-border rounded-lg p-4 shadow-card">
          <h3 className="text-lg font-semibold mb-3">Quick Commands</h3>
          <div className="flex flex-wrap gap-2">
            {[
              'status',
              'config show',
              'auto on 10 0.95 0.15 4',
              'auto off',
              'bankroll reset',
              'cycles list',
              'trades list',
              'help',
            ].map((cmd) => (
              <button
                key={cmd}
                onClick={async () => {
                  // This will be picked up by the terminal
                  const input = document.querySelector(
                    'input[placeholder*="command"]'
                  ) as HTMLInputElement;
                  if (input) {
                    input.value = cmd;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                  }
                }}
                className="px-3 py-1.5 text-xs font-mono bg-foreground/5 border border-border rounded hover:bg-foreground/10 transition-colors"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

