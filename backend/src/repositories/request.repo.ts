import { pool, type Queryable } from '../db/pool.js';
import type { Decision, Extraction, LineDecision, TraceStep, TriggeredRule } from '../domain/types.js';
import { buildOrder, buildWhere, type RequestListFilters } from './request-query.js';

export type { RequestListFilters } from './request-query.js';

export interface NewRefundRequest {
  id: string;
  reference: string;
  conversationId: string;
  customerId: string;
  orderId: string | null;
  customerMessage: string;
  reasonCategory: string;
  reasonSummary: string;
  decision: Decision;
  refundAmountCents: number;
  reviewAmountCents: number;
  lines: LineDecision[];
  rules: TriggeredRule[];
  riskFlags: string[];
  extraction: Extraction | null;
  trace: TraceStep[];
  customerReply: string;
  internalNote: string | null;
  aiProvider: string;
  aiModel: string;
  policyVersion: string;
  latencyMs: number;
}

export async function insertRequest(db: Queryable, r: NewRefundRequest): Promise<void> {
  await db.query(
    `INSERT INTO refund_requests (
       id, reference, conversation_id, customer_id, order_id, customer_message, reason_category, reason_summary,
       system_decision, status, refund_amount_cents, review_amount_cents, line_decisions, rules_triggered,
       risk_flags, extraction, trace, customer_reply, internal_note, ai_provider, ai_model, policy_version, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      r.id, r.reference, r.conversationId, r.customerId, r.orderId, r.customerMessage, r.reasonCategory,
      r.reasonSummary, r.decision, r.refundAmountCents, r.reviewAmountCents, JSON.stringify(r.lines),
      JSON.stringify(r.rules), r.riskFlags, r.extraction ? JSON.stringify(r.extraction) : null,
      JSON.stringify(r.trace), r.customerReply, r.internalNote, r.aiProvider, r.aiModel, r.policyVersion, r.latencyMs,
    ],
  );
}

export async function findOpenEscalation(orderId: string): Promise<{ id: string; reference: string } | null> {
  const { rows } = await pool.query<{ id: string; reference: string }>(
    `SELECT id, reference FROM refund_requests
     WHERE order_id = $1 AND status = 'ESCALATED' ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

const LIST_COLUMNS = `
  r.id, r.reference, r.status, r.system_decision, r.reason_category, r.reason_summary,
  r.refund_amount_cents, r.review_amount_cents, r.risk_flags, r.ai_provider, r.latency_ms,
  r.created_at, r.reviewed_by, r.reviewed_at, r.customer_message,
  c.id AS customer_id, c.name AS customer_name, o.order_number`;

const FROM_SQL = `FROM refund_requests r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN orders o ON o.id = r.order_id`;

export async function listRequests(f: RequestListFilters) {
  const { clause, params } = buildWhere(f);
  const page = pool.query(
    `SELECT ${LIST_COLUMNS}, count(*) OVER()::int AS total
     ${FROM_SQL} ${clause} ${buildOrder(f.sort, f.dir)}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.limit, f.offset],
  );
  // Facet counts respect every other active filter, so the numbers on tabs and menus match what a click would show.
  const tabs = buildWhere(f, ['status', 'flagged']);
  const statusFacet = pool.query(
    `SELECT count(*)::int AS "all",
            count(*) FILTER (WHERE r.status = 'ESCALATED')::int AS "ESCALATED",
            count(*) FILTER (WHERE r.status = 'APPROVED')::int AS "APPROVED",
            count(*) FILTER (WHERE r.status = 'DENIED')::int AS "DENIED",
            count(*) FILTER (WHERE cardinality(r.risk_flags) > 0)::int AS flagged
     ${FROM_SQL} ${tabs.clause}`,
    tabs.params,
  );
  const reasons = buildWhere(f, ['reasons']);
  const reasonFacet = pool.query(
    `SELECT r.reason_category AS value, count(*)::int AS count ${FROM_SQL} ${reasons.clause}
     GROUP BY 1 ORDER BY 2 DESC, 1`,
    reasons.params,
  );
  const signals = buildWhere(f, ['signals']);
  const signalFacet = pool.query(
    `SELECT flag AS value, count(*)::int AS count ${FROM_SQL} CROSS JOIN LATERAL unnest(r.risk_flags) AS flag ${signals.clause}
     GROUP BY 1 ORDER BY 2 DESC, 1`,
    signals.params,
  );
  const [{ rows }, s, rs, sg] = await Promise.all([page, statusFacet, reasonFacet, signalFacet]);
  return {
    total: (rows[0]?.total as number | undefined) ?? 0,
    items: rows.map(({ total: _t, ...rest }) => rest),
    facets: { status: s.rows[0], reasons: rs.rows, signals: sg.rows },
  };
}

/** Every matching case for a CSV export, capped so one request cannot pull the whole table. */
export async function exportRequests(f: RequestListFilters, cap = 5000) {
  const { clause, params } = buildWhere(f);
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}, r.policy_version ${FROM_SQL} ${clause} ${buildOrder(f.sort, f.dir)} LIMIT $${params.length + 1}`,
    [...params, cap],
  );
  return rows;
}

export async function getRequest(id: string, db: Queryable = pool) {
  const { rows } = await db.query(
    `SELECT r.*, c.name AS customer_name, c.email AS customer_email, c.tier AS customer_tier,
            c.account_flags AS customer_flags, o.order_number, o.status AS order_status,
            o.total_cents AS order_total_cents, o.delivered_at AS order_delivered_at
     FROM refund_requests r
     JOIN customers c ON c.id = r.customer_id
     LEFT JOIN orders o ON o.id = r.order_id
     WHERE r.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Locks the row so two reviewers cannot resolve the same case concurrently. */
export async function lockRequestForReview(db: Queryable, id: string) {
  const { rows } = await db.query(`SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] ?? null;
}

export async function resolveReview(
  db: Queryable,
  args: { id: string; status: Decision; reviewer: string; note: string; refundAmountCents: number },
): Promise<void> {
  await db.query(
    `UPDATE refund_requests
     SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, refund_amount_cents = $5
     WHERE id = $1`,
    [args.id, args.status, args.reviewer, args.note, args.refundAmountCents],
  );
}

/** Headline figures plus a day-by-day series for the last `days` days, compared with the period before. */
export async function getStats(days = 7) {
  const { rows } = await pool.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
      count(*) FILTER (WHERE status = 'DENIED')::int AS denied,
      count(*) FILTER (WHERE status = 'ESCALATED')::int AS pending_review,
      count(*) FILTER (WHERE system_decision = 'ESCALATED')::int AS escalated_total,
      count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int AS human_reviewed,
      count(*) FILTER (WHERE cardinality(risk_flags) > 0)::int AS flagged,
      COALESCE(sum(refund_amount_cents) FILTER (WHERE status = 'APPROVED'), 0)::bigint AS refunded_cents,
      COALESCE(sum(refund_amount_cents) FILTER (WHERE status = 'APPROVED' AND reviewed_at IS NULL), 0)::bigint AS refunded_auto_cents,
      COALESCE(sum(refund_amount_cents) FILTER (WHERE status = 'APPROVED' AND reviewed_at IS NOT NULL), 0)::bigint AS refunded_team_cents,
      COALESCE(sum(review_amount_cents) FILTER (WHERE status = 'ESCALATED'), 0)::bigint AS pending_cents,
      COALESCE(round(avg(latency_ms)), 0)::int AS avg_latency_ms,
      count(*) FILTER (WHERE created_at >= current_date - ($1::int - 1))::int AS period_cases,
      count(*) FILTER (WHERE created_at >= current_date - (2 * $1::int - 1) AND created_at < current_date - ($1::int - 1))::int AS previous_cases,
      COALESCE(sum(refund_amount_cents) FILTER (WHERE status = 'APPROVED' AND created_at >= current_date - ($1::int - 1)), 0)::bigint AS period_refunded_cents,
      COALESCE(sum(refund_amount_cents) FILTER (WHERE status = 'APPROVED' AND created_at >= current_date - (2 * $1::int - 1) AND created_at < current_date - ($1::int - 1)), 0)::bigint AS previous_refunded_cents
    FROM refund_requests`, [days]);
  const { rows: daily } = await pool.query(`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
           count(r.id) FILTER (WHERE r.system_decision = 'APPROVED')::int AS approved,
           count(r.id) FILTER (WHERE r.system_decision = 'DENIED')::int AS denied,
           count(r.id) FILTER (WHERE r.system_decision = 'ESCALATED')::int AS escalated,
           COALESCE(sum(r.refund_amount_cents) FILTER (WHERE r.status = 'APPROVED'), 0)::bigint AS refunded_cents
    FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') d
    LEFT JOIN refund_requests r ON r.created_at::date = d::date
    GROUP BY d ORDER BY d`, [days]);
  const { rows: reasons } = await pool.query(`
    SELECT reason_category AS reason, count(*)::int AS count
    FROM refund_requests GROUP BY reason_category ORDER BY count DESC`);
  return { ...rows[0], days, daily, reasons };
}
