import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { logger } from '../lib/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// SQL files live in src/db/migrations and are copied next to the compiled output.
const MIGRATIONS_DIR = path.join(here, 'migrations');

/**
 * Minimal forward-only migrator. Each file runs once inside a transaction and is
 * recorded in schema_migrations. An advisory lock keeps concurrent replicas safe.
 */
export async function migrate(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(727274)');
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      logger.info({ migration: file }, 'Applied migration');
    }
  });
}
