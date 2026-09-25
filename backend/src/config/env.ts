import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().default('postgres://refunddesk:refunddesk@localhost:5432/refunddesk'),
  AUTO_MIGRATE: bool.default(true),
  SEED_ON_BOOT: bool.default(true),
  // Adds a week of realistic background activity so the console is populated on first run.
  SEED_SAMPLE_ACTIVITY: bool.default(true),

  // Demo mode exposes the customer switcher and the reset endpoint. Never enable in production.
  DEMO_MODE: bool.default(true),

  JWT_SECRET: z.string().min(32).default('change-me-in-production-this-is-a-dev-only-secret'),
  ADMIN_PASSWORD: z.string().min(8).default('worknoon-admin'),
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:5173'),

  // "gemini" uses the model when GEMINI_API_KEY is set; "mock" forces offline mode.
  AI_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // Tried in order when the primary model is rate limited or overloaded (separate free-tier quotas).
  GEMINI_FALLBACK_MODELS: z.string().default('gemini-3-flash-preview,gemini-3.5-flash,gemini-3.1-flash-lite'),
  // Time allowed to understand a message before falling back to the offline reader.
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  // Time allowed for the model to word the reply; after that the template reply is sent at once.
  AI_REPLY_BUDGET_MS: z.coerce.number().int().positive().default(2_500),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  // Treat empty strings from docker-compose substitution as "unset".
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
