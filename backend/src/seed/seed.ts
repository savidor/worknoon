import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { DAY_MS } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { SEED_CUSTOMERS } from './data.js';

const ago = (now: number, days: number | undefined) => (days === undefined ? null : new Date(now - days * DAY_MS));

async function insertOrder(
  client: pg.PoolClient,
  customerId: string,
  now: number,
  o: {
    number: string;
    status: string;
    orderedDaysAgo: number;
    shippedDaysAgo?: number;
    deliveredDaysAgo?: number;
    expectedDeliveryDaysAgo?: number;
    items: Array<{ sku: string; name: string; category: string; priceCents: number; quantity?: number; finalSale?: boolean; refunded?: boolean }>;
  },
) {
  const orderId = `ord_${o.number.slice(3)}`;
  const total = o.items.reduce((s, i) => s + i.priceCents * (i.quantity ?? 1), 0);
  await client.query(
    `INSERT INTO orders (id, order_number, customer_id, status, ordered_at, shipped_at, delivered_at,
                         expected_delivery_at, carrier_tracking, total_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      orderId,
      o.number,
      customerId,
      o.status,
      ago(now, o.orderedDaysAgo),
      ago(now, o.shippedDaysAgo),
      ago(now, o.deliveredDaysAgo),
      ago(now, o.expectedDeliveryDaysAgo ?? o.deliveredDaysAgo),
      o.shippedDaysAgo !== undefined ? `1Z${o.number.slice(3)}WN${o.orderedDaysAgo}` : null,
      total,
    ],
  );
  for (const [idx, item] of o.items.entries()) {
    const qty = item.quantity ?? 1;
    await client.query(
      `INSERT INTO order_items (id, order_id, sku, name, category, unit_price_cents, quantity, final_sale, refunded_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`${orderId}_i${idx + 1}`, orderId, item.sku, item.name, item.category, item.priceCents, qty, item.finalSale ?? false, item.refunded ? qty : 0],
    );
  }
  return { orderId, total };
}

/** Wipes all data and loads the synthetic dataset. Safe to run repeatedly. */
export async function reseed(): Promise<void> {
  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      'TRUNCATE audit_events, messages, refund_requests, conversations, refunds, order_items, orders, customers CASCADE',
    );

    for (const c of SEED_CUSTOMERS) {
      await client.query(
        `INSERT INTO customers (id, name, email, tier, account_flags, member_since) VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.id, c.name, c.email, c.tier, c.flags ?? [], ago(now, c.memberSinceDaysAgo)],
      );

      for (const o of c.orders) {
        const { orderId, total } = await insertOrder(client, c.id, now, o);
        if (o.items.some((i) => i.refunded)) {
          await client.query(
            `INSERT INTO refunds (id, order_id, customer_id, amount_cents, source, created_at) VALUES ($1,$2,$3,$4,'historical',$5)`,
            [`rfd_${orderId}`, orderId, c.id, total, ago(now, Math.max(0, (o.deliveredDaysAgo ?? 0) - 3))],
          );
        }
      }

      // Historical orders that were refunded, so the frequency rule has real ledger data behind it.
      for (const [idx, r] of (c.pastRefunds ?? []).entries()) {
        const number = `WN-0${c.id.slice(-2)}${idx + 1}${idx + 1}`.slice(0, 8);
        const { orderId } = await insertOrder(client, c.id, now, {
          number,
          status: 'delivered',
          orderedDaysAgo: r.daysAgo + 8,
          shippedDaysAgo: r.daysAgo + 7,
          deliveredDaysAgo: r.daysAgo + 4,
          items: [{ sku: `HIS-${idx + 1}`, name: `Past purchase #${idx + 1}`, category: 'general', priceCents: r.cents, refunded: true }],
        });
        await client.query(
          `INSERT INTO refunds (id, order_id, customer_id, amount_cents, source, created_at) VALUES ($1,$2,$3,$4,'historical',$5)`,
          [`rfd_${orderId}`, orderId, c.id, r.cents, ago(now, r.daysAgo)],
        );
      }
    }
  });
  logger.info({ customers: SEED_CUSTOMERS.length }, 'Seeded synthetic CRM data');
}

export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM customers');
  if ((rows[0]?.n ?? 0) === 0) await reseed();
}
