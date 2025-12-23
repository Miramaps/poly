import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const baseLogger = (pino as any)({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export function createLogger(name: string) {
  return baseLogger.child({ name });
}

// In-memory log buffer for streaming to dashboard
const LOG_BUFFER_SIZE = 1000;
const logBuffer: Array<{
  timestamp: Date;
  level: string;
  name: string;
  message: string;
  meta?: Record<string, unknown>;
}> = [];

const logListeners: Set<(entry: typeof logBuffer[0]) => void> = new Set();

export function addLogEntry(
  level: string,
  name: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const entry = {
    timestamp: new Date(),
    level,
    name,
    message,
    meta,
  };
  
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
  
  // Notify listeners
  for (const listener of logListeners) {
    listener(entry);
  }
}

export function getRecentLogs(limit = 100) {
  return logBuffer.slice(-limit);
}

export function subscribeToLogs(callback: (entry: typeof logBuffer[0]) => void) {
  logListeners.add(callback);
  return () => logListeners.delete(callback);
}

// Enhanced logger that also buffers
export function createBufferedLogger(name: string) {
  const logger = createLogger(name);
  
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      logger.info(meta || {}, msg);
      addLogEntry('info', name, msg, meta);
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      logger.warn(meta || {}, msg);
      addLogEntry('warn', name, msg, meta);
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      logger.error(meta || {}, msg);
      addLogEntry('error', name, msg, meta);
    },
    debug: (msg: string, meta?: Record<string, unknown>) => {
      logger.debug(meta || {}, msg);
      addLogEntry('debug', name, msg, meta);
    },
  };
}

