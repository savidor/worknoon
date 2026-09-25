import { randomUUID } from 'node:crypto';
import { pool, type Queryable } from '../db/pool.js';

export type MessageRole = 'customer' | 'assistant' | 'agent';

export interface MessageMeta {
  outcome?: string;
  caseId?: string;
  caseReference?: string;
  orderNumber?: string | null;
  refundAmountCents?: number;
  reviewAmountCents?: number;
  lines?: Array<{ name: string; amountCents: number; decision: string }>;
  reasons?: string[];
  /** What a clarifying question asked for, so the next turn knows the context. */
  missingInfo?: string[];
  unknownItems?: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  meta: MessageMeta;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  meta: MessageMeta;
  created_at: Date;
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  meta: r.meta,
  createdAt: r.created_at,
});

export async function createConversation(customerId: string): Promise<{ id: string; createdAt: Date }> {
  const id = `cnv_${randomUUID()}`;
  const { rows } = await pool.query<{ created_at: Date }>(
    'INSERT INTO conversations (id, customer_id) VALUES ($1,$2) RETURNING created_at',
    [id, customerId],
  );
  return { id, createdAt: rows[0]!.created_at };
}

export async function getConversation(id: string): Promise<{ id: string; customerId: string } | null> {
  const { rows } = await pool.query<{ id: string; customer_id: string }>(
    'SELECT id, customer_id FROM conversations WHERE id = $1',
    [id],
  );
  return rows[0] ? { id: rows[0].id, customerId: rows[0].customer_id } : null;
}

export async function latestConversationFor(customerId: string): Promise<{ id: string; updatedAt: Date } | null> {
  const { rows } = await pool.query<{ id: string; updated_at: Date }>(
    'SELECT id, updated_at FROM conversations WHERE customer_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [customerId],
  );
  return rows[0] ? { id: rows[0].id, updatedAt: rows[0].updated_at } : null;
}

export async function listMessages(conversationId: string, limit = 200): Promise<Message[]> {
  const { rows } = await pool.query<MessageRow>(
    `SELECT * FROM (
       SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2
     ) m ORDER BY created_at ASC`,
    [conversationId, limit],
  );
  return rows.map(toMessage);
}

export async function addMessage(
  args: { conversationId: string; role: MessageRole; content: string; meta?: MessageMeta },
  db: Queryable = pool,
): Promise<Message> {
  const { rows } = await db.query<MessageRow>(
    `INSERT INTO messages (id, conversation_id, role, content, meta, created_at)
     VALUES ($1,$2,$3,$4,$5, clock_timestamp()) RETURNING *`,
    [`msg_${randomUUID()}`, args.conversationId, args.role, args.content, args.meta ?? {}],
  );
  await db.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [args.conversationId]);
  return toMessage(rows[0]!);
}

export interface ConversationSummary {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  preview: string | null;
  messageCount: number;
  /** Customer-safe view of each decision: never risk flags, rule ids or internal notes. */
  cases: Array<{ reference: string | null; status: string; amountCents: number; orderNumber: string | null; reviewed: boolean }>;
}

/** A customer's earlier enquiries, newest first. Conversations with no messages are left out. */
export async function listConversationsFor(customerId: string, limit = 20): Promise<ConversationSummary[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.created_at, c.updated_at, first.content AS preview, counts.n AS message_count,
            COALESCE(cases.list::jsonb, '[]'::jsonb) || COALESCE(team_refunds.list::jsonb, '[]'::jsonb) AS cases
     FROM conversations c
     CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM messages m WHERE m.conversation_id = c.id) counts
     LEFT JOIN LATERAL (
       SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'customer' ORDER BY created_at LIMIT 1
     ) first ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'reference', r.reference,
                'status', r.status,
                'amountCents', CASE WHEN r.status = 'APPROVED' THEN r.refund_amount_cents ELSE r.review_amount_cents END,
                'orderNumber', o.order_number,
                'reviewed', r.reviewed_at IS NOT NULL
              ) ORDER BY r.created_at) AS list
       FROM refund_requests r LEFT JOIN orders o ON o.id = r.order_id
       WHERE r.conversation_id = c.id
     ) cases ON true
     -- Refunds the support team made before RefundDesk have no case, only a ledger entry.
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'reference', NULL, 'status', 'APPROVED', 'amountCents', f.amount_cents,
                'orderNumber', o.order_number, 'reviewed', true
              ) ORDER BY f.created_at) AS list
       FROM refunds f JOIN orders o ON o.id = f.order_id
       WHERE f.conversation_id = c.id AND f.request_id IS NULL
     ) team_refunds ON true
     WHERE c.customer_id = $1 AND counts.n > 0
     ORDER BY c.updated_at DESC
     LIMIT $2`,
    [customerId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview: r.preview,
    messageCount: r.message_count,
    cases: r.cases,
  }));
}
