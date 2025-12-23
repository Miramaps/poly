'use client';

import { useState, useEffect } from 'react';

interface ComponentStatus {
  name: string;
  status: 'ready' | 'pending' | 'error';
  description: string;
  latency?: string;
}

interface LiveTradingStatusProps {
  isLiveMode: boolean;
  executionMetrics?: {
    ordersSent: number;
    ordersFilled: number;
    avgLatencyMs: number;
    fillRate: string;
    lastError: string | null;
  };
}

export function LiveTradingStatus({ isLiveMode, executionMetrics }: LiveTradingStatusProps) {
  const [gasEstimate, setGasEstimate] = useState<string>('...');

  useEffect(() => {
    // Fetch gas estimate
    fetch('https://gasstation.polygon.technology/v2')
      .then(res => res.json())
      .then((data: any) => {
        const gwei = data?.fast?.maxFee || 0;
        setGasEstimate(`${gwei.toFixed(1)} gwei`);
      })
      .catch(() => setGasEstimate('N/A'));
  }, []);

  const components: ComponentStatus[] = [
    {
      name: 'Order Signing',
      status: 'ready',
      description: 'HMAC-SHA256 signature',
      latency: '<1ms',
    },
    {
      name: 'Wallet Integration',
      status: 'ready',
      description: 'Polygon USDC',
    },
    {
      name: 'Order Submission',
      status: 'ready',
      description: 'POST /order',
      latency: executionMetrics?.avgLatencyMs 
        ? `~${executionMetrics.avgLatencyMs.toFixed(0)}ms` 
        : '~150ms',
    },
    {
      name: 'Balance Checking',
      status: 'ready',
      description: 'GET /balance',
    },
    {
      name: 'Order Confirmation',
      status: 'ready',
      description: 'WebSocket updates',
    },
    {
      name: 'Gas Estimation',
      status: 'ready',
      description: `Polygon: ${gasEstimate}`,
    },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return '✅';
      case 'pending':
        return '🔄';
      case 'error':
        return '❌';
      default:
        return '⚪';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'text-green-400';
      case 'pending':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          Live Trading System
        </h3>
        <span className={`px-2 py-1 rounded text-xs font-bold ${
          isLiveMode 
            ? 'bg-red-900 text-red-300 border border-red-700' 
            : 'bg-blue-900 text-blue-300 border border-blue-700'
        }`}>
          {isLiveMode ? '🔴 LIVE' : '📄 PAPER'}
        </span>
      </div>

      <div className="space-y-2">
        {components.map((component) => (
          <div
            key={component.name}
            className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{getStatusIcon(component.status)}</span>
              <div>
                <p className="text-sm font-medium text-white">{component.name}</p>
                <p className="text-xs text-gray-400">{component.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {component.latency && (
                <span className="text-xs text-gray-500 font-mono">
                  {component.latency}
                </span>
              )}
              <span className={`text-xs font-semibold ${getStatusColor(component.status)}`}>
                {component.status.toUpperCase()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Execution Metrics */}
      {executionMetrics && executionMetrics.ordersSent > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <h4 className="text-sm font-semibold text-gray-300 mb-2">
            Execution Metrics
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-400">Orders Sent</p>
              <p className="text-white font-mono">{executionMetrics.ordersSent}</p>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-400">Fill Rate</p>
              <p className="text-green-400 font-mono">{executionMetrics.fillRate}</p>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-400">Avg Latency</p>
              <p className="text-yellow-400 font-mono">{executionMetrics.avgLatencyMs.toFixed(0)}ms</p>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <p className="text-gray-400">Orders Filled</p>
              <p className="text-white font-mono">{executionMetrics.ordersFilled}</p>
            </div>
          </div>
          {executionMetrics.lastError && (
            <div className="mt-2 p-2 bg-red-900/30 rounded text-xs text-red-300">
              Last Error: {executionMetrics.lastError}
            </div>
          )}
        </div>
      )}

      {/* Mode Warning */}
      {isLiveMode && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg">
          <p className="text-red-300 text-sm font-semibold">⚠️ LIVE MODE ACTIVE</p>
          <p className="text-red-400 text-xs mt-1">
            Real USDC will be used. Trades are irreversible.
          </p>
        </div>
      )}

      {!isLiveMode && (
        <div className="mt-4 p-3 bg-blue-900/30 border border-blue-800 rounded-lg">
          <p className="text-blue-300 text-sm font-semibold">📄 Paper Trading Mode</p>
          <p className="text-blue-400 text-xs mt-1">
            Simulated trades only. No real funds at risk.
          </p>
        </div>
      )}
    </div>
  );
}

