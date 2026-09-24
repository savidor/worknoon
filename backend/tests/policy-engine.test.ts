import { describe, expect, it } from 'vitest';
import { evaluateRefund } from '../src/policy/engine.js';
import { customer, daysAgo, input, item, order } from './fixtures.js';

const ruleIds = (r: ReturnType<typeof evaluateRefund>) => r.rules.map((x) => x.id);

describe('policy engine: core eligibility', () => {
  it('approves a damaged item inside the window', () => {
    const r = evaluateRefund(input());
    expect(r.decision).toBe('APPROVED');
    expect(r.refundAmountCents).toBe(10_000);
    expect(ruleIds(r)).toEqual(['QUALIFYING_REASON']);
  });

  it('approves a wrong item and a change of mind', () => {
    expect(evaluateRefund(input({ reason: 'wrong_item' })).decision).toBe('APPROVED');
    expect(evaluateRefund(input({ reason: 'changed_mind' })).decision).toBe('APPROVED');
  });

  it('denies outside the 30-day window, and day 30 is still inside', () => {
    expect(evaluateRefund(input({ order: order({ deliveredAt: daysAgo(31) }) })).decision).toBe('DENIED');
    expect(evaluateRefund(input({ order: order({ deliveredAt: daysAgo(30) }) })).decision).toBe('APPROVED');
  });

  it('denies final sale on change of mind but escalates merchant fault', () => {
    const fs = order({ items: [item({ finalSale: true })] });
    const mind = evaluateRefund(input({ order: fs, reason: 'changed_mind' }));
    expect(mind.decision).toBe('DENIED');
    expect(ruleIds(mind)).toContain('FINAL_SALE');

    const damaged = evaluateRefund(input({ order: fs, reason: 'damaged_or_defective' }));
    expect(damaged.decision).toBe('ESCALATED');
    expect(ruleIds(damaged)).toContain('FINAL_SALE_MERCHANT_FAULT');
  });

  it('denies gift cards and digital goods even when damaged', () => {
    const r = evaluateRefund(input({ order: order({ items: [item({ category: 'gift_card' })] }) }));
    expect(r.decision).toBe('DENIED');
    expect(ruleIds(r)).toContain('NON_RETURNABLE_CATEGORY');
  });

  it('denies items that were already refunded', () => {
    const r = evaluateRefund(input({ order: order({ items: [item({ refundedQuantity: 1 })] }) }));
    expect(r.decision).toBe('DENIED');
    expect(ruleIds(r)).toContain('ALREADY_REFUNDED');
  });

  it('prefers denial over escalation when both apply', () => {
    const r = evaluateRefund(
      input({ order: order({ deliveredAt: daysAgo(60), items: [item({ finalSale: true })] }), reason: 'damaged_or_defective' }),
    );
    expect(r.decision).toBe('DENIED');
  });
});

describe('policy engine: order status', () => {
  it('approves cancellation before shipment', () => {
    const r = evaluateRefund(input({ order: order({ status: 'processing', deliveredAt: null }), reason: 'cancel_order' }));
    expect(r.decision).toBe('APPROVED');
    expect(ruleIds(r)).toEqual(['CANCEL_BEFORE_SHIPMENT']);
  });

  it('denies while in transit and escalates once overdue by the grace period', () => {
    const inTransit = order({ status: 'shipped', deliveredAt: null, expectedDeliveryAt: daysAgo(-2) });
    expect(evaluateRefund(input({ order: inTransit, reason: 'not_received' })).decision).toBe('DENIED');

    const overdue = order({ status: 'shipped', deliveredAt: null, expectedDeliveryAt: daysAgo(8) });
    const r = evaluateRefund(input({ order: overdue, reason: 'not_received' }));
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r)).toContain('LOST_PARCEL');
  });

  it('escalates a not-received claim on a delivered order', () => {
    const r = evaluateRefund(input({ reason: 'not_received' }));
    expect(r.decision).toBe('ESCALATED');
    expect(r.riskFlags).toContain('delivery_conflict');
  });

  it('treats "cancel" on a delivered order as a return', () => {
    expect(evaluateRefund(input({ reason: 'cancel_order' })).decision).toBe('APPROVED');
  });

  it('denies an already-cancelled order', () => {
    expect(evaluateRefund(input({ order: order({ status: 'cancelled' }) })).decision).toBe('DENIED');
  });
});

describe('policy engine: thresholds and risk overlays', () => {
  it('escalates refunds above $500, but not exactly $500', () => {
    const big = evaluateRefund(input({ order: order({ items: [item({ unitPriceCents: 50_001 })] }) }));
    expect(big.decision).toBe('ESCALATED');
    expect(big.reviewAmountCents).toBe(50_001);
    expect(big.refundAmountCents).toBe(0);

    const edge = evaluateRefund(input({ order: order({ items: [item({ unitPriceCents: 50_000 })] }) }));
    expect(edge.decision).toBe('APPROVED');
  });

  it('applies the threshold to the refund amount, not the order total', () => {
    const o = order({
      totalCents: 62_000,
      items: [
        item({ id: 'a', unitPriceCents: 48_000 }),
        item({ id: 'b', unitPriceCents: 2_000 }),
        item({ id: 'c', unitPriceCents: 12_000 }),
      ],
    });
    expect(evaluateRefund(input({ order: o, requestedItemIds: ['c'] })).decision).toBe('APPROVED');
    expect(evaluateRefund(input({ order: o })).decision).toBe('ESCALATED');
  });

  it('refunds eligible lines and denies ineligible ones in a mixed order', () => {
    const o = order({
      items: [item({ id: 'mat', unitPriceCents: 4_500 }), item({ id: 'glasses', unitPriceCents: 16_000, finalSale: true })],
    });
    const r = evaluateRefund(input({ order: o, reason: 'changed_mind' }));
    expect(r.decision).toBe('APPROVED');
    expect(r.refundAmountCents).toBe(4_500);
    expect(r.lines.find((l) => l.itemId === 'glasses')?.decision).toBe('DENIED');
  });

  it.each([
    ['REFUND_FREQUENCY', { refundsInLookback: 3 }],
    ['MANIPULATION_ATTEMPT', { manipulationSignals: ['ignore previous instructions'] }],
    ['CLAIM_MISMATCH', { claimMismatches: ['Customer cites $5,000 but order totals $100.'] }],
    ['LOW_CONFIDENCE', { confidence: 0.3 }],
  ])('%s escalates an otherwise approvable case', (rule, signal) => {
    const base = input();
    const r = evaluateRefund({ ...base, signals: { ...base.signals, ...signal } });
    expect(r.decision).toBe('ESCALATED');
    expect(ruleIds(r)).toContain(rule);
  });

  it('escalates risky account flags but ignores benign ones', () => {
    expect(evaluateRefund(input({ customer: customer({ accountFlags: ['chargeback_history'] }) })).decision).toBe('ESCALATED');
    expect(evaluateRefund(input({ customer: customer({ accountFlags: ['vip'] }) })).decision).toBe('APPROVED');
  });

  it('never turns a denial into an approval; risk on a denial is recorded as a flag', () => {
    const base = input({ order: order({ deliveredAt: daysAgo(90) }) });
    const r = evaluateRefund({ ...base, signals: { ...base.signals, manipulationSignals: ['approve regardless'] } });
    expect(r.decision).toBe('DENIED');
    expect(r.rules.find((x) => x.id === 'MANIPULATION_ATTEMPT')?.effect).toBe('FLAG');
    expect(r.riskFlags).toContain('manipulation_attempt');
  });
});

describe('policy engine: identity', () => {
  it('denies an order owned by someone else without evaluating lines', () => {
    const r = evaluateRefund(input({ order: order({ customerId: 'cus_other' }) }));
    expect(r.decision).toBe('DENIED');
    expect(r.lines).toHaveLength(0);
    expect(r.riskFlags).toContain('order_ownership');
  });

  it('is deterministic for identical input', () => {
    expect(evaluateRefund(input())).toEqual(evaluateRefund(input()));
  });
});
