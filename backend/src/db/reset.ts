import { migrate } from './migrate.js';
import { pool } from './pool.js';
import { resetDemoData } from '../seed/demo.js';

await migrate();
await resetDemoData({ sampleActivity: true });
await pool.end();
