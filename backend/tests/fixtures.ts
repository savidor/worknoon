import type { Customer, Order, OrderItem } from '../src/domain/types.js';
import type { EvaluationInput } from '../src/policy/engine.js';

export const NOW = new Date('2026-09-24T12:00:00Z');
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

export const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cus_test',
  name: 'Test Customer',
  email: 'test@example.com',
  tier: 'standard',
  accountFlags: [],
  memberSince: daysAgo(400),
  ...overrides,
});

export const item = (overrides: Partial<OrderItem> = {}): OrderItem => ({
  id: 'itm_1',
  sku: 'SKU-1',
  name: 'Test Item',
  category: 'electronics',
  unitPriceCents: 10_000,
  quantity: 1,
  finalSale: false,
  refundedQuantity: 0,
  ...overrides,
});

export const order = (overrides: Partial<Order> = {}): Order => ({
  id: 'ord_1',
  orderNumber: 'WN-99999',
  customerId: 'cus_test',
  status: 'delivered',
  orderedAt: daysAgo(10),
  shippedAt: daysAgo(9),
  deliveredAt: daysAgo(5),
  expectedDeliveryAt: daysAgo(5),
  carrierTracking: '1Z',
  totalCents: 10_000,
  currency: 'USD',
  items: [item()],
  ...overrides,
});

export const input = (overrides: Partial<EvaluationInput> = {}): EvaluationInput => ({
  now: NOW,
  customer: customer(),
  order: order(),
  reason: 'damaged_or_defective',
  requestedItemIds: null,
  signals: { refundsInLookback: 0, manipulationSignals: [], confidence: 0.9, claimMismatches: [] },
  ...overrides,
});
