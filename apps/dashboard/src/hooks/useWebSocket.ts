'use client';

import { useEffect, useState, useCallback } from 'react';
import { getStatus, getLogs } from '@/lib/api';

const POLL_INTERVAL = 500; // Poll every 500ms for near-instant updates

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [lastTrade, setLastTrade] = useState<any>(null);
  const [lastCycle, setLastCycle] = useState<any>(null);

  // HTTP Polling - no WebSocket needed
  const poll = useCallback(async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        getStatus(),
        getLogs(100),
      ]);
      if (statusRes.success) {
        setStatus(statusRes.data);
        setIsConnected(true);
      }
      if (logsRes.success && logsRes.data) {
        setLogs(logsRes.data);
      }
    } catch (err) {
      console.error('Poll error:', err);
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    // Initial poll
    poll();
    
    // Start polling interval
    const interval = setInterval(poll, POLL_INTERVAL);
    
    return () => clearInterval(interval);
  }, [poll]);

  return {
    isConnected,
    status,
    logs,
    lastTrade,
    lastCycle,
    sendCommand: () => {}, // Not used - commands go through API
    clearLogs: () => setLogs([]),
    usePolling: true,
  };
}
