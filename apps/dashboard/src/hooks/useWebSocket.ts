'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getStatus, getLogs } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://18.175.223.104:3002';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();

  // Connect to WebSocket for real-time price updates
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected to dashboard server');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status') {
            setStatus((prev: any) => ({
              ...prev,
              orderbooks: {
                UP: { bestAsk: data.upPrice, bestBid: data.upPrice },
                DOWN: { bestAsk: data.downPrice, bestBid: data.downPrice },
              },
              currentMarket: {
                ...prev?.currentMarket,
                slug: data.market,
                inTradingWindow: data.inTrading,
                timeLeft: data.timeLeft,
              },
              bot: {
                ...prev?.bot,
                enabled: data.wsConnected,
              },
            }));
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 1s...');
        setIsConnected(false);
        reconnectTimeout.current = setTimeout(connectWS, 1000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        ws.close();
      };
    } catch (e) {
      console.error('[WS] Connection error:', e);
      reconnectTimeout.current = setTimeout(connectWS, 1000);
    }
  }, []);

  // Also poll for full status and logs (less frequently)
  const poll = useCallback(async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        getStatus(),
        getLogs(100),
      ]);
      if (statusRes.success) {
        setStatus((prev: any) => ({ ...statusRes.data, ...prev }));
        setIsConnected(true);
      }
      if (logsRes.success && logsRes.data) {
        setLogs(logsRes.data);
      }
    } catch (err) {
      // WebSocket handles connection status
    }
  }, []);

  useEffect(() => {
    // Connect WebSocket immediately
    connectWS();
    
    // Initial HTTP poll for full status
    poll();
    
    // Poll every 2s for logs and full status
    const pollInterval = setInterval(poll, 2000);
    
    return () => {
      clearInterval(pollInterval);
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWS, poll]);

  return {
    isConnected,
    status,
    logs,
    lastTrade: null,
    lastCycle: null,
    sendCommand: () => {},
    clearLogs: () => setLogs([]),
    usePolling: false,
  };
}
// Cache bust: 1766768789
