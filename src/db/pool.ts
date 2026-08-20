import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../logger.js';

// Money is stored as BIGINT cents. node-postgres returns bigint as string by
// default; we know these fit in a JS number, so parse them.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error('pg.pool.error', { error: err.message }));

export type Queryable = pg.PoolClient | pg.Pool;

/** Every state change that touches money runs inside one of these. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
