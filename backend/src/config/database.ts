import { Pool, PoolClient } from 'pg';
import { config } from './index';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isCloudDb = config.DATABASE_URL.includes('sslmode=require') ||
      config.DATABASE_URL.includes('neon.tech') ||
      config.DATABASE_URL.includes('render.com') ||
      config.DATABASE_URL.includes('supabase') ||
      config.DATABASE_URL.includes('cockroach');

    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: isProduction || isCloudDb ? { rejectUnauthorized: false } : undefined,
    });

    pool.on('connect', () => {
      console.log('✅ PostgreSQL pool connected');
    });

    pool.on('error', (err: Error) => {
      console.error('❌ PostgreSQL pool error:', err.message);
    });
  }

  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
