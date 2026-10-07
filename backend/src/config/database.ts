import { Pool } from 'pg';
import { env } from './env';

const isRemoteDb =
  env.DATABASE_URL.includes('supabase') ||
  env.DATABASE_URL.includes('pooler') ||
  env.DATABASE_URL.includes('sslmode=require');

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined,
});

db.on('connect', () => {
  if (env.NODE_ENV === 'development') {
    console.log('[db] pool connected');
  }
});

