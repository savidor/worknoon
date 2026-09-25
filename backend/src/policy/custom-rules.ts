import { REASON_CATEGORIES } from '../domain/types.js';

/**
 * Custom rules let a policy owner tighten the refund policy without a deploy.
 *
 * Safety properties, all enforced here and in the schema:
 *  - Conditions come from a fixed catalogue of fields and operators. Nothing a user types
 *    is ever executed; values are only compared.
 *  - A custom rule can DENY or ESCALATE. It can never APPROVE, so it cannot weaken the
 *    built-in protections (final sale, refund window, fraud checks, identity).
 *  - Evaluation is pure and deterministic, like the rest of the engine.
 */

export type FieldType = 'enum' | 'string' | 'money' | 'number' | 'boolean';

export interface FieldSpec {
  label: string;
  type: FieldType;
  help: string;
  options?: readonly string[];
}

export const ORDER_STATUSES = ['processing', 'shipped', 'delivered', 'cancelled'] as const;
export const CUSTOMER_TIERS = ['standard', 'silver', 'gold'] as const;

export const FIELDS = {
  'item.category': { label: 'Item category', type: 'string', help: 'Product category, for example electronics or apparel' },
  'item.sku': { label: 'Item SKU', type: 'string', help: 'Exact product code' },
  'item.price': { label: 'Item price', type: 'money', help: 'Line value in dollars' },
  'item.final_sale': { label: 'Item is final sale', type: 'boolean', help: 'Marked final sale at checkout' },
  'order.total': { label: 'Order total', type: 'money', help: 'Whole order value in dollars' },
  'order.status': { label: 'Order status', type: 'enum', options: ORDER_STATUSES, help: 'Fulfilment status' },
  reason: { label: 'Refund reason', type: 'enum', options: REASON_CATEGORIES.filter((r) => r !== 'unknown'), help: 'Reason the customer gave' },
  days_since_delivery: { label: 'Days since delivery', type: 'number', help: 'Only matches delivered orders' },
  'customer.tier': { label: 'Customer tier', type: 'enum', options: CUSTOMER_TIERS, help: 'Loyalty tier' },
  'customer.tenure_days': { label: 'Customer tenure (days)', type: 'number', help: 'Days since the account was created' },
  'customer.recent_refunds': { label: 'Recent refunds', type: 'number', help: 'Refunds in the policy lookback period' },
} as const satisfies Record<string, FieldSpec>;

export type FieldKey = keyof typeof FIELDS;
export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];

export const OPERATORS = {
  eq: { label: 'is', types: ['enum', 'string', 'money', 'number'] },
  neq: { label: 'is not', types: ['enum', 'string', 'money', 'number'] },
  in: { label: 'is one of', types: ['enum', 'string'] },
  not_in: { label: 'is not one of', types: ['enum', 'string'] },
  contains: { label: 'contains', types: ['string'] },
  gt: { label: 'is greater than', types: ['money', 'number'] },
  gte: { label: 'is at least', types: ['money', 'number'] },
  lt: { label: 'is less than', types: ['money', 'number'] },
  lte: { label: 'is at most', types: ['money', 'number'] },
  is_true: { label: 'is yes', types: ['boolean'] },
  is_false: { label: 'is no', types: ['boolean'] },
} as const satisfies Record<string, { label: string; types: readonly FieldType[] }>;

export type OperatorKey = keyof typeof OPERATORS;
export const OPERATOR_KEYS = Object.keys(OPERATORS) as OperatorKey[];

/** Money values are stored in cents; lists are arrays of strings; booleans need no value. */
export type ConditionValue = string | number | string[] | null;

export interface Condition {
  field: FieldKey;
  operator: OperatorKey;
  value: ConditionValue;
}

export interface CustomRule {
  id: string;
  name: string;
  enabled: boolean;
  effect: 'DENIED' | 'ESCALATED';
  conditions: Condition[];
  customerText: string;
}

/** The facts a condition can see for one order line. Null means "not applicable". */
export interface LineFacts {
  'item.category': string;
  'item.sku': string;
  'item.price': number;
  'item.final_sale': boolean;
  'order.total': number;
  'order.status': string;
  reason: string;
  days_since_delivery: number | null;
  'customer.tier': string;
  'customer.tenure_days': number;
  'customer.recent_refunds': number;
}

const norm = (v: unknown) => String(v).trim().toLowerCase();

export function conditionMatches(c: Condition, facts: LineFacts): boolean {
  const actual = facts[c.field];
  if (actual === null || actual === undefined) return false;
  const list = Array.isArray(c.value) ? c.value.map(norm) : [];
  switch (c.operator) {
    case 'eq':
      return typeof actual === 'number' ? actual === Number(c.value) : norm(actual) === norm(c.value);
    case 'neq':
      return typeof actual === 'number' ? actual !== Number(c.value) : norm(actual) !== norm(c.value);
    case 'in':
      return list.includes(norm(actual));
    case 'not_in':
      return !list.includes(norm(actual));
    case 'contains':
      return norm(actual).includes(norm(c.value));
    case 'gt':
      return Number(actual) > Number(c.value);
    case 'gte':
      return Number(actual) >= Number(c.value);
    case 'lt':
      return Number(actual) < Number(c.value);
    case 'lte':
      return Number(actual) <= Number(c.value);
    case 'is_true':
      return actual === true;
    case 'is_false':
      return actual === false;
  }
}

/** A rule matches a line when it is enabled and every condition holds (logical AND). */
export function ruleMatches(rule: CustomRule, facts: LineFacts): boolean {
  return rule.enabled && rule.conditions.length > 0 && rule.conditions.every((c) => conditionMatches(c, facts));
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

/** Plain-English rendering, used in the UI, the policy document and audit details. */
export function describeCondition(c: Condition): string {
  const f = FIELDS[c.field];
  const op = OPERATORS[c.operator].label;
  if (f.type === 'boolean') return `${f.label.toLowerCase()} ${op}`;
  const value = Array.isArray(c.value)
    ? c.value.join(', ')
    : f.type === 'money'
      ? money(Number(c.value))
      : String(c.value).replaceAll('_', ' ');
  return `${f.label.toLowerCase()} ${op} ${value}`;
}

export function describeRule(rule: CustomRule): string {
  const when = rule.conditions.map(describeCondition).join(' and ');
  return `If ${when}, ${rule.effect === 'DENIED' ? 'the item is not eligible' : 'a specialist reviews the request'}.`;
}
