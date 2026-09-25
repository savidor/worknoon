import { aiProvider } from './ai/index.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { seedIfEmpty } from './seed/seed.js';
import { ensureDefaultPolicy, getActivePolicy } from './services/policy.service.js';

async function waitForDatabase(attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger.info({ attempt: i }, 'Waiting for database');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('change-me')) {
    logger.warn('JWT_SECRET is the development default. Set a strong secret before any real deployment.');
  }
  await waitForDatabase();
  if (env.AUTO_MIGRATE) await migrate();
  if (env.SEED_ON_BOOT) await seedIfEmpty();
  await ensureDefaultPolicy();
  const policy = await getActivePolicy();

  const server = createApp().listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, ai: `${aiProvider.name}:${aiProvider.model}`, policy: policy.version, demoMode: env.DEMO_MODE },
      'RefundDesk API ready',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
