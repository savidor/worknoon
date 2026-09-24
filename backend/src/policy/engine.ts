import type {
  Customer,
  Decision,
  LineDecision,
  Order,
  OrderItem,
  PolicyEvaluation,
  ReasonCategory,
  TriggeredRule,
} from '../domain/types.js';
import { daysBetween, formatCents } from '../lib/money.js';
import { POLICY, RISK_RULES, RULES, type RuleId } from './policy.js';

export interface EvaluationInput {
  now: Date;
  customer: Customer;
  order: Order;
  reason: ReasonCategory;
  /** Item ids the customer asked about. Null means the whole order. */
  requestedItemIds: string[] | null;
  signals: {
    refundsInLookback: number;
    manipulationSignals: string[];
    confidence: number;
    claimMismatches: string[];
  };
}

const SEVERITY: Record<Decision, number> = { APPROVED: 0, ESCALATED: 1, DENIED: 2 };

function mostRestrictive(decisions: Decision[]): Decision {
  return decisions.reduce<Decision>((acc, d) => (SEVERITY[d] > SEVERITY[acc] ? d : acc), 'APPROVED');
}

function remainingQuantity(item: OrderItem): number {
  return item.quantity - item.refundedQuantity;
}

function lineAmount(item: OrderItem): number {
  const qty = remainingQuantity(item) > 0 ? remainingQuantity(item) : item.quantity;
  return item.unitPriceCents * qty;
}

/**
 * Deterministic refund policy evaluation.
 *
 * This function is the only component allowed to decide a refund. It reads facts from
 * the order record, never from the customer's wording, and it is pure: the same input
 * always yields the same decision, which makes every outcome reproducible in an audit.
 *
 * Precedence: DENIED > ESCALATED > APPROVED. Risk rules can move an approval to human
 * review but can never turn a denial into an approval.
 */
export function evaluateRefund(input: EvaluationInput): PolicyEvaluation {
  const { now, customer, order, signals } = input;
  const rules: TriggeredRule[] = [];
  const trigger = (id: RuleId, detail: string, itemId?: string, effect = RULES[id].effect) => {
    rules.push({ id, effect, detail, ...(itemId && { itemId }) });
  };

  // 8.1 Identity comes from the authenticated session, never from the message.
  if (order.customerId !== customer.id) {
    trigger('ORDER_OWNERSHIP', `Order ${order.orderNumber} belongs to a different customer.`);
    return finalize('DENIED', [], rules);
  }

  const requested = input.requestedItemIds
    ? order.items.filter((i) => input.requestedItemIds!.includes(i.id))
    : order.items;
  const items = requested.length > 0 ? requested : order.items;

  // A "cancel" on a delivered order is a return.
  const reason: ReasonCategory =
    input.reason === 'cancel_order' && order.status === 'delivered' ? 'changed_mind' : input.reason;

  const lines: LineDecision[] = items.map((item) => {
    const lineRules: RuleId[] = [];
    const hit = (id: RuleId, detail: string) => {
      lineRules.push(id);
      trigger(id, detail, item.id);
    };

    if (remainingQuantity(item) <= 0) {
      hit('ALREADY_REFUNDED', `${item.name} was already refunded in full.`);
    }

    switch (order.status) {
      case 'cancelled':
        hit('ORDER_CANCELLED', `Order was cancelled; nothing left to refund.`);
        break;

      case 'processing':
        hit('CANCEL_BEFORE_SHIPMENT', `Order has not shipped; ${item.name} can be cancelled.`);
        break;

      case 'shipped': {
        const expected = order.expectedDeliveryAt ?? now;
        const overdueDays = daysBetween(expected, now);
        if (overdueDays >= POLICY.lostParcelGraceDays) {
          hit('LOST_PARCEL', `Parcel is ${overdueDays} days past its expected delivery date.`);
        } else {
          hit('IN_TRANSIT', `Parcel expected ${expected.toISOString().slice(0, 10)}; still in transit.`);
        }
        break;
      }

      case 'delivered': {
        if (reason === 'not_received') {
          hit('DELIVERY_CONFLICT', `Customer reports non-receipt but carrier confirmed delivery.`);
          break;
        }
        const delivered = order.deliveredAt ?? order.orderedAt;
        const age = daysBetween(delivered, now);
        if (age > POLICY.refundWindowDays) {
          hit('OUTSIDE_WINDOW', `Delivered ${age} days ago; window is ${POLICY.refundWindowDays} days.`);
        }
        if (POLICY.nonReturnableCategories.includes(item.category)) {
          hit('NON_RETURNABLE_CATEGORY', `${item.name} is in non-refundable category "${item.category}".`);
        }
        if (item.finalSale) {
          if (POLICY.merchantFaultReasons.includes(reason)) {
            hit('FINAL_SALE_MERCHANT_FAULT', `${item.name} is final sale but reported as ${reason}.`);
          } else {
            hit('FINAL_SALE', `${item.name} is final sale.`);
          }
        }
        if (lineRules.length === 0) {
          if (POLICY.qualifyingReasons.includes(reason)) {
            hit('QUALIFYING_REASON', `Delivered ${age} days ago with qualifying reason "${reason}".`);
          } else {
            hit('LOW_CONFIDENCE', `No qualifying reason could be established (got "${reason}").`);
          }
        }
        break;
      }
    }

    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      amountCents: lineAmount(item),
      decision: mostRestrictive(lineRules.map((id) => RULES[id].effect as Decision)),
      ruleIds: lineRules,
    };
  });

  let decision = aggregate(lines);

  // Case-level risk overlays. They escalate approvals and are recorded as flags on denials.
  const overlay = (id: RuleId, detail: string) => {
    if (decision === 'DENIED') {
      if (RISK_RULES.has(id)) trigger(id, detail, undefined, 'FLAG');
      return;
    }
    trigger(id, detail);
    if (decision === 'APPROVED') decision = 'ESCALATED';
    for (const line of lines) {
      if (line.decision === 'APPROVED') {
        line.decision = 'ESCALATED';
        line.ruleIds.push(id);
      }
    }
  };

  const payout = lines.filter((l) => l.decision !== 'DENIED').reduce((sum, l) => sum + l.amountCents, 0);
  if (decision !== 'DENIED' && payout > POLICY.humanReviewThresholdCents) {
    overlay(
      'HIGH_VALUE',
      `Refund of ${formatCents(payout)} exceeds the ${formatCents(POLICY.humanReviewThresholdCents)} review threshold.`,
    );
  }
  if (signals.refundsInLookback >= POLICY.frequencyMaxRefunds) {
    overlay(
      'REFUND_FREQUENCY',
      `${signals.refundsInLookback} refunds in the last ${POLICY.frequencyLookbackDays} days (limit ${POLICY.frequencyMaxRefunds - 1}).`,
    );
  }
  const riskyFlags = customer.accountFlags.filter((f) => POLICY.riskAccountFlags.includes(f));
  if (riskyFlags.length > 0) {
    overlay('ACCOUNT_FLAG', `Account flags: ${riskyFlags.join(', ')}.`);
  }
  if (signals.claimMismatches.length > 0) {
    overlay('CLAIM_MISMATCH', signals.claimMismatches.join(' '));
  }
  if (signals.manipulationSignals.length > 0) {
    overlay('MANIPULATION_ATTEMPT', `Signals: ${signals.manipulationSignals.join('; ')}.`);
  }
  if (signals.confidence < POLICY.minExtractionConfidence) {
    overlay(
      'LOW_CONFIDENCE',
      `Extraction confidence ${signals.confidence.toFixed(2)} is below ${POLICY.minExtractionConfidence}.`,
    );
  }

  return finalize(decision, lines, rules);
}

function aggregate(lines: LineDecision[]): Decision {
  if (lines.length === 0) return 'DENIED';
  if (lines.some((l) => l.decision === 'ESCALATED')) return 'ESCALATED';
  if (lines.some((l) => l.decision === 'APPROVED')) return 'APPROVED';
  return 'DENIED';
}

function finalize(decision: Decision, lines: LineDecision[], rules: TriggeredRule[]): PolicyEvaluation {
  const sum = (d: Decision) => lines.filter((l) => l.decision === d).reduce((s, l) => s + l.amountCents, 0);
  const riskFlags = [...new Set(rules.filter((r) => RISK_RULES.has(r.id)).map((r) => r.id.toLowerCase()))];
  return {
    decision,
    lines,
    rules,
    riskFlags,
    refundAmountCents: decision === 'APPROVED' ? sum('APPROVED') : 0,
    reviewAmountCents: decision === 'ESCALATED' ? sum('ESCALATED') : 0,
  };
}

/** Escalated cases that a human approves pay out every line that was not denied. */
export function payableLines(lines: LineDecision[]): LineDecision[] {
  return lines.filter((l) => l.decision !== 'DENIED');
}
