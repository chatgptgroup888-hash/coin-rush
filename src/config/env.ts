import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('15m'),        // access token อายุสั้น
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  TICK_RATE: z.coerce.number().int().min(1).max(60).default(20),
  MATCH_DURATION_SEC: z.coerce.number().int().min(10).default(60),
  PLAYERS_PER_MATCH: z.coerce.number().int().min(2).max(8).default(2),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
