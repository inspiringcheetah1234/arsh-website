// Database adapter.
// Production: any Postgres via DATABASE_URL (Neon, Supabase, RDS...).
// Local dev: embedded Postgres (PGlite) stored in .data/pglite — no install, same SQL.

import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let ready = null;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 5),
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
    return {
      kind: 'pg',
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
    };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set. Add a Postgres connection string in the Vercel project settings.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || join(ROOT, '.data', 'pglite');
  await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  // PGlite is single-connection: serialise transactions so they never interleave.
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  return {
    kind: 'pglite',
    query: (text, params) => serial(() => db.query(text, params)),
    exec: (text) => serial(() => db.exec(text)),
    transaction: (fn) => serial(() => db.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) }))),
  };
}

export function db() {
  if (!ready) {
    ready = (async () => {
      const conn = await connect();
      const schema = await readFile(join(ROOT, 'server', 'schema.sql'), 'utf8');
      await conn.exec(schema);
      return conn;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

export async function q(text, params = []) {
  return (await db()).query(text, params);
}
export async function one(text, params = []) {
  return (await q(text, params)).rows[0] ?? null;
}
export async function all(text, params = []) {
  return (await q(text, params)).rows;
}
export async function tx(fn) {
  return (await db()).transaction(fn);
}
