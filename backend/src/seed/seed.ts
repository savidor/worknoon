import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { DAY_MS } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { resetPolicies } from '../services/policy.service.js';
import { SEED_CUSTOMERS, type RefundStory } from './data.js';

const ago = (now: number, days: number | undefined) => (days === undefined ? null : new Date(now - days * DAY_MS));

export async function insertOrder(
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
  const refunded: { itemIds: string[]; cents: number } = { itemIds: [], cents: 0 };
  for (const [idx, item] of o.items.entries()) {
    const qty = item.quantity ?? 1;
    if (item.refunded) {
      refunded.itemIds.push(`${orderId}_i${idx + 1}`);
      refunded.cents += item.priceCents * qty;
    }
    await client.query(
      `INSERT INTO order_items (id, order_id, sku, name, category, unit_price_cents, quantity, final_sale, refunded_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`${orderId}_i${idx + 1}`, orderId, item.sku, item.name, item.category, item.priceCents, qty, item.finalSale ?? false, item.refunded ? qty : 0],
    );
  }
  return { orderId, total, refunded };
}

/** Wipes all data and loads the synthetic dataset. Safe to run repeatedly. */
/**
 * Writes the support conversation behind a refund made before RefundDesk: the customer's message
 * a day before the refund, and the support team's reply at the moment it was issued.
 */
async function seedSupportConversation(
  client: pg.PoolClient,
  customerId: string,
  story: RefundStory,
  refundedAt: Date,
): Promise<string> {
  const id = `cnv_${randomUUID()}`;
  const askedAt = new Date(refundedAt.getTime() - 22 * 3_600_000);
  await client.query('INSERT INTO conversations (id, customer_id, created_at, updated_at) VALUES ($1,$2,$3,$4)', [id, customerId, askedAt, refundedAt]);
  await client.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1,$2,'customer',$3,$4), ($5,$2,'agent',$6,$7)`,
    [`msg_${randomUUID()}`, id, story.customer, askedAt, `msg_${randomUUID()}`, story.reply, refundedAt],
  );
  return id;
}

export async function reseed(): Promise<void> {
  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      'TRUNCATE audit_events, messages, refund_requests, conversations, refunds, order_items, orders, customers CASCADE',
    );
    // Demo reset also restores the original policy so every scenario behaves as documented.
    await resetPolicies(client);

    for (const c of SEED_CUSTOMERS) {
      await client.query(
        `INSERT INTO customers (id, name, email, tier, account_flags, member_since) VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.id, c.name, c.email, c.tier, c.flags ?? [], ago(now, c.memberSinceDaysAgo)],
      );

      for (const o of c.orders) {
        const { orderId, refunded } = await insertOrder(client, c.id, now, o);
        if (refunded.itemIds.length > 0) {
          const refundedAt = ago(now, Math.max(0, (o.deliveredDaysAgo ?? 0) - 3))!;
          const conversationId = o.refundStory ? await seedSupportConversation(client, c.id, o.refundStory, refundedAt) : null;
          await client.query(
            `INSERT INTO refunds (id, order_id, customer_id, amount_cents, source, item_ids, conversation_id, created_at) VALUES ($1,$2,$3,$4,'historical',$5,$6,$7)`,
            [`rfd_${orderId}`, orderId, c.id, refunded.cents, refunded.itemIds, conversationId, refundedAt],
          );
        }
      }

      // Historical orders that were refunded, so the frequency rule has real ledger data behind it.
      for (const [idx, r] of (c.pastRefunds ?? []).entries()) {
        // Earlier orders use a lower number range than the customer's current orders, as a real store's would.
        const number = `WN-09${c.id.slice(-2)}${idx + 1}`;
        const { orderId, refunded } = await insertOrder(client, c.id, now, {
          number,
          status: 'delivered',
          orderedDaysAgo: r.daysAgo + 8,
          shippedDaysAgo: r.daysAgo + 7,
          deliveredDaysAgo: r.daysAgo + 4,
          items: [{ sku: `HIS-${c.id.slice(-2)}-${idx + 1}`, name: r.name, category: r.category, priceCents: r.cents, refunded: true }],
        });
        await client.query(
          `INSERT INTO refunds (id, order_id, customer_id, amount_cents, source, item_ids, conversation_id, created_at) VALUES ($1,$2,$3,$4,'historical',$5,$6,$7)`,
          [`rfd_${orderId}`, orderId, c.id, r.cents, refunded.itemIds, await seedSupportConversation(client, c.id, r.story, ago(now, r.daysAgo)!), ago(now, r.daysAgo)],
        );
      }
    }
  });
  logger.info({ customers: SEED_CUSTOMERS.length }, 'Seeded synthetic CRM data');
}
