import { describe, expect, it } from 'vitest';
import { conditionMatches, describeRule, ruleMatches, type CustomRule, type LineFacts } from '../src/policy/custom-rules.js';
import { evaluateRefund } from '../src/policy/engine.js';
import { DEFAULT_POLICY, DEFAULT_POLICY_CONFIG, type ActivePolicy } from '../src/policy/policy.js';
import { normalizeDraft } from '../src/policy/policy-schema.js';
import { customer, daysAgo, input, item, order } from './fixtures.js';

const facts: LineFacts = {
  'item.category': 'Electronics',
  'item.sku': 'CMP-LT-914',
  'item.price': 12_900,
  'item.final_sale': false,
  'order.total': 12_900,
  'order.status': 'delivered',
  reason: 'changed_mind',
  days_since_delivery: 20,
  'customer.tier': 'gold',
  'customer.tenure_days': 400,
  'customer.recent_refunds': 1,
};

const openedElectronics: CustomRule = {
  id: 'CUSTOM_OPENED_ELECTRONICS',
  name: 'Opened electronics',
  enabled: true,
  effect: 'DENIED',
  customerText: 'electronics cannot be returned for a change of mind after 14 days',
  conditions: [
    { field: 'item.category', operator: 'eq', value: 'electronics' },
    { field: 'reason', operator: 'eq', value: 'changed_mind' },
    { field: 'days_since_delivery', operator: 'gt', value: 14 },
  ],
};

const withRules = (...customRules: CustomRule[]): ActivePolicy => ({ ...DEFAULT_POLICY, version: 'test', customRules });

describe('custom rule conditions', () => {
  it.each([
    [{ field: 'item.category', operator: 'eq', value: 'electronics' }, true],
    [{ field: 'item.category', operator: 'in', value: ['apparel', 'ELECTRONICS'] }, true],
    [{ field: 'item.category', operator: 'not_in', value: ['electronics'] }, false],
    [{ field: 'item.sku', operator: 'contains', value: 'lt-9' }, true],
    [{ field: 'item.price', operator: 'gte', value: 12_900 }, true],
    [{ field: 'item.price', operator: 'gt', value: 12_900 }, false],
    [{ field: 'item.final_sale', operator: 'is_false', value: null }, true],
    [{ field: 'customer.tier', operator: 'neq', value: 'standard' }, true],
    [{ field: 'customer.recent_refunds', operator: 'lt', value: 2 }, true],
  ] as const)('%o -> %s', (condition, expected) => {
    expect(conditionMatches(condition as never, facts)).toBe(expected);
  });

  it('never matches a delivery-age condition on an undelivered order', () => {
    expect(conditionMatches({ field: 'days_since_delivery', operator: 'gte', value: 0 }, { ...facts, days_since_delivery: null })).toBe(false);
  });

  it('requires every condition and an enabled rule', () => {
    expect(ruleMatches(openedElectronics, facts)).toBe(true);
    expect(ruleMatches(openedElectronics, { ...facts, days_since_delivery: 10 })).toBe(false);
    expect(ruleMatches({ ...openedElectronics, enabled: false }, facts)).toBe(false);
  });

  it('describes itself in plain English', () => {
    expect(describeRule(openedElectronics)).toBe(
      'If item category is electronics and refund reason is changed mind and days since delivery is greater than 14, the item is not eligible.',
    );
  });
});

describe('engine with a published policy', () => {
  const laptop = order({ deliveredAt: daysAgo(20), items: [item({ category: 'electronics' })] });

  it('applies a custom deny rule on top of the built-in rules', () => {
    const base = evaluateRefund(input({ order: laptop, reason: 'changed_mind' }));
    expect(base.decision).toBe('APPROVED');
    const r = evaluateRefund(input({ order: laptop, reason: 'changed_mind' }), withRules(openedElectronics));
    expect(r.decision).toBe('DENIED');
    expect(r.rules.map((x) => x.id)).toContain('CUSTOM_OPENED_ELECTRONICS');
  });

  it('leaves unrelated requests untouched', () => {
    const r = evaluateRefund(input({ order: laptop, reason: 'damaged_or_defective' }), withRules(openedElectronics));
    expect(r.decision).toBe('APPROVED');
  });

  it('escalates with a custom review rule, per item', () => {
    const vipReview: CustomRule = {
      ...openedElectronics,
      id: 'CUSTOM_BIG_TICKET',
      name: 'Big ticket items',
      effect: 'ESCALATED',
      conditions: [{ field: 'item.price', operator: 'gt', value: 20_000 }],
    };
    const mixed = order({ items: [item({ id: 'a', unitPriceCents: 25_000 }), item({ id: 'b', unitPriceCents: 3_000 })] });
    const r = evaluateRefund(input({ order: mixed }), withRules(vipReview));
    expect(r.decision).toBe('ESCALATED');
    expect(r.lines.find((l) => l.itemId === 'a')?.decision).toBe('ESCALATED');
    expect(r.lines.find((l) => l.itemId === 'b')?.decision).toBe('APPROVED');
  });

  it('uses published thresholds instead of the defaults', () => {
    const shortWindow: ActivePolicy = { ...DEFAULT_POLICY, config: { ...DEFAULT_POLICY_CONFIG, refundWindowDays: 14 } };
    expect(evaluateRefund(input({ order: order({ deliveredAt: daysAgo(20) }) })).decision).toBe('APPROVED');
    expect(evaluateRefund(input({ order: order({ deliveredAt: daysAgo(20) }) }), shortWindow).decision).toBe('DENIED');

    const bigTicket: ActivePolicy = { ...DEFAULT_POLICY, config: { ...DEFAULT_POLICY_CONFIG, humanReviewThresholdCents: 150_000 } };
    const laptop1299 = order({ items: [item({ unitPriceCents: 129_900 })] });
    expect(evaluateRefund(input({ order: laptop1299 })).decision).toBe('ESCALATED');
    expect(evaluateRefund(input({ order: laptop1299 }), bigTicket).decision).toBe('APPROVED');
  });

  it('cannot let a custom rule weaken identity protection', () => {
    const r = evaluateRefund(input({ order: order({ customerId: 'someone_else' }), customer: customer() }), withRules(openedElectronics));
    expect(r.decision).toBe('DENIED');
    expect(r.rules.map((x) => x.id)).toEqual(['ORDER_OWNERSHIP']);
  });
});

describe('policy draft validation', () => {
  const draft = (rule: Record<string, unknown>, config = DEFAULT_POLICY_CONFIG) => ({ config, customRules: [rule] });
  const { id: _omit, ...newRule } = openedElectronics;

  it('accepts a valid draft and assigns a stable id', () => {
    const d = normalizeDraft(draft(newRule));
    expect(d.customRules[0]!.id).toBe('CUSTOM_OPENED_ELECTRONICS');
  });

  it('refuses custom approvals: rules can only tighten the policy', () => {
    expect(() => normalizeDraft(draft({ ...newRule, effect: 'APPROVED' }))).toThrow();
  });

  it('refuses operators that do not fit the field', () => {
    expect(() => normalizeDraft(draft({ ...newRule, conditions: [{ field: 'item.final_sale', operator: 'gt', value: 3 }] }))).toThrow(/cannot be used/);
    expect(() => normalizeDraft(draft({ ...newRule, conditions: [{ field: 'reason', operator: 'eq', value: 'bored' }] }))).toThrow(/Unknown refund reason/);
    expect(() => normalizeDraft(draft({ ...newRule, conditions: [{ field: 'item.price', operator: 'gt', value: 'abc' }] }))).toThrow(/positive number/);
  });

  it('refuses customer wording that leaks internal terms or markup', () => {
    expect(() => normalizeDraft(draft({ ...newRule, customerText: 'your account is flagged for fraud checks' }))).toThrow(/must not mention/);
    expect(() => normalizeDraft(draft({ ...newRule, customerText: '<b>not eligible</b> for refunds' }))).toThrow(/Plain text/);
  });

  it('refuses absurd thresholds', () => {
    expect(() => normalizeDraft(draft(newRule, { ...DEFAULT_POLICY_CONFIG, refundWindowDays: 0 }))).toThrow();
    expect(() => normalizeDraft(draft(newRule, { ...DEFAULT_POLICY_CONFIG, humanReviewThresholdCents: 5 }))).toThrow();
  });

  it('refuses duplicate rule names', () => {
    expect(() => normalizeDraft({ config: DEFAULT_POLICY_CONFIG, customRules: [newRule, newRule] })).toThrow(/unique/);
  });
});
