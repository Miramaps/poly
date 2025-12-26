'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getStatus } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
const POLL_INTERVAL = 2000; // Poll every 2 seconds when WebSocket fails

interface WSMessage {
  type: string;
  payload: any;
  timestamp: number;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [lastTrade, setLastTrade] = useState<any>(null);
  const [lastCycle, setLastCycle] = useState<any>(null);
  const [usePolling, setUsePolling] = useState(false);

  // HTTP Polling fallback
  const pollStatus = useCallback(async () => {
    try {
      const response = await getStatus();
      if (response.success) {
        setStatus(response.data);
        setIsConnected(true);
      }
    } catch (err) {
      console.error('Poll error:', err);
      setIsConnected(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    console.log('Starting HTTP polling fallback...');
    setUsePolling(true);
    pollStatus(); // Immediate first poll
    pollRef.current = setInterval(pollStatus, POLL_INTERVAL);
  }, [pollStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setUsePolling(false);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/ws`);
    let wsTimeout: NodeJS.Timeout;

    // If WebSocket doesn't connect in 3 seconds, fall back to polling
    wsTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket timeout, falling back to HTTP polling');
        ws.close();
        startPolling();
      }
    }, 3000);

    ws.onopen = () => {
      console.log('WebSocket connected');
      clearTimeout(wsTimeout);
      stopPolling();
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        
        switch (message.type) {
          case 'status:update':
            setStatus(message.payload);
            break;
          case 'log:entry':
            setLogs((prev) => [...prev.slice(-199), message.payload]);
            break;
          case 'trade:executed':
            setLastTrade(message.payload);
            break;
          case 'cycle:updated':
            setLastCycle(message.payload);
            break;
        }
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      clearTimeout(wsTimeout);
      setIsConnected(false);
      // Fall back to polling
      startPolling();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      clearTimeout(wsTimeout);
      setIsConnected(false);
      // Fall back to polling
      startPolling();
    };

    wsRef.current = ws;
  }, [startPolling, stopPolling]);

  const sendCommand = useCallback((command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'command', command }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      stopPolling();
    };
  }, [connect, stopPolling]);

  return {
    isConnected,
    status,
    logs,
    lastTrade,
    lastCycle,
    sendCommand,
    clearLogs: () => setLogs([]),
    usePolling,
  };
}
