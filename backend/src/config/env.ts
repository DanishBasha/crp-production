import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-min-32-chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/comm_readiness'),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().default(5),
  UPLOAD_DIR: z.string().default('uploads'),
  // Shared secret for internal calls to the Python AI service
  AI_INTERNAL_KEY: z.string().default('change-me'),
  MAX_QUESTIONS_PER_SESSION: z.coerce.number().default(10),
  MAX_TAB_SWITCH_LIMIT: z.coerce.number().default(4),
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
  DEEPGRAM_API_KEY: z.string().optional().default(''),
  EMAIL_PROVIDER: z.enum(['gmail', 'smtp', 'resend', 'console']).default('gmail'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_FROM: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM_EMAIL: z.string().default('noreply@crp.local'),
  APP_NAME: z.string().default('Communication Readiness Platform'),
  APP_URL: z.string().default('http://localhost:5173'),
});

export const env = schema.parse(process.env);
