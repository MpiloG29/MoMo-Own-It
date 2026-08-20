import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1),

  MOMO_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  MOMO_BASE_URL: z.string().url().default('https://sandbox.momodeveloper.mtn.com'),
  MOMO_TARGET_ENVIRONMENT: z.string().default('sandbox'),
  // The MoMo sandbox only settles EUR. Swap for a live target environment.
  MOMO_CURRENCY: z.string().default('EUR'),
  MOMO_CALLBACK_URL: z.string().url().optional(),

  MOMO_COLLECTION_SUBSCRIPTION_KEY: z.string().default(''),
  MOMO_COLLECTION_API_USER: z.string().default(''),
  MOMO_COLLECTION_API_KEY: z.string().default(''),

  MOMO_DISBURSEMENT_SUBSCRIPTION_KEY: z.string().default(''),
  MOMO_DISBURSEMENT_API_USER: z.string().default(''),
  MOMO_DISBURSEMENT_API_KEY: z.string().default(''),

  UNLOCK_HMAC_SECRET: z.string().min(16).default('dev-only-secret-replace-me'),
  UNLOCK_CODE_DIGITS: z.coerce.number().int().min(6).max(12).default(9),
  UNLOCK_DAYS_PER_PERIOD: z.coerce.number().int().positive().default(7),

  // 604800 in production. Drop to ~20 on stage so a 20-week plan fits inside a demo.
  BILLING_PERIOD_SECONDS: z.coerce.number().int().positive().default(604800),
  SCHEDULER_ENABLED: bool,
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(5000),
});

// dotenv turns an unfilled `KEY=` line into an empty string, not undefined, and
// Zod's .default() only ever substitutes for undefined. Without this, every
// optional field in .env.example — copied and left blank, exactly as the
// README's quick-start instructs — would fail validation instead of falling
// back to its default.
const withBlanksUnset = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

const parsed = schema.safeParse(withBlanksUnset);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;

if (env.MOMO_PROVIDER === 'live') {
  const required = [
    'MOMO_COLLECTION_SUBSCRIPTION_KEY',
    'MOMO_COLLECTION_API_USER',
    'MOMO_COLLECTION_API_KEY',
    'MOMO_DISBURSEMENT_SUBSCRIPTION_KEY',
    'MOMO_DISBURSEMENT_API_USER',
    'MOMO_DISBURSEMENT_API_KEY',
  ] as const;
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`MOMO_PROVIDER=live but missing: ${missing.join(', ')}`);
  }
}
