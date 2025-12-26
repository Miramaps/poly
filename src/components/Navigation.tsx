'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { WalletDropdown } from './WalletDropdown';

const navItems = [
  { href: '/', label: 'Overview' },
  { href: '/cycles', label: 'Cycles' },
  { href: '/trades', label: 'Trades' },
  { href: '/terminal', label: 'Terminal' },
];

interface NavigationProps {
  isConnected?: boolean;
  botEnabled?: boolean;
  tradingMode?: 'PAPER' | 'LIVE';
  onTradingModeChange?: (mode: 'PAPER' | 'LIVE') => void;
}

export function Navigation({ isConnected, botEnabled, tradingMode = 'PAPER', onTradingModeChange }: NavigationProps) {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <span className="font-bold text-xl tracking-tight">POLYFCKKER666</span>
          </div>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-foreground/10 text-foreground'
                    : 'text-muted hover:text-foreground hover:bg-foreground/5'
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <div className="flex items-center gap-2 text-sm">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  isConnected ? 'bg-accent' : 'bg-danger'
                )}
              />
              <span className="text-muted">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {/* Bot Status */}
            <div className="flex items-center gap-2 text-sm">
              <div
                className={cn(
                  'w-2 h-2 rounded-full status-pulse',
                  botEnabled ? 'bg-accent' : 'bg-muted'
                )}
                style={{
                  '--pulse-color': botEnabled ? 'rgba(34, 197, 94, 0.5)' : 'rgba(115, 115, 115, 0.3)',
                } as React.CSSProperties}
              />
              <span className={botEnabled ? 'text-accent' : 'text-muted'}>
                {botEnabled ? 'BOT ON' : 'BOT OFF'}
              </span>
            </div>

            {/* Wallet & Trading Mode Dropdown */}
            <WalletDropdown 
              tradingMode={tradingMode}
              onTradingModeChange={onTradingModeChange || (() => {})}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

