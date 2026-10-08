import { Pool } from 'pg';
import { env } from './env';

const isRemoteDb =
  env.DATABASE_URL.includes('supabase') ||
  env.DATABASE_URL.includes('pooler') ||
  env.DATABASE_URL.includes('sslmode=require');

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined,
});

db.on('connect', () => {
  if (env.NODE_ENV === 'development') {
    console.log('[db] pool connected');
  }
});

db.on('error', (err) => {
  console.error('[db] Unexpected background client error on pool:', err);
});

