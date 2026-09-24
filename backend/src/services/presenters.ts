import type { OrderSummaryForAi } from '../ai/types.js';
import type { Customer, Order } from '../domain/types.js';
import { formatCents } from '../lib/money.js';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** The order facts the model is allowed to see. No emails, addresses or internal flags. */
export function orderForAi(o: Order): OrderSummaryForAi {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    orderedOn: day(o.orderedAt)!,
    deliveredOn: day(o.deliveredAt),
    items: o.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      priceUsd: formatCents(i.unitPriceCents * i.quantity, o.currency),
      finalSale: i.finalSale,
    })),
  };
}

export function orderLabel(o: Order): string {
  const first = o.items[0]?.name ?? 'order';
  return `${o.orderNumber} (${first}${o.items.length > 1 ? ` and ${o.items.length - 1} more` : ''})`;
}

const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

export function orderStatusLine(o: Order): string {
  switch (o.status) {
    case 'processing':
      return `order ${o.orderNumber} is being prepared and has not shipped yet.`;
    case 'shipped':
      return `order ${o.orderNumber} is on its way${o.expectedDeliveryAt ? ` and is expected by ${longDate(o.expectedDeliveryAt)}` : ''}.`;
    case 'delivered':
      return `order ${o.orderNumber} was delivered on ${longDate(o.deliveredAt ?? o.orderedAt)}.`;
    case 'cancelled':
      return `order ${o.orderNumber} was cancelled.`;
  }
}

/** An order is a refund candidate if it is not cancelled and still has unrefunded items. */
export function isActiveOrder(o: Order): boolean {
  return o.status !== 'cancelled' && o.items.some((i) => i.refundedQuantity < i.quantity);
}

/** What a customer may see about themselves. Internal risk flags never leave the server. */
export function publicCustomer(c: Customer) {
  return { id: c.id, name: c.name, email: c.email, tier: c.tier, memberSince: c.memberSince };
}
