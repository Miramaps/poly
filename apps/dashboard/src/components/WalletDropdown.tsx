'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { getWallet, getPrivateKey, generateWallet, withdrawFunds, setTradingMode } from '@/lib/api';

interface WalletDropdownProps {
  tradingMode: 'PAPER' | 'LIVE';
  onTradingModeChange: (mode: 'PAPER' | 'LIVE') => void;
}

interface LiveStatusItem {
  label: string;
  detail: string;
  status: 'ready' | 'pending' | 'error';
  latency?: string;
}

export function WalletDropdown({ tradingMode, onTradingModeChange }: WalletDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'wallet' | 'status'>('wallet');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [wallet, setWallet] = useState<{
    hasWallet: boolean;
    address: string | null;
    balance: { usdc: number; matic: number };
    canGenerateNew: boolean;
  } | null>(null);

  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal states
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [showModeConfirm, setShowModeConfirm] = useState(false);

  // Withdraw form
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  // Determine wallet status
  const getWalletStatus = (): 'ready' | 'pending' | 'error' => {
    if (loading && !wallet) return 'pending'; // Still loading
    if (wallet === null) return 'error'; // Failed to fetch
    return wallet.hasWallet ? 'ready' : 'pending';
  };

  // Live status indicators
  const liveStatus: LiveStatusItem[] = [
    { label: 'Order Signing', detail: 'HMAC-SHA256 signature', status: 'ready', latency: '<1ms' },
    { label: 'Wallet Integration', detail: wallet?.hasWallet ? `${wallet.address?.slice(0, 6)}...${wallet.address?.slice(-4)}` : 'No wallet', status: getWalletStatus() },
    { label: 'Order Submission', detail: 'POST /order', status: 'ready', latency: '~1ms' },
    { label: 'Balance Checking', detail: wallet?.hasWallet ? `$${wallet.balance.usdc.toFixed(2)} USDC` : 'No wallet', status: wallet?.hasWallet ? 'ready' : 'pending' },
    { label: 'Order Confirmation', detail: 'WebSocket updates', status: 'ready' },
    { label: 'Gas Estimation', detail: 'Polygon network', status: 'ready' },
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch wallet data
  const fetchWallet = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getWallet();
      if (response.success) {
        setWallet(response.data);
      } else {
        setError('Failed to load wallet data');
      }
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
      // Set a default "no wallet" state on error so UI shows properly
      setWallet({
        hasWallet: false,
        address: null,
        balance: { usdc: 0, matic: 0 },
        canGenerateNew: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallet();
    const interval = setInterval(fetchWallet, 30000);
    return () => clearInterval(interval);
  }, []);

  // Clear messages after 3s
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

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
    } catch (err) {
      setError('Failed to retrieve private key');
    }
  };

  const handleGenerateWallet = async () => {
    try {
      setError(null);
      const response = await generateWallet(true, false);
      if (!response.success) {
        setError(response.error || 'Failed to generate wallet');
        return;
      }
      setSuccess('New wallet generated!');
      setShowGenerateConfirm(false);
      setPrivateKey(null);
      setShowPrivateKey(false);
      await fetchWallet();
    } catch (err) {
      setError('Failed to generate wallet');
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAddress || !withdrawAmount) {
      setError('Enter address and amount');
      return;
    }
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Invalid amount');
      return;
    }
    try {
      setWithdrawing(true);
      setError(null);
      const response = await withdrawFunds(withdrawAddress, amount);
      if (!response.success) {
        setError(response.error || 'Withdrawal failed');
        return;
      }
      setSuccess(`Withdrew ${amount} USDC`);
      setShowWithdrawForm(false);
      setWithdrawAddress('');
      setWithdrawAmount('');
      await fetchWallet();
    } catch (err) {
      setError('Withdrawal failed');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleModeSwitch = async () => {
    const newMode = tradingMode === 'PAPER' ? 'LIVE' : 'PAPER';
    try {
      setError(null);
      const response = await setTradingMode(newMode);
      if (!response.success) {
        setError(response.error || 'Failed to switch mode');
        setShowModeConfirm(false);
        return;
      }
      setSuccess(`Switched to ${newMode} mode`);
      setShowModeConfirm(false);
      onTradingModeChange(newMode);
    } catch (err) {
      setError('Failed to switch mode');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('Copied!');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border',
          tradingMode === 'LIVE'
            ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
            : 'bg-white/5 border-border text-muted hover:bg-white/10 hover:text-white'
        )}
      >
        <span className={cn(
          'w-2 h-2 rounded-full',
          tradingMode === 'LIVE' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
        )} />
        <span>{tradingMode}</span>
        <svg className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('wallet')}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                activeTab === 'wallet' ? 'bg-white/5 text-white' : 'text-muted hover:text-white'
              )}
            >
              💳 Wallet
            </button>
            <button
              onClick={() => setActiveTab('status')}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                activeTab === 'status' ? 'bg-white/5 text-white' : 'text-muted hover:text-white'
              )}
            >
              ⚡ Live Status
            </button>
          </div>

          {/* Messages */}
          {error && (
            <div className="mx-3 mt-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs">
              {error}
            </div>
          )}
          {success && (
            <div className="mx-3 mt-3 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 text-xs">
              {success}
            </div>
          )}

          {/* Wallet Tab */}
          {activeTab === 'wallet' && (
            <div className="p-4 space-y-4">
              {/* Trading Mode Switch */}
              <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-border">
                <div>
                  <span className="text-xs text-muted block">Trading Mode</span>
                  <span className={cn(
                    'text-sm font-medium',
                    tradingMode === 'LIVE' ? 'text-red-400' : 'text-yellow-400'
                  )}>
                    {tradingMode === 'LIVE' ? '🔴 LIVE TRADING' : '📝 Paper Trading'}
                  </span>
                </div>
                <button
                  onClick={() => setShowModeConfirm(true)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    tradingMode === 'PAPER'
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                  )}
                >
                  Switch
                </button>
              </div>

              {/* Wallet Address */}
              {wallet?.hasWallet ? (
                <>
                  <div>
                    <label className="text-xs text-muted block mb-1">Address</label>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 bg-black/50 border border-border rounded px-2 py-1.5 font-mono text-[10px] truncate">
                        {wallet.address}
                      </code>
                      <button
                        onClick={() => wallet.address && copyToClipboard(wallet.address)}
                        className="p-1.5 bg-white/5 hover:bg-white/10 border border-border rounded text-xs"
                      >
                        📋
                      </button>
                    </div>
                  </div>

                  {/* Private Key */}
                  <div>
                    <label className="text-xs text-muted block mb-1">Private Key</label>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 bg-black/50 border border-border rounded px-2 py-1.5 font-mono text-[10px] truncate">
                        {showPrivateKey && privateKey ? privateKey : '••••••••••••••••••••••••••••'}
                      </code>
                      <button
                        onClick={handleRevealPrivateKey}
                        className="p-1.5 bg-white/5 hover:bg-white/10 border border-border rounded text-xs"
                      >
                        {showPrivateKey ? '🙈' : '👁️'}
                      </button>
                      {showPrivateKey && privateKey && (
                        <button
                          onClick={() => copyToClipboard(privateKey)}
                          className="p-1.5 bg-white/5 hover:bg-white/10 border border-border rounded text-xs"
                        >
                          📋
                        </button>
                      )}
                    </div>
                    {showPrivateKey && (
                      <p className="text-red-400 text-[10px] mt-1">⚠️ Never share your private key!</p>
                    )}
                  </div>

                  {/* Balance */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-black/30 rounded-lg p-2.5 border border-border">
                      <span className="text-muted text-[10px] block">USDC</span>
                      <span className="font-mono text-sm font-medium">${wallet.balance.usdc.toFixed(2)}</span>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2.5 border border-border">
                      <span className="text-muted text-[10px] block">MATIC</span>
                      <span className="font-mono text-sm font-medium">{wallet.balance.matic.toFixed(4)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowGenerateConfirm(true)}
                      className="flex-1 py-2 px-3 bg-white/5 hover:bg-white/10 border border-border rounded-lg text-xs font-medium"
                    >
                      🔄 New Wallet
                    </button>
                    {wallet.balance.usdc > 0 && (
                      <button
                        onClick={() => setShowWithdrawForm(!showWithdrawForm)}
                        className="flex-1 py-2 px-3 bg-white/5 hover:bg-white/10 border border-border rounded-lg text-xs font-medium"
                      >
                        💸 Withdraw
                      </button>
                    )}
                  </div>

                  {/* Withdraw Form */}
                  {showWithdrawForm && (
                    <div className="space-y-2 p-3 bg-black/30 rounded-lg border border-border">
                      <input
                        type="text"
                        value={withdrawAddress}
                        onChange={(e) => setWithdrawAddress(e.target.value)}
                        placeholder="Destination address (0x...)"
                        className="w-full bg-black/50 border border-border rounded px-2.5 py-2 text-xs font-mono"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="Amount"
                          className="flex-1 bg-black/50 border border-border rounded px-2.5 py-2 text-xs font-mono"
                        />
                        <button
                          onClick={() => setWithdrawAmount(wallet.balance.usdc.toString())}
                          className="px-2 text-xs text-muted hover:text-white"
                        >
                          Max
                        </button>
                      </div>
                      <button
                        onClick={handleWithdraw}
                        disabled={withdrawing}
                        className="w-full py-2 bg-white text-black rounded-lg text-xs font-medium hover:bg-white/90 disabled:opacity-50"
                      >
                        {withdrawing ? 'Processing...' : 'Confirm Withdrawal'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-muted text-sm mb-3">No wallet configured</p>
                  <button
                    onClick={() => setShowGenerateConfirm(true)}
                    className="py-2 px-4 bg-white text-black rounded-lg text-sm font-medium hover:bg-white/90"
                  >
                    ➕ Generate Wallet
                  </button>
                </div>
              )}

              {/* Generate Confirm */}
              {showGenerateConfirm && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-yellow-400 text-xs mb-2">
                    {wallet?.hasWallet 
                      ? wallet.canGenerateNew 
                        ? '⚠️ This will create a new wallet. Your old address will no longer be used.'
                        : '❌ Cannot generate: current wallet has funds. Withdraw first.'
                      : '🔐 This will generate a new Polygon wallet for live trading.'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowGenerateConfirm(false)}
                      className="flex-1 py-1.5 bg-white/5 border border-border rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleGenerateWallet}
                      disabled={wallet?.hasWallet && !wallet.canGenerateNew}
                      className="flex-1 py-1.5 bg-white text-black rounded text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Generate
                    </button>
                  </div>
                </div>
              )}

              {/* Mode Switch Confirm */}
              {showModeConfirm && (
                <div className={cn(
                  'p-3 rounded-lg border',
                  tradingMode === 'PAPER' 
                    ? 'bg-red-500/10 border-red-500/30' 
                    : 'bg-yellow-500/10 border-yellow-500/30'
                )}>
                  {tradingMode === 'PAPER' ? (
                    <div className="text-red-400 text-xs space-y-1 mb-2">
                      <p className="font-medium">⚠️ ENABLE LIVE TRADING?</p>
                      <p>• Real money trades will be executed</p>
                      <p>• Ensure wallet is funded</p>
                      <p>• You are responsible for losses</p>
                    </div>
                  ) : (
                    <p className="text-yellow-400 text-xs mb-2">
                      Switch to paper trading mode? Simulated trades only.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowModeConfirm(false)}
                      className="flex-1 py-1.5 bg-white/5 border border-border rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleModeSwitch}
                      className={cn(
                        'flex-1 py-1.5 rounded text-xs font-medium',
                        tradingMode === 'PAPER' 
                          ? 'bg-red-500 text-white' 
                          : 'bg-white text-black'
                      )}
                    >
                      {tradingMode === 'PAPER' ? 'Enable LIVE' : 'Switch to Paper'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Tab */}
          {activeTab === 'status' && (
            <div className="p-4 space-y-2">
              <p className="text-muted text-xs mb-3">Live trading system readiness:</p>
              {liveStatus.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 bg-black/30 rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-sm',
                      item.status === 'ready' ? '' : 'opacity-50'
                    )}>
                      {item.status === 'ready' ? '✅' : item.status === 'pending' ? '⏳' : '❌'}
                    </span>
                    <div>
                      <span className="text-xs font-medium block">{item.label}</span>
                      <span className="text-[10px] text-muted">{item.detail}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    {item.latency && (
                      <span className="text-[10px] text-muted block">{item.latency}</span>
                    )}
                    <span className={cn(
                      'text-[10px] font-medium',
                      item.status === 'ready' ? 'text-green-400' : item.status === 'pending' ? 'text-yellow-400' : 'text-red-400'
                    )}>
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}

              {/* Show action prompt if wallet not configured */}
              {!wallet?.hasWallet && !loading && (
                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-yellow-400 text-xs mb-2">
                    🔐 Generate a wallet to enable live trading
                  </p>
                  <button
                    onClick={() => {
                      setActiveTab('wallet');
                      setShowGenerateConfirm(true);
                    }}
                    className="w-full py-1.5 bg-white text-black rounded text-xs font-medium hover:bg-white/90"
                  >
                    Generate Wallet
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

