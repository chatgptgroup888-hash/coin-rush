import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => logger.error('Postgres pool error', { err: err.message }));

/** Run a set of queries inside a single transaction. Rolls back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

/** Minimal migration runner: applies every *.sql file in /migrations once, in order. */
export async function runMigrations(): Promise<void> {
  const dir = path.resolve(__dirname, '../../migrations');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rowCount) continue;

    const sql = await readFile(path.join(dir, file), 'utf8');
    await withTransaction(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    logger.info('Migration applied', { file });
  }
}
