import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Return BIGINT/NUMERIC as numbers. All money is stored as integer cents well within 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error({ err }, 'Unexpected idle Postgres client error'));

export type Queryable = Pick<pg.PoolClient, 'query'>;

/** Runs `fn` inside a transaction and rolls back on any thrown error. */
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
