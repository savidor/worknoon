import { pool, withTransaction, type Queryable } from '../db/pool.js';
import type { Customer, Decision, Extraction, LineDecision, Order, ReasonCategory, TriggeredRule } from '../domain/types.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { DAY_MS } from '../lib/money.js';
import { evaluateRefund } from '../policy/engine.js';
import { DEFAULT_POLICY, ruleCatalog, type ActivePolicy, type PolicyConfig } from '../policy/policy.js';
import { normalizeDraft, type PolicyDraft } from '../policy/policy-schema.js';
import { recordEvents } from '../repositories/audit.repo.js';
import { getCustomer, getOrderById, getOrderByNumber } from '../repositories/crm.repo.js';
import {
  activateVersion,
  countVersions,
  deleteAllVersions,
  getActiveVersion,
  getVersion,
  insertActiveVersion,
} from '../repositories/policy.repo.js';

/**
 * The active policy is read on every customer turn, so it is cached briefly. Publishing
 * clears the cache immediately; other replicas pick the change up within the TTL.
 */
const CACHE_TTL_MS = 5_000;
let cache: { policy: ActivePolicy; at: number } | null = null;

export async function getActivePolicy(): Promise<ActivePolicy> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.policy;
  const row = await getActiveVersion();
  const policy: ActivePolicy = row
    ? { version: row.version, config: row.config, customRules: row.customRules }
    : DEFAULT_POLICY;
  cache = { policy, at: Date.now() };
  return policy;
}

function invalidate() {
  cache = null;
}

const DEFAULT_NOTE = 'Initial policy: refund window, final sale, human review, delivery and integrity rules.';

/** Ensures a published policy exists. Runs at startup and when demo data is reset. */
export async function ensureDefaultPolicy(db: Queryable = pool): Promise<void> {
  if ((await countVersions(db)) > 0) return;
  await insertActiveVersion(db, {
    version: DEFAULT_POLICY.version,
    config: DEFAULT_POLICY.config,
    customRules: [],
    note: DEFAULT_NOTE,
    createdBy: 'system',
  });
  invalidate();
}

export async function resetPolicies(db: Queryable): Promise<void> {
  await deleteAllVersions(db);
  await ensureDefaultPolicy(db);
  invalidate();
}

function nextVersionLabel(count: number): string {
  const d = new Date();
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}-r${count + 1}`;
}

function summarizeChanges(before: ActivePolicy, after: PolicyDraft): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(after.config) as (keyof PolicyConfig)[]) {
    const a = JSON.stringify(before.config[key]);
    const b = JSON.stringify(after.config[key]);
    if (a !== b) changes.push(`${key}: ${a} -> ${b}`);
  }
  const beforeIds = new Set(before.customRules.map((r) => r.id));
  const afterIds = new Set(after.customRules.map((r) => r.id));
  for (const r of after.customRules) if (!beforeIds.has(r.id)) changes.push(`added rule "${r.name}"`);
  for (const r of before.customRules) if (!afterIds.has(r.id)) changes.push(`removed rule "${r.name}"`);
  for (const r of after.customRules) {
    const old = before.customRules.find((o) => o.id === r.id);
    if (old && JSON.stringify(old) !== JSON.stringify(r)) changes.push(`edited rule "${r.name}"`);
  }
  return changes;
}

export async function publishPolicy(input: unknown, note: string, author: string) {
  const draft = normalizeDraft(input);
  const current = await getActivePolicy();
  const changes = summarizeChanges(current, draft);
  if (changes.length === 0) throw HttpError.badRequest('Nothing changed compared with the active policy');

  const created = await withTransaction(async (db) => {
    // Serialise publishes so two editors cannot create the same version number.
    await db.query('SELECT pg_advisory_xact_lock(727275)');
    const version = nextVersionLabel(await countVersions(db));
    const row = await insertActiveVersion(db, { version, ...draft, note, createdBy: author });
    await recordEvents(
      [{ actor: `admin:${author}`, type: 'policy.published', detail: { version, note, changes, previous: current.version } }],
      db,
    );
    return row;
  });
  invalidate();
  logger.info({ version: created.version, author, changes }, 'Policy published');
  return created;
}

export async function activatePolicyVersion(id: number, note: string, author: string) {
  const target = await getVersion(id);
  if (!target) throw HttpError.notFound('Policy version not found');
  if (target.isActive) throw HttpError.conflict(`${target.version} is already active`);
  const previous = await getActivePolicy();
  await withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(727275)');
    await activateVersion(db, id);
    await recordEvents(
      [{ actor: `admin:${author}`, type: 'policy.activated', detail: { version: target.version, note, previous: previous.version } }],
      db,
    );
  });
  invalidate();
  logger.info({ version: target.version, author }, 'Policy version reactivated');
  return getVersion(id);
}

/* ------------------------------ simulation ------------------------------ */

export interface EvaluationView {
  decision: Decision;
  refundAmountCents: number;
  reviewAmountCents: number;
  lines: LineDecision[];
  rules: Array<TriggeredRule & { title: string; custom: boolean }>;
}

function view(policy: ActivePolicy, e: ReturnType<typeof evaluateRefund>): EvaluationView {
  const catalog = ruleCatalog(policy);
  return {
    decision: e.decision,
    refundAmountCents: e.refundAmountCents,
    reviewAmountCents: e.reviewAmountCents,
    lines: e.lines,
    rules: e.rules.map((r) => ({ ...r, title: catalog.get(r.id)?.title ?? r.id, custom: !!catalog.get(r.id)?.custom })),
  };
}

async function refundsBefore(customerId: string, at: Date, lookbackDays: number, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM refunds WHERE customer_id = $1 AND created_at < $2 AND created_at >= $3',
    [customerId, at, new Date(at.getTime() - lookbackDays * DAY_MS)],
  );
  return rows[0]?.n ?? 0;
}

async function evaluateBoth(
  draft: ActivePolicy,
  active: ActivePolicy,
  args: { customer: Customer; order: Order; reason: ReasonCategory; itemIds: string[] | null; now: Date; confidence: number; manipulation: string[]; mismatches: string[] },
) {
  const run = async (policy: ActivePolicy) =>
    view(
      policy,
      evaluateRefund(
        {
          now: args.now,
          customer: args.customer,
          order: args.order,
          reason: args.reason,
          requestedItemIds: args.itemIds,
          signals: {
            refundsInLookback: await refundsBefore(args.customer.id, args.now, policy.config.frequencyLookbackDays),
            manipulationSignals: args.manipulation,
            confidence: args.confidence,
            claimMismatches: args.mismatches,
          },
        },
        policy,
      ),
    );
  return { active: await run(active), draft: await run(draft) };
}

/** Runs one order through the active policy and a draft, side by side. Nothing is saved. */
export async function simulatePolicy(input: { draft: unknown; orderNumber: string; reason: ReasonCategory; itemSkus?: string[] }) {
  const d = normalizeDraft(input.draft);
  const draft: ActivePolicy = { version: 'draft', ...d };
  const order = await getOrderByNumber(input.orderNumber);
  if (!order) throw HttpError.notFound(`Order ${input.orderNumber} not found`);
  const customer = await getCustomer(order.customerId);
  if (!customer) throw HttpError.notFound('Customer not found');
  const ids = order.items.filter((i) => input.itemSkus?.includes(i.sku)).map((i) => i.id);
  const result = await evaluateBoth(draft, await getActivePolicy(), {
    customer, order, reason: input.reason, itemIds: ids.length ? ids : null, now: new Date(), confidence: 1, manipulation: [], mismatches: [],
  });
  return { order: { orderNumber: order.orderNumber, customerName: customer.name, status: order.status }, ...result };
}

interface ReplayRow {
  id: string;
  reference: string;
  customer_id: string;
  customer_name: string;
  order_id: string;
  order_number: string;
  reason_category: ReasonCategory;
  status: Decision;
  line_decisions: LineDecision[];
  rules_triggered: TriggeredRule[];
  extraction: Extraction | null;
  created_at: Date;
}

/**
 * Replays recent cases through the active policy and a draft to show which decisions a
 * change would alter. Items refunded by the case itself are treated as not yet refunded,
 * and each case is evaluated at the time it was made, so windows and lookbacks line up.
 */
export async function policyImpact(input: { draft: unknown; limit?: number }) {
  const d = normalizeDraft(input.draft);
  const draft: ActivePolicy = { version: 'draft', ...d };
  const active = await getActivePolicy();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const { rows } = await pool.query<ReplayRow>(
    `SELECT r.id, r.reference, r.customer_id, c.name AS customer_name, r.order_id, o.order_number,
            r.reason_category, r.status, r.line_decisions, r.rules_triggered, r.extraction, r.created_at
     FROM refund_requests r
     JOIN customers c ON c.id = r.customer_id
     JOIN orders o ON o.id = r.order_id
     ORDER BY r.created_at DESC LIMIT $1`,
    [limit],
  );

  const changed: Array<{ reference: string; customerName: string; orderNumber: string; before: EvaluationView; after: EvaluationView }> = [];
  for (const row of rows) {
    const [order, customer] = await Promise.all([getOrderById(row.order_id), getCustomer(row.customer_id)]);
    if (!order || !customer) continue;
    const paidByThisCase = new Set(row.status === 'APPROVED' ? row.line_decisions.filter((l) => l.decision !== 'DENIED').map((l) => l.itemId) : []);
    const snapshot: Order = { ...order, items: order.items.map((i) => (paidByThisCase.has(i.id) ? { ...i, refundedQuantity: 0 } : i)) };
    const detail = (id: string) => row.rules_triggered.filter((r) => r.id === id).map((r) => r.detail);
    const result = await evaluateBoth(draft, active, {
      customer,
      order: snapshot,
      reason: row.reason_category,
      itemIds: row.line_decisions.map((l) => l.itemId),
      now: new Date(row.created_at),
      confidence: row.extraction?.confidence ?? 1,
      manipulation: detail('MANIPULATION_ATTEMPT'),
      mismatches: detail('CLAIM_MISMATCH'),
    });
    const differs =
      result.active.decision !== result.draft.decision ||
      result.active.refundAmountCents !== result.draft.refundAmountCents ||
      result.active.reviewAmountCents !== result.draft.reviewAmountCents;
    if (differs) {
      changed.push({ reference: row.reference, customerName: row.customer_name, orderNumber: row.order_number, before: result.active, after: result.draft });
    }
  }
  return { replayed: rows.length, changedCount: changed.length, changed };
}
