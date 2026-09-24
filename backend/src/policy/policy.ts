import type { RuleEffect } from '../domain/types.js';

/**
 * Machine-readable refund policy. docs/refund-policy.md is the human-readable version
 * and must be kept in sync; tests assert the documented thresholds match these values.
 */
export const POLICY = {
  version: '2026.09-r1',
  effectiveFrom: '2026-09-01',
  refundWindowDays: 30,
  humanReviewThresholdCents: 50_000,
  frequencyLookbackDays: 90,
  frequencyMaxRefunds: 3,
  lostParcelGraceDays: 7,
  minExtractionConfidence: 0.6,
  maxClarificationTurns: 2,
  nonReturnableCategories: ['gift_card', 'digital_download'] as readonly string[],
  riskAccountFlags: ['chargeback_history', 'fraud_watch'] as readonly string[],
  /** Reasons that qualify for a refund on a delivered, eligible item. */
  qualifyingReasons: ['damaged_or_defective', 'wrong_item', 'not_as_described', 'changed_mind'] as readonly string[],
  /** Merchant-fault reasons that justify a human look even on final-sale items. */
  merchantFaultReasons: ['damaged_or_defective', 'wrong_item'] as readonly string[],
} as const;

export interface RuleDefinition {
  id: string;
  section: string;
  title: string;
  effect: RuleEffect;
  /** Customer-safe wording. Must never reveal risk or fraud signals. */
  customerText: string;
}

const rules = [
  {
    id: 'ORDER_OWNERSHIP',
    section: '8.1',
    title: 'Order does not belong to the signed-in customer',
    effect: 'DENIED',
    customerText: 'we could not find that order on your account',
  },
  {
    id: 'ORDER_CANCELLED',
    section: '6.2',
    title: 'Order already cancelled and refunded',
    effect: 'DENIED',
    customerText: 'this order was already cancelled and refunded in full',
  },
  {
    id: 'CANCEL_BEFORE_SHIPMENT',
    section: '6.1',
    title: 'Cancellation before shipment',
    effect: 'APPROVED',
    customerText: 'orders that have not shipped yet can be cancelled for a full refund',
  },
  {
    id: 'IN_TRANSIT',
    section: '5.1',
    title: 'Order is still in transit',
    effect: 'DENIED',
    customerText: 'your order is still on its way and within its expected delivery window',
  },
  {
    id: 'LOST_PARCEL',
    section: '5.2',
    title: 'Parcel overdue beyond grace period',
    effect: 'ESCALATED',
    customerText: 'your parcel is overdue and needs an investigation with the carrier',
  },
  {
    id: 'DELIVERY_CONFLICT',
    section: '5.3',
    title: 'Not-received claim conflicts with carrier delivery scan',
    effect: 'ESCALATED',
    customerText: 'the carrier shows this parcel as delivered, so we need to look into it with you',
  },
  {
    id: 'ALREADY_REFUNDED',
    section: '7.1',
    title: 'Item already refunded',
    effect: 'DENIED',
    customerText: 'this item has already been refunded',
  },
  {
    id: 'OUTSIDE_WINDOW',
    section: '1.1',
    title: 'Outside the 30-day refund window',
    effect: 'DENIED',
    customerText: 'refund requests must be made within 30 days of delivery',
  },
  {
    id: 'NON_RETURNABLE_CATEGORY',
    section: '2.2',
    title: 'Gift cards and digital downloads are non-refundable',
    effect: 'DENIED',
    customerText: 'gift cards and digital downloads are not eligible for refunds',
  },
  {
    id: 'FINAL_SALE',
    section: '2.1',
    title: 'Final sale item',
    effect: 'DENIED',
    customerText: 'items marked final sale are not eligible for refunds',
  },
  {
    id: 'FINAL_SALE_MERCHANT_FAULT',
    section: '2.3',
    title: 'Final sale item reported damaged or incorrect',
    effect: 'ESCALATED',
    customerText: 'final sale items reported as damaged or incorrect are reviewed individually',
  },
  {
    id: 'QUALIFYING_REASON',
    section: '3.1',
    title: 'Eligible item with a qualifying reason',
    effect: 'APPROVED',
    customerText: 'the item is within the refund window and the reason qualifies',
  },
  {
    id: 'HIGH_VALUE',
    section: '4.1',
    title: 'Refund above $500 requires human review',
    effect: 'ESCALATED',
    customerText: 'refunds above $500 are confirmed by a member of our team',
  },
  {
    id: 'REFUND_FREQUENCY',
    section: '8.2',
    title: 'Refund frequency above threshold',
    effect: 'ESCALATED',
    customerText: 'some requests are confirmed by a specialist before a refund is issued',
  },
  {
    id: 'ACCOUNT_FLAG',
    section: '8.3',
    title: 'Account carries a risk flag',
    effect: 'ESCALATED',
    customerText: 'some requests are confirmed by a specialist before a refund is issued',
  },
  {
    id: 'CLAIM_MISMATCH',
    section: '8.4',
    title: 'Claim conflicts with order records',
    effect: 'ESCALATED',
    customerText: 'some details in your request need to be checked against our order records',
  },
  {
    id: 'MANIPULATION_ATTEMPT',
    section: '8.5',
    title: 'Attempt to override policy or instructions',
    effect: 'ESCALATED',
    customerText: 'some requests are confirmed by a specialist before a refund is issued',
  },
  {
    id: 'LOW_CONFIDENCE',
    section: '8.6',
    title: 'Request could not be understood with enough confidence',
    effect: 'ESCALATED',
    customerText: 'we want to make sure we understand your request correctly',
  },
  {
    id: 'UNRESOLVED_CLARIFICATION',
    section: '8.7',
    title: 'Request still unclear after clarification attempts',
    effect: 'ESCALATED',
    customerText: 'we want to make sure we understand your request correctly without asking you to repeat yourself',
  },
] as const satisfies readonly RuleDefinition[];

export type RuleId = (typeof rules)[number]['id'];

export const RULES: Record<RuleId, RuleDefinition> = Object.fromEntries(
  rules.map((r) => [r.id, r]),
) as Record<RuleId, RuleDefinition>;

/** Rules whose presence marks a case as a risk or security concern in the dashboard. */
export const RISK_RULES: ReadonlySet<string> = new Set<RuleId>([
  'ORDER_OWNERSHIP',
  'REFUND_FREQUENCY',
  'ACCOUNT_FLAG',
  'CLAIM_MISMATCH',
  'MANIPULATION_ATTEMPT',
  'DELIVERY_CONFLICT',
]);
