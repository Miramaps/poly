import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyBasicAuth from '@fastify/basic-auth';
import { TradingEngine } from '../core/engine.js';
import { Database } from '../services/database.js';
import { WalletService } from '../services/wallet.js';
import { CommandHandler } from './commandHandler.js';
import { subscribeToLogs, getRecentLogs, createBufferedLogger } from '../utils/logger.js';
import { WS_EVENTS } from '@poly-trader/shared';
import type { WebSocket } from 'ws';

const walletLogger = createBufferedLogger('wallet-api');

const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || 'polytrader';

export async function createServer(engine: TradingEngine, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'production',
  });

  // CORS
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // Basic auth
  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== DASH_USER || password !== DASH_PASS) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'Poly Trader' },
  });

  // WebSocket support
  await app.register(fastifyWebsocket);

  // Command handler
  const commandHandler = new CommandHandler(engine, db);

  // Wallet service
  const walletService = new WalletService();
  
  // Initialize wallet from database
  const existingWallet = await db.getActiveWallet();
  if (existingWallet) {
    await walletService.initialize({
      address: existingWallet.address,
      encryptedPrivateKey: existingWallet.encryptedPrivateKey,
      iv: existingWallet.iv,
      createdAt: existingWallet.createdAt,
      isActive: existingWallet.isActive,
    });
  }

  // Track WebSocket clients
  const wsClients = new Set<WebSocket>();

  // Broadcast to all connected clients
  const broadcast = (type: string, payload: unknown) => {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    for (const client of wsClients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
  };

  // Subscribe to engine events
  engine.on('trade', (trade) => broadcast(WS_EVENTS.TRADE_EXECUTED, trade));
  engine.on('leg1', (data) => broadcast(WS_EVENTS.CYCLE_UPDATED, data));
  engine.on('leg2', (data) => broadcast(WS_EVENTS.CYCLE_UPDATED, data));
  engine.on('cycleComplete', (cycle) => broadcast(WS_EVENTS.CYCLE_UPDATED, cycle));
  engine.on('orderbook', (data) => broadcast(WS_EVENTS.ORDERBOOK_UPDATE, data));

  // Subscribe to logs
  subscribeToLogs((entry) => broadcast(WS_EVENTS.LOG_ENTRY, entry));

  // Periodic status updates
  setInterval(() => {
    broadcast(WS_EVENTS.STATUS_UPDATE, engine.getStatus());
  }, 1000);

  // ─── Routes ─────────────────────────────────────────────────────────────────

  // Health check (no auth)
  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // GET /api/status (with auth)
  app.get('/api/status', { preHandler: app.basicAuth }, async () => {
    return {
      success: true,
      data: engine.getStatus(),
    };
  });

  // POST /api/command (with auth)
  app.post<{ Body: { command: string } }>('/api/command', { preHandler: app.basicAuth }, async (request) => {
    const { command } = request.body;
    
    if (!command || typeof command !== 'string') {
      return { success: false, error: 'Invalid command' };
    }

    const result = await commandHandler.execute(command);
    
    // Broadcast command response
    broadcast(WS_EVENTS.COMMAND_RESPONSE, { command, result });

    return result;
  });

  // GET /api/cycles (with auth)
  app.get<{ Querystring: { limit?: string } }>('/api/cycles', { preHandler: app.basicAuth }, async (request) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const cycles = await db.getCycles(limit);
    return { success: true, data: cycles };
  });

  // GET /api/trades (with auth)
  app.get<{ Querystring: { limit?: string } }>('/api/trades', { preHandler: app.basicAuth }, async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    const trades = await db.getTrades(limit);
    return { success: true, data: trades };
  });

  // GET /api/equity (with auth)
  app.get<{ Querystring: { limit?: string } }>('/api/equity', { preHandler: app.basicAuth }, async (request) => {
    const limit = parseInt(request.query.limit || '1000', 10);
    const snapshots = await db.getEquityHistory(limit);
    return { success: true, data: snapshots };
  });

  // GET /api/logs (with auth)
  app.get<{ Querystring: { limit?: string } }>('/api/logs', { preHandler: app.basicAuth }, async (request) => {
    const limit = parseInt(request.query.limit || '100', 10);
    const logs = getRecentLogs(limit);
    return { success: true, data: logs };
  });

  // GET /api/config (with auth)
  app.get('/api/config', { preHandler: app.basicAuth }, async () => {
    return { success: true, data: engine.getConfig() };
  });

  // ─── Wallet API ───────────────────────────────────────────────────────────────

  // GET /api/wallet - Get wallet status
  app.get('/api/wallet', { preHandler: app.basicAuth }, async () => {
    const address = walletService.getAddress();
    if (!address) {
      return { 
        success: true, 
        data: { 
          hasWallet: false,
          address: null,
          balance: { usdc: 0, matic: 0 },
          canGenerateNew: true,
        } 
      };
    }

    const balance = await walletService.getBalance();
    const canGenerateNew = await walletService.canGenerateNew();

    return {
      success: true,
      data: {
        hasWallet: true,
        address,
        balance,
        canGenerateNew,
      },
    };
  });

  // GET /api/wallet/private-key - Get private key (sensitive!)
  app.get('/api/wallet/private-key', { preHandler: app.basicAuth }, async () => {
    const privateKey = walletService.getPrivateKey();
    if (!privateKey) {
      return { success: false, error: 'No wallet found' };
    }

    walletLogger.warn('Private key accessed via API');
    return { success: true, data: { privateKey } };
  });

  // POST /api/wallet/generate - Generate new wallet
  app.post<{ Body: { confirm?: boolean; force?: boolean } }>(
    '/api/wallet/generate',
    { preHandler: app.basicAuth },
    async (request) => {
      const { confirm, force } = request.body || {};

      if (!confirm) {
        return {
          success: false,
          error: 'Please confirm wallet generation by setting confirm=true',
          requiresConfirmation: true,
        };
      }

      try {
        // Check if current wallet has balance
        if (!force) {
          const canGenerate = await walletService.canGenerateNew();
          if (!canGenerate) {
            const balance = await walletService.getBalance();
            return {
              success: false,
              error: `Cannot generate new wallet: current wallet has balance (${balance.usdc.toFixed(2)} USDC, ${balance.matic.toFixed(4)} MATIC). Withdraw funds first.`,
              hasBalance: true,
              balance,
            };
          }
        }

        const newWallet = await walletService.generateNewWallet(force);
        
        // Save to database
        await db.saveWallet({
          address: newWallet.address,
          encryptedPrivateKey: newWallet.encryptedPrivateKey,
          iv: newWallet.iv,
        });

        walletLogger.info('New wallet generated', { address: newWallet.address });

        return {
          success: true,
          data: {
            address: newWallet.address,
            message: 'New wallet generated successfully. Fund this address to start live trading.',
          },
        };
      } catch (err) {
        walletLogger.error('Wallet generation failed', { error: (err as Error).message });
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // POST /api/wallet/withdraw - Withdraw USDC
  app.post<{ Body: { toAddress: string; amount: number } }>(
    '/api/wallet/withdraw',
    { preHandler: app.basicAuth },
    async (request) => {
      const { toAddress, amount } = request.body || {};

      if (!toAddress || !amount || amount <= 0) {
        return { success: false, error: 'Invalid destination address or amount' };
      }

      try {
        const txHash = await walletService.withdrawUSDC(toAddress, amount);
        walletLogger.info('Withdrawal successful', { txHash, amount, toAddress });

        return {
          success: true,
          data: {
            txHash,
            amount,
            toAddress,
            message: `Successfully withdrew ${amount} USDC`,
          },
        };
      } catch (err) {
        walletLogger.error('Withdrawal failed', { error: (err as Error).message });
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // ─── Trading Mode API ─────────────────────────────────────────────────────────

  // POST /api/trading-mode - Switch trading mode (PAPER/LIVE)
  app.post<{ Body: { mode: 'PAPER' | 'LIVE' } }>(
    '/api/trading-mode',
    { preHandler: app.basicAuth },
    async (request) => {
      const { mode } = request.body || {};

      if (mode !== 'PAPER' && mode !== 'LIVE') {
        return { success: false, error: 'Invalid mode. Use PAPER or LIVE.' };
      }

      // Check requirements for live mode
      if (mode === 'LIVE') {
        const address = walletService.getAddress();
        if (!address) {
          return {
            success: false,
            error: 'Cannot switch to LIVE mode: No wallet configured. Generate a wallet first.',
          };
        }

        const balance = await walletService.getBalance();
        if (balance.usdc < 1) {
          return {
            success: false,
            error: `Cannot switch to LIVE mode: Insufficient USDC balance (${balance.usdc.toFixed(2)}). Minimum 1 USDC required.`,
          };
        }

        // Check for API credentials
        const hasCredentials = !!(
          process.env.POLYMARKET_API_KEY &&
          process.env.POLYMARKET_SECRET &&
          process.env.POLYMARKET_PASSPHRASE
        );

        if (!hasCredentials) {
          return {
            success: false,
            error: 'Cannot switch to LIVE mode: Missing Polymarket API credentials. Set POLYMARKET_API_KEY, POLYMARKET_SECRET, and POLYMARKET_PASSPHRASE environment variables.',
          };
        }
      }

      await engine.setTradingMode(mode);
      walletLogger.info(`Trading mode switched to ${mode}`);

      return {
        success: true,
        data: {
          mode,
          message: `Trading mode switched to ${mode}`,
        },
      };
    }
  );

  // WebSocket endpoint
  app.get('/ws', { websocket: true }, (connection) => {
    const ws = connection.socket;
    wsClients.add(ws);

    // Send initial status
    ws.send(JSON.stringify({
      type: WS_EVENTS.STATUS_UPDATE,
      payload: engine.getStatus(),
      timestamp: Date.now(),
    }));

    // Send recent logs
    const recentLogs = getRecentLogs(50);
    for (const log of recentLogs) {
      ws.send(JSON.stringify({
        type: WS_EVENTS.LOG_ENTRY,
        payload: log,
        timestamp: Date.now(),
      }));
    }

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'command' && message.command) {
          const result = await commandHandler.execute(message.command);
          ws.send(JSON.stringify({
            type: WS_EVENTS.COMMAND_RESPONSE,
            payload: { command: message.command, result },
            timestamp: Date.now(),
          }));
        }
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: (err as Error).message },
          timestamp: Date.now(),
        }));
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
    });
  });

  return app;
}

