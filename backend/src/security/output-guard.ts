import type { Outcome } from '../domain/types.js';

export interface GuardContext {
  outcome: Outcome;
  /** Every dollar amount the reply is allowed to mention, in cents. */
  allowedAmountsCents: number[];
  /** Approved with some items denied, so denial wording is legitimate. */
  partial: boolean;
}

export interface GuardResult {
  ok: boolean;
  violations: string[];
}

const MAX_REPLY_CHARS = 1400;

// Words that would promise money back. Negated forms ("not approved") are checked separately.
const PROMISE = /\b(approved|refund(ed)? (has been|was|is being) (issued|processed|sent)|we('ve| have) (issued|processed|refunded)|you will (receive|get) (a|your) refund)\b/i;
const NEGATED_PROMISE = /\b(not|n't|cannot|unable to|isn't|wasn't)\s+(be\s+)?approved\b/i;
const DENIAL = /\b(denied|declined|rejected|not eligible|ineligible|unable to (offer|issue|process) a refund)\b/i;
const INTERNAL = /\b(system prompt|prompt injection|instructions? (say|tell)|risk (score|flag)|fraud|flagged|chargeback|policy engine|rule id)\b/i;
const RULE_ID = /\b[A-Z]{3,}_[A-Z_]{3,}\b/;
const MARKUP = /<\/?\s*(customer_message|system|assistant|context)[^>]*>/i;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;

/** True when text mentions risk signals, internal machinery or rule ids a customer must never see. */
export function containsInternalTerms(text: string): boolean {
  return INTERNAL.test(text) || RULE_ID.test(text);
}

/**
 * Validates a model-written customer reply against the decision that was actually made.
 * The model writes the words, but it can never contradict the policy engine, promise an
 * amount the engine did not compute, or leak internal risk signals to the customer.
 */
export function guardReply(reply: string, ctx: GuardContext): GuardResult {
  const violations: string[] = [];
  if (!reply.trim()) violations.push('empty_reply');
  if (reply.length > MAX_REPLY_CHARS) violations.push('too_long');

  const promises = PROMISE.test(reply) && !NEGATED_PROMISE.test(reply);
  if (promises && ctx.outcome !== 'APPROVED') violations.push('promises_refund_without_approval');
  if (ctx.outcome === 'APPROVED' && !ctx.partial && DENIAL.test(reply)) {
    violations.push('denies_an_approved_refund');
  }
  if (containsInternalTerms(reply)) violations.push('leaks_internal_terms');
  if (MARKUP.test(reply)) violations.push('contains_prompt_markup');

  const allowed = new Set(ctx.allowedAmountsCents.map((c) => Math.round(c)));
  for (const match of reply.matchAll(MONEY)) {
    const cents = Math.round(Number(match[1]!.replace(/,/g, '')) * 100);
    if (!allowed.has(cents)) violations.push(`unapproved_amount:${match[0]}`);
  }

  return { ok: violations.length === 0, violations };
}
