import type { RuleEffect } from '../domain/types.js';
import { formatCents } from '../lib/money.js';
import type { CustomRule } from './custom-rules.js';

/**
 * Thresholds a policy owner may change from the Policy Studio. Everything here is data:
 * the engine reads it, it is versioned in the database, and every case records the
 * version that decided it.
 */
export interface PolicyConfig {
  refundWindowDays: number;
  humanReviewThresholdCents: number;
  frequencyLookbackDays: number;
  frequencyMaxRefunds: number;
  lostParcelGraceDays: number;
  minExtractionConfidence: number;
  maxClarificationTurns: number;
  nonReturnableCategories: string[];
  riskAccountFlags: string[];
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  refundWindowDays: 30,
  humanReviewThresholdCents: 50_000,
  frequencyLookbackDays: 90,
  frequencyMaxRefunds: 3,
  lostParcelGraceDays: 7,
  minExtractionConfidence: 0.6,
  maxClarificationTurns: 2,
  nonReturnableCategories: ['gift_card', 'digital_download'],
  riskAccountFlags: ['chargeback_history', 'fraud_watch'],
};

/** Fixed semantics that are part of the engine, not configuration. */
export const POLICY_CONSTANTS = {
  effectiveFrom: '2026-09-01',
  /** Reasons that qualify for a refund on a delivered, eligible item. */
  qualifyingReasons: ['damaged_or_defective', 'wrong_item', 'not_as_described', 'changed_mind'] as readonly string[],
  /** Merchant-fault reasons that justify a human look even on final-sale items. */
  merchantFaultReasons: ['damaged_or_defective', 'wrong_item'] as readonly string[],
} as const;

/** The policy in force: a published version from the database, or the built-in default. */
export interface ActivePolicy {
  version: string;
  config: PolicyConfig;
  customRules: CustomRule[];
}

export const DEFAULT_POLICY: ActivePolicy = {
  version: '2026.09-r1',
  config: DEFAULT_POLICY_CONFIG,
  customRules: [],
};

export interface RuleDefinition {
  id: string;
  section: string;
  title: string;
  effect: RuleEffect;
  /** Customer-safe wording. Must never reveal risk or fraud signals. */
  customerText: string;
  custom?: boolean;
}

const BUILT_IN_IDS = [
  'ORDER_OWNERSHIP',
  'ORDER_CANCELLED',
  'CANCEL_BEFORE_SHIPMENT',
  'IN_TRANSIT',
  'LOST_PARCEL',
  'DELIVERY_CONFLICT',
  'ALREADY_REFUNDED',
  'OUTSIDE_WINDOW',
  'NON_RETURNABLE_CATEGORY',
  'FINAL_SALE',
  'FINAL_SALE_MERCHANT_FAULT',
  'QUALIFYING_REASON',
  'HIGH_VALUE',
  'REFUND_FREQUENCY',
  'ACCOUNT_FLAG',
  'CLAIM_MISMATCH',
  'MANIPULATION_ATTEMPT',
  'LOW_CONFIDENCE',
  'UNRESOLVED_CLARIFICATION',
] as const;

export type RuleId = (typeof BUILT_IN_IDS)[number];

/**
 * Built-in rules. Wording that quotes a threshold is generated from the config, so the
 * customer is never told "30 days" when the policy says 14.
 */
export function builtInRules(config: PolicyConfig): Record<RuleId, RuleDefinition> {
  const days = config.refundWindowDays;
  const threshold = formatCents(config.humanReviewThresholdCents).replace(/\.00$/, '');
  const defs: Omit<RuleDefinition, 'id'>[] = [
    { section: '8.1', title: 'Order does not belong to the signed-in customer', effect: 'DENIED', customerText: 'we could not find that order on your account' },
    { section: '6.2', title: 'Order already cancelled and refunded', effect: 'DENIED', customerText: 'this order was already cancelled and refunded in full' },
    { section: '6.1', title: 'Cancellation before shipment', effect: 'APPROVED', customerText: 'orders that have not shipped yet can be cancelled for a full refund' },
    { section: '5.1', title: 'Order is still in transit', effect: 'DENIED', customerText: 'your order is still on its way and within its expected delivery window' },
    { section: '5.2', title: 'Parcel overdue beyond grace period', effect: 'ESCALATED', customerText: 'your parcel is overdue and needs an investigation with the carrier' },
    { section: '5.3', title: 'Not-received claim conflicts with carrier delivery scan', effect: 'ESCALATED', customerText: 'the carrier shows this parcel as delivered, so we need to look into it with you' },
    { section: '7.1', title: 'Item already refunded', effect: 'DENIED', customerText: 'this item has already been refunded' },
    { section: '1.1', title: `Outside the ${days}-day refund window`, effect: 'DENIED', customerText: `refund requests must be made within ${days} days of delivery` },
    { section: '2.2', title: 'Non-refundable category (such as gift cards and digital downloads)', effect: 'DENIED', customerText: 'this type of item is not eligible for a refund' },
    { section: '2.1', title: 'Final sale item', effect: 'DENIED', customerText: 'items marked final sale are not eligible for refunds' },
    { section: '2.3', title: 'Final sale item reported damaged or incorrect', effect: 'ESCALATED', customerText: 'final sale items reported as damaged or incorrect are reviewed individually' },
    { section: '3.1', title: 'Eligible item with a qualifying reason', effect: 'APPROVED', customerText: 'the item is within the refund window and the reason qualifies' },
    { section: '4.1', title: `Refund above ${threshold} requires human review`, effect: 'ESCALATED', customerText: `refunds above ${threshold} are confirmed by a member of our team` },
    { section: '8.2', title: 'Refund frequency above threshold', effect: 'ESCALATED', customerText: 'some requests are confirmed by a specialist before a refund is issued' },
    { section: '8.3', title: 'Account carries a risk flag', effect: 'ESCALATED', customerText: 'some requests are confirmed by a specialist before a refund is issued' },
    { section: '8.4', title: 'Claim conflicts with order records', effect: 'ESCALATED', customerText: 'some details in your request need to be checked against our order records' },
    { section: '8.5', title: 'Attempt to override policy or instructions', effect: 'ESCALATED', customerText: 'some requests are confirmed by a specialist before a refund is issued' },
    { section: '8.6', title: 'Request could not be understood with enough confidence', effect: 'ESCALATED', customerText: 'we want to make sure we understand your request correctly' },
    { section: '8.7', title: 'Request still unclear after clarification attempts', effect: 'ESCALATED', customerText: 'we want to make sure we understand your request correctly without asking you to repeat yourself' },
  ];
  return Object.fromEntries(BUILT_IN_IDS.map((id, i) => [id, { id, ...defs[i]! }])) as Record<RuleId, RuleDefinition>;
}

/** Built-in rules for the default policy, for code paths that do not depend on a version. */
export const RULES = builtInRules(DEFAULT_POLICY_CONFIG);

/** Every rule a policy can trigger, built-in and custom, keyed by id. */
export function ruleCatalog(policy: ActivePolicy): Map<string, RuleDefinition> {
  const catalog = new Map<string, RuleDefinition>(Object.entries(builtInRules(policy.config)));
  policy.customRules.forEach((r, i) => {
    catalog.set(r.id, {
      id: r.id,
      section: `9.${i + 1}`,
      title: r.name,
      effect: r.effect,
      customerText: r.customerText,
      custom: true,
    });
  });
  return catalog;
}

/** Rules whose presence marks a case as a risk or security concern in the dashboard. */
export const RISK_RULES: ReadonlySet<string> = new Set<RuleId>([
  'ORDER_OWNERSHIP',
  'REFUND_FREQUENCY',
  'ACCOUNT_FLAG',
  'CLAIM_MISMATCH',
  'MANIPULATION_ATTEMPT',
  'DELIVERY_CONFLICT',
]);
