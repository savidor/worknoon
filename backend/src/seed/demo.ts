import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { generateSampleActivity } from './sample-activity.js';
import { reseed } from './seed.js';

/** Restores the demo: personas, orders, original policy, and optionally a week of activity. */
export async function resetDemoData(options: { sampleActivity: boolean }): Promise<void> {
  await reseed();
  if (options.sampleActivity) await generateSampleActivity();
}

export async function seedDemoIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM customers');
  if ((rows[0]?.n ?? 0) === 0) await resetDemoData({ sampleActivity: env.SEED_SAMPLE_ACTIVITY });
}
