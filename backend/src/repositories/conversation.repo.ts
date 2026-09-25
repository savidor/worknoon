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

export async function latestConversationFor(customerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM conversations WHERE customer_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [customerId],
  );
  return rows[0]?.id ?? null;
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
