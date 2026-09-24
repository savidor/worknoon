// Copies non-TypeScript runtime assets (SQL migrations, policy document) into dist.
import { cpSync, copyFileSync, mkdirSync } from 'node:fs';

cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
mkdirSync('dist/policy', { recursive: true });
copyFileSync('src/policy/refund-policy.md', 'dist/policy/refund-policy.md');
