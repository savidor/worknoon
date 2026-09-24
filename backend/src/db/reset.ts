import { migrate } from './migrate.js';
import { pool } from './pool.js';
import { reseed } from '../seed/seed.js';

await migrate();
await reseed();
await pool.end();
