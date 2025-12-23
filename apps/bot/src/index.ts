import 'dotenv/config';
import { createServer } from './api/server.js';
import { TradingEngine } from './core/engine.js';
import { Database } from './services/database.js';
import { MarketDiscovery } from './services/marketDiscovery.js';
import { WebSocketManager } from './services/websocket.js';
import { hasCredentials } from './services/polymarketClient.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

async function main() {
  logger.info('Starting Poly Trader Bot...');
  logger.info(`Mode: PAPER TRADING${hasCredentials() ? ' (API credentials loaded for future live trading)' : ''}`);

  // Initialize database
  const db = new Database();
  await db.connect();
  logger.info('Database connected');

  // Initialize WebSocket manager for Polymarket
  const wsManager = new WebSocketManager();

  // Initialize market discovery
  const marketDiscovery = new MarketDiscovery(db);

  // Initialize trading engine
  const engine = new TradingEngine(db, wsManager, marketDiscovery);
  await engine.initialize();
  logger.info('Trading engine initialized');

  // Create and start API server
  const server = await createServer(engine, db);
  const port = parseInt(process.env.BOT_PORT || '3001', 10);
  
  await server.listen({ port, host: '0.0.0.0' });
  logger.info(`API server listening on port ${port}`);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await engine.stop();
    await server.close();
    await db.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start engine loop
  engine.start();
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});

