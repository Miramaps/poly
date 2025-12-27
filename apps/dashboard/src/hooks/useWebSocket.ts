'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getStatus, getLogs } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://18.175.223.104:3002';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const wsConnected = useRef(false);

  // Only fetch initial status ONCE (for currentCycle etc that WS doesn't have)
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await getStatus();
        if (res.success && res.data) {
          setStatus(res.data);
        }
      } catch (err) {
        console.error('[STATUS] Initial fetch failed:', err);
      }
    };
    fetchInitial();
  }, []);

  // WebSocket for ALL real-time updates - NO HTTP POLLING!
  useEffect(() => {
    const connect = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[WS] Connected - REAL-TIME MODE');
          setIsConnected(true);
          wsConnected.current = true;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[WS MSG]', data.type, data.orderbooks?.UP?.asks?.length || 0, 'asks');
            
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

        ws.onerror = () => {
          setIsConnected(false);
          wsConnected.current = false;
        };
        
        ws.onclose = () => {
          setIsConnected(false);
          wsConnected.current = false;
          reconnectTimeout.current = setTimeout(connect, 500); // Fast reconnect
        };
      } catch (err) {
        reconnectTimeout.current = setTimeout(connect, 500);
      }
    };

    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  // Logs polling only (low priority, every 2s)
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
