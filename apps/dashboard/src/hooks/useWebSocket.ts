'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getStatus, getLogs } from '@/lib/api';

interface BotStatus {
  bot?: {
    enabled: boolean;
    mode: string;
    tradingMode?: string;
    config?: any;
    uptime?: number;
  };
  currentMarket?: {
    slug: string;
    title: string;
    status: string;
    timeLeft: number;
    inTradingWindow: boolean;
    url?: string;
  };
  orderbooks?: {
    UP: { bestAsk: number; bestBid: number };
    DOWN: { bestAsk: number; bestBid: number };
  };
  portfolio?: {
    cash: number;
    equity: number;
    positions: { UP: number; DOWN: number };
    realizedPnL: number;
    unrealizedPnL: number;
  };
  currentCycle?: any;
  uptime?: number;
  watcherActive?: boolean;
  watcherSecondsRemaining?: number;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(true); // Optimistic
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fallback polling for when WebSocket fails
  const pollStatus = useCallback(async () => {
    try {
      const res = await getStatus();
      if (res.success && res.data) {
        setStatus(res.data);
        setIsConnected(true);
      }
    } catch (err) {
      console.error('Status poll failed:', err);
      setIsConnected(false);
    }
  }, []);

  const pollLogs = useCallback(async () => {
    try {
      const res = await getLogs(50);
      if (res.success && res.data) {
        setLogs(res.data);
      }
    } catch (err) {
      console.error('Logs poll failed:', err);
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://18.175.223.104:3002';
    
    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[WS] Connected');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // The C++ bot sends data in { success, data } format
            if (data.success && data.data) {
              setStatus(data.data);
            } else if (data.orderbooks) {
              // Direct status object
              setStatus(data);
            }
          } catch (err) {
            console.error('[WS] Parse error:', err);
          }
        };

        ws.onerror = (err) => {
          console.error('[WS] Error:', err);
        };

        ws.onclose = () => {
          console.log('[WS] Disconnected, reconnecting in 2s...');
          setIsConnected(false);
          reconnectTimeoutRef.current = setTimeout(connect, 2000);
        };
      } catch (err) {
        console.error('[WS] Connection failed:', err);
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      }
    };

    connect();

    // Cleanup
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Fallback polling every 2s in case WebSocket isn't working
  useEffect(() => {
    // Initial fetch
    pollStatus();
    pollLogs();

    const statusInterval = setInterval(pollStatus, 2000);
    const logsInterval = setInterval(pollLogs, 3000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(logsInterval);
    };
  }, [pollStatus, pollLogs]);

  return { isConnected, status, logs };
}
