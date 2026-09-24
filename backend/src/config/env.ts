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

  // Demo mode exposes the customer switcher and the reset endpoint. Never enable in production.
  DEMO_MODE: bool.default(true),

  JWT_SECRET: z.string().min(32).default('change-me-in-production-this-is-a-dev-only-secret'),
  ADMIN_PASSWORD: z.string().min(8).default('worknoon-admin'),
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:5173'),

  // AI provider selection. "auto" picks Anthropic, then OpenAI, then Gemini, then the offline mock.
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'openai', 'gemini', 'mock']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
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
