import { pool, type Queryable } from '../db/pool.js';
import type { Customer, Order, OrderItem } from '../domain/types.js';
import { RefundConflictError } from '../lib/errors.js';

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  tier: Customer['tier'];
  account_flags: string[];
  member_since: Date;
}

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  email: r.email,
  tier: r.tier,
  accountFlags: r.account_flags,
  memberSince: r.member_since,
});

export async function getCustomer(id: string): Promise<Customer | null> {
  const { rows } = await pool.query<CustomerRow>('SELECT * FROM customers WHERE id = $1', [id]);
  return rows[0] ? toCustomer(rows[0]) : null;
}

export async function listCustomers(): Promise<Customer[]> {
  const { rows } = await pool.query<CustomerRow>('SELECT * FROM customers ORDER BY id');
  return rows.map(toCustomer);
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  status: Order['status'];
  ordered_at: Date;
  shipped_at: Date | null;
  delivered_at: Date | null;
  expected_delivery_at: Date | null;
  carrier_tracking: string | null;
  total_cents: number;
  currency: string;
  items: Array<{
    id: string;
    sku: string;
    name: string;
    category: string;
    unit_price_cents: number;
    quantity: number;
    final_sale: boolean;
    refunded_quantity: number;
  }>;
}

const ORDER_SELECT = `
  SELECT o.*,
         COALESCE(json_agg(i ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM orders o
  LEFT JOIN order_items i ON i.order_id = o.id`;

const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  orderNumber: r.order_number,
  customerId: r.customer_id,
  status: r.status,
  orderedAt: r.ordered_at,
  shippedAt: r.shipped_at,
  deliveredAt: r.delivered_at,
  expectedDeliveryAt: r.expected_delivery_at,
  carrierTracking: r.carrier_tracking,
  totalCents: r.total_cents,
  currency: r.currency,
  items: r.items.map(
    (i): OrderItem => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      category: i.category,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      finalSale: i.final_sale,
      refundedQuantity: i.refunded_quantity,
    }),
  ),
});

export async function listOrdersForCustomer(customerId: string, db: Queryable = pool): Promise<Order[]> {
  const { rows } = await db.query<OrderRow>(
    `${ORDER_SELECT} WHERE o.customer_id = $1 GROUP BY o.id ORDER BY o.ordered_at DESC`,
    [customerId],
  );
  return rows.map(toOrder);
}

export async function getOrderByNumber(orderNumber: string, db: Queryable = pool): Promise<Order | null> {
  const { rows } = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.order_number = $1 GROUP BY o.id`, [
    orderNumber,
  ]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function getOrderById(id: string, db: Queryable = pool): Promise<Order | null> {
  const { rows } = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1 GROUP BY o.id`, [id]);
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function countRefundsSince(customerId: string, since: Date): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM refunds WHERE customer_id = $1 AND created_at >= $2',
    [customerId, since],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Marks items refunded and records the ledger entry. Must run inside the case transaction.
 * The conditional update is the double-refund guard: under concurrency only one transaction
 * can move an item from unrefunded to refunded; any other sees zero rows and rolls back.
 */
export async function recordRefund(
  db: Queryable,
  args: { refundId: string; orderId: string; customerId: string; itemIds: string[]; amountCents: number; source: 'automated' | 'human_review' },
): Promise<void> {
  if (args.amountCents <= 0) return;
  const claimed = await db.query(
    `UPDATE order_items SET refunded_quantity = quantity
     WHERE order_id = $1 AND id = ANY($2::text[]) AND refunded_quantity < quantity
     RETURNING id`,
    [args.orderId, args.itemIds],
  );
  if (claimed.rowCount !== new Set(args.itemIds).size) throw new RefundConflictError();
  await db.query(
    `INSERT INTO refunds (id, order_id, customer_id, amount_cents, source) VALUES ($1,$2,$3,$4,$5)`,
    [args.refundId, args.orderId, args.customerId, args.amountCents, args.source],
  );
}
