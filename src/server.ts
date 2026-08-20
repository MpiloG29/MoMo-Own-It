import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { createApp } from './http/app.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler/index.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info('server.listening', { port: env.PORT, momoProvider: env.MOMO_PROVIDER });
});

const stopScheduler = startScheduler();

async function shutdown(signal: string): Promise<void> {
  logger.info('server.shutdown', { signal });
  stopScheduler();
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
