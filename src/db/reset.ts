/**
 * Drops every table this project owns, so `migrate` re-applies from scratch.
 *
 * Migrations are tracked by filename, so editing an applied migration is
 * invisible to the runner. During the skeleton phase the schema is still
 * moving, and one clean 001_init.sql reads better than a trail of patch
 * migrations — this is how you re-apply it.
 *
 * Destructive by design. It refuses to run outside development.
 */
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { pool } from './pool.js';

async function run(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('db:reset refuses to run with NODE_ENV=production.');
  }

  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  logger.info('db.reset', { database: new URL(env.DATABASE_URL).pathname.slice(1) });
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('db.reset.failed', { error: (err as Error).message });
    process.exit(1);
  });
