'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getWallet, getPrivateKey, setTradingMode } from '@/lib/api';

interface WalletDropdownProps {
  tradingMode: 'PAPER' | 'LIVE';
  onTradingModeChange: (mode: 'PAPER' | 'LIVE') => void;
}

export function WalletDropdown({ tradingMode, onTradingModeChange }: WalletDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [paperBalance] = useState({ usdc: 1000.00 });
  const [liveWallet, setLiveWallet] = useState<{
    hasWallet: boolean;
    address: string | null;
    balance: { usdc: number; pol: number };
  } | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModeConfirm, setShowModeConfirm] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowModeConfirm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchWallet = async () => {
    try {
      setLoading(true);
      const response = await getWallet();
      if (response.success) {
        setLiveWallet({
          hasWallet: response.data.hasWallet,
          address: response.data.address,
          balance: {
            usdc: response.data.balance.usdc,
            pol: response.data.balance.matic || 0
          }
        });
      }
    } catch (err) {
      setLiveWallet({ hasWallet: false, address: null, balance: { usdc: 0, pol: 0 } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallet();
    const interval = setInterval(fetchWallet, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleRevealPrivateKey = async () => {
    if (privateKey) {
      setShowPrivateKey(!showPrivateKey);
      return;
    }
    try {
      const response = await getPrivateKey();
      if (response.success && response.data) {
        setPrivateKey(response.data.privateKey);
        setShowPrivateKey(true);
      }
    } catch {
      setError('Failed to get private key');
    }
  };

  const handleModeSwitch = async () => {
    const newMode = tradingMode === 'PAPER' ? 'LIVE' : 'PAPER';
    try {
      const response = await setTradingMode(newMode);
      if (response.success) {
        onTradingModeChange(newMode);
      } else {
        setError(response.error || 'Failed to switch');
      }
    } catch {
      setError('Failed to switch mode');
    }
    setShowModeConfirm(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const currentBalance = tradingMode === 'PAPER' 
    ? paperBalance.usdc 
    : (liveWallet?.balance.usdc || 0);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
          tradingMode === 'LIVE'
            ? 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/20'
            : 'bg-card border-border text-muted hover:text-white hover:bg-white/5'
        )}
      >
        <span className={cn(
          'w-2 h-2 rounded-full',
          tradingMode === 'LIVE' ? 'bg-danger animate-pulse' : 'bg-warning'
        )} />
        <span>{tradingMode}</span>
        <span className="text-muted">|</span>
        <span className="font-mono">${currentBalance.toFixed(2)}</span>
        <svg className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-lg shadow-card z-50">
          {/* Header */}
          <div className="p-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">
                  {tradingMode === 'LIVE' ? 'Live Trading' : 'Paper Trading'}
                </span>
                <p className="text-xs text-muted">
                  {tradingMode === 'LIVE' ? 'Real funds on Polygon' : 'Simulated'}
                </p>
              </div>
              <button
                onClick={() => setShowModeConfirm(true)}
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium border transition-colors',
                  tradingMode === 'PAPER'
                    ? 'border-danger/30 text-danger hover:bg-danger/10'
                    : 'border-border text-muted hover:text-white hover:bg-white/5'
                )}
              >
                Switch to {tradingMode === 'PAPER' ? 'LIVE' : 'PAPER'}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-3 mt-3 p-2 bg-danger/10 border border-danger/30 rounded text-danger text-xs">
              {error}
            </div>
          )}

          {/* Content */}
          <div className="p-3 space-y-3">
            {/* Paper Balance */}
            <div className={cn(
              'p-3 rounded-lg border',
              tradingMode === 'PAPER' ? 'bg-white/5 border-border' : 'border-border/50 opacity-50'
            )}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted uppercase tracking-wide">Paper Balance</span>
                {tradingMode === 'PAPER' && (
                  <span className="text-[10px] text-accent font-medium">ACTIVE</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">USDC</span>
                <span className="font-mono text-lg font-semibold">${paperBalance.usdc.toFixed(2)}</span>
              </div>
            </div>

            {/* Live Balance */}
            <div className={cn(
              'p-3 rounded-lg border',
              tradingMode === 'LIVE' ? 'bg-white/5 border-border' : 'border-border/50 opacity-50'
            )}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted uppercase tracking-wide">Live Wallet</span>
                {tradingMode === 'LIVE' && (
                  <span className="text-[10px] text-danger font-medium">LIVE</span>
                )}
              </div>

              {loading && !liveWallet ? (
                <p className="text-sm text-muted">Loading...</p>
              ) : liveWallet?.hasWallet ? (
                <div className="space-y-2">
                  {/* Address */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Address</span>
                    <button
                      onClick={() => liveWallet.address && copyToClipboard(liveWallet.address)}
                      className="font-mono text-xs text-muted hover:text-white truncate max-w-[180px]"
                    >
                      {liveWallet.address}
                    </button>
                  </div>
                  {/* Balances */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
                    <div>
                      <span className="text-xs text-muted block">USDC</span>
                      <span className="font-mono text-sm font-medium">${liveWallet.balance.usdc.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">POL</span>
                      <span className="font-mono text-sm font-medium">{liveWallet.balance.pol.toFixed(4)}</span>
                    </div>
                  </div>
                  {/* Private Key */}
                  <button
                    onClick={handleRevealPrivateKey}
                    className="w-full pt-2 border-t border-border/50 text-left"
                  >
                    <span className="text-xs text-muted">Private Key</span>
                    {showPrivateKey && privateKey ? (
                      <p className="font-mono text-[10px] text-danger break-all mt-1">{privateKey}</p>
                    ) : (
                      <p className="font-mono text-xs text-muted mt-1">Click to reveal</p>
                    )}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted">No wallet configured</p>
              )}
            </div>

            {/* Mode Switch Confirm */}
            {showModeConfirm && (
              <div className={cn(
                'p-3 rounded-lg border',
                tradingMode === 'PAPER' ? 'border-danger/30 bg-danger/5' : 'border-border'
              )}>
                {tradingMode === 'PAPER' ? (
                  <div className="text-xs text-danger space-y-1 mb-3">
                    <p className="font-medium">Enable LIVE trading?</p>
                    <p>• Real money will be used</p>
                    <p>• You are responsible for losses</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted mb-3">Switch to paper trading?</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowModeConfirm(false)}
                    className="flex-1 py-1.5 text-xs border border-border rounded hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleModeSwitch}
                    className={cn(
                      'flex-1 py-1.5 text-xs rounded font-medium',
                      tradingMode === 'PAPER'
                        ? 'bg-danger text-white'
                        : 'bg-white text-black'
                    )}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-muted">
            <span>Polygon Network</span>
            <button onClick={fetchWallet} className="hover:text-white">
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
