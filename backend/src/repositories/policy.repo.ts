import { pool, type Queryable } from '../db/pool.js';
import type { CustomRule } from '../policy/custom-rules.js';
import type { PolicyConfig } from '../policy/policy.js';

export interface PolicyVersionRow {
  id: number;
  version: string;
  config: PolicyConfig;
  customRules: CustomRule[];
  note: string;
  createdBy: string;
  createdAt: Date;
  isActive: boolean;
}

interface Row {
  id: number;
  version: string;
  config: PolicyConfig;
  custom_rules: CustomRule[];
  note: string;
  created_by: string;
  created_at: Date;
  is_active: boolean;
}

const toVersion = (r: Row): PolicyVersionRow => ({
  id: r.id,
  version: r.version,
  config: r.config,
  customRules: r.custom_rules,
  note: r.note,
  createdBy: r.created_by,
  createdAt: r.created_at,
  isActive: r.is_active,
});

export async function getActiveVersion(db: Queryable = pool): Promise<PolicyVersionRow | null> {
  const { rows } = await db.query<Row>('SELECT * FROM policy_versions WHERE is_active LIMIT 1');
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function getVersion(id: number, db: Queryable = pool): Promise<PolicyVersionRow | null> {
  const { rows } = await db.query<Row>('SELECT * FROM policy_versions WHERE id = $1', [id]);
  return rows[0] ? toVersion(rows[0]) : null;
}

export async function listVersions(limit = 50): Promise<PolicyVersionRow[]> {
  const { rows } = await pool.query<Row>('SELECT * FROM policy_versions ORDER BY id DESC LIMIT $1', [limit]);
  return rows.map(toVersion);
}

export async function countVersions(db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM policy_versions');
  return rows[0]?.n ?? 0;
}

/** Inserts a version and makes it the only active one. Call inside a transaction. */
export async function insertActiveVersion(
  db: Queryable,
  v: { version: string; config: PolicyConfig; customRules: CustomRule[]; note: string; createdBy: string },
): Promise<PolicyVersionRow> {
  await db.query('UPDATE policy_versions SET is_active = false WHERE is_active');
  const { rows } = await db.query<Row>(
    `INSERT INTO policy_versions (version, config, custom_rules, note, created_by, is_active)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
    [v.version, JSON.stringify(v.config), JSON.stringify(v.customRules), v.note, v.createdBy],
  );
  return toVersion(rows[0]!);
}

/** Makes an existing version active again (rollback). Call inside a transaction. */
export async function activateVersion(db: Queryable, id: number): Promise<void> {
  await db.query('UPDATE policy_versions SET is_active = false WHERE is_active');
  await db.query('UPDATE policy_versions SET is_active = true WHERE id = $1', [id]);
}

export async function deleteAllVersions(db: Queryable): Promise<void> {
  await db.query('DELETE FROM policy_versions');
}
