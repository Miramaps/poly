'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getStatus, getLogs } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://18.175.223.104:3002';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const initialDataLoaded = useRef(false);

  // Poll status continuously to get currentCycle and other updates
  const pollStatus = useCallback(async () => {
    try {
      const res = await getStatus();
      if (res.success && res.data) {
        setStatus(res.data);
        initialDataLoaded.current = true;
      }
    } catch (err) {
      console.error('[STATUS] Poll failed:', err);
    }
  }, []);

  useEffect(() => {
    pollStatus(); // Initial fetch
    const statusInterval = setInterval(pollStatus, 1000); // Poll every second
    return () => clearInterval(statusInterval);
  }, [pollStatus]);

  // WebSocket for ALL real-time updates
  useEffect(() => {
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
            
            // C++ bot sends FULL status via WebSocket (type: "fullStatus")
            if (data.type === 'fullStatus') {
              setStatus((prev: any) => ({
                ...prev,
                orderbooks: data.orderbooks || prev?.orderbooks,
                currentMarket: {
                  ...(prev?.currentMarket || {}),
                  slug: data.market,
                  timeLeft: data.timeLeft,
                  inTradingWindow: data.inTrading,
                  status: data.inTrading ? 'TRADING' : 'WATCHING'
                }
              }));
            }
            // Also handle old format for backwards compatibility
            else if (data.type === 'status') {
              setStatus((prev: any) => ({
                ...prev,
                orderbooks: {
                  UP: { asks: [{ price: data.upPrice }], bids: [{ price: data.upPrice - 0.01 }] },
                  DOWN: { asks: [{ price: data.downPrice }], bids: [{ price: data.downPrice - 0.01 }] }
                },
                currentMarket: {
                  ...(prev?.currentMarket || {}),
                  slug: data.market,
                  timeLeft: data.timeLeft,
                  inTradingWindow: data.inTrading,
                  status: data.inTrading ? 'TRADING' : 'WATCHING'
                }
              }));
            }
          } catch (err) {
            console.error('[WS] Parse error:', err);
          }
        };

        ws.onerror = () => setIsConnected(false);
        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimeout.current = setTimeout(connect, 1000);
        };
      } catch (err) {
        reconnectTimeout.current = setTimeout(connect, 1000);
      }
    };

    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  // Logs polling only (no WebSocket for logs)
  const pollLogs = useCallback(async () => {
    try {
      const res = await getLogs(50);
      if (res.success && res.data) setLogs(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    pollLogs();
    const logsInterval = setInterval(pollLogs, 2000);
    return () => clearInterval(logsInterval);
  }, [pollLogs]);

  return { isConnected, status, logs, lastTrade: null, lastCycle: null, sendCommand: () => {}, clearLogs: () => setLogs([]), usePolling: false };
}
