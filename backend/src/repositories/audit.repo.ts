import { pool, type Queryable } from '../db/pool.js';

export type Severity = 'info' | 'warning' | 'critical';

export interface AuditEvent {
  requestId?: string | null;
  conversationId?: string | null;
  actor: string;
  type: string;
  severity?: Severity;
  detail?: Record<string, unknown>;
}

export async function recordEvents(events: AuditEvent[], db: Queryable = pool): Promise<void> {
  for (const e of events) {
    await db.query(
      `INSERT INTO audit_events (request_id, conversation_id, actor, type, severity, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, clock_timestamp())`,
      [e.requestId ?? null, e.conversationId ?? null, e.actor, e.type, e.severity ?? 'info', e.detail ?? {}],
    );
  }
}

export async function eventsForRequest(requestId: string) {
  const { rows } = await pool.query(
    `SELECT id, actor, type, severity, detail, created_at FROM audit_events
     WHERE request_id = $1 ORDER BY created_at, id`,
    [requestId],
  );
  return rows;
}

export async function securityEvents(limit = 50) {
  const { rows } = await pool.query(
    `SELECT e.id, e.type, e.severity, e.detail, e.created_at, e.request_id, r.reference,
            c.name AS customer_name
     FROM audit_events e
     LEFT JOIN refund_requests r ON r.id = e.request_id
     LEFT JOIN conversations cv ON cv.id = e.conversation_id
     LEFT JOIN customers c ON c.id = cv.customer_id
     WHERE e.type LIKE 'security.%'
     ORDER BY e.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
