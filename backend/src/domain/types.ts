export type Decision = 'APPROVED' | 'DENIED' | 'ESCALATED';

/**
 * What a single customer turn resolves to. Only Decision values create a refund case;
 * NEEDS_INFO asks a clarifying question and INFO answers a non-refund question.
 */
export type Outcome = Decision | 'NEEDS_INFO' | 'INFO';

export const REASON_CATEGORIES = [
  'damaged_or_defective',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'not_received',
  'cancel_order',
  'unknown',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const INTENTS = ['refund_request', 'cancel_request', 'order_inquiry', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

export type OrderStatus = 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: 'standard' | 'silver' | 'gold';
  accountFlags: string[];
  memberSince: Date;
}

export interface OrderItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  quantity: number;
  finalSale: boolean;
  refundedQuantity: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  orderedAt: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  expectedDeliveryAt: Date | null;
  carrierTracking: string | null;
  totalCents: number;
  currency: string;
  items: OrderItem[];
}

/** Structured facts the AI layer extracts from a customer's message. Never trusted blindly. */
export interface Extraction {
  intent: Intent;
  orderNumber: string | null;
  itemSkus: string[];
  reasonCategory: ReasonCategory;
  reasonSummary: string;
  claimedAmount: number | null;
  unknownItemMentions: string[];
  manipulationSignals: string[];
  confidence: number;
}

export type RuleEffect = Decision | 'FLAG';

export interface TriggeredRule {
  id: string;
  effect: RuleEffect;
  /** Plain-language explanation for support agents. */
  detail: string;
  /** Item the rule applied to, when it is item-scoped. */
  itemId?: string;
}

export interface LineDecision {
  itemId: string;
  sku: string;
  name: string;
  amountCents: number;
  decision: Decision;
  ruleIds: string[];
}

export interface PolicyEvaluation {
  decision: Decision;
  lines: LineDecision[];
  rules: TriggeredRule[];
  riskFlags: string[];
  refundAmountCents: number;
  reviewAmountCents: number;
}

export interface TraceStep {
  stage: string;
  ms: number;
  status: 'ok' | 'warn' | 'fallback' | 'error';
  note?: string;
  data?: unknown;
}
