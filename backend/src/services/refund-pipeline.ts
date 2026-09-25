import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { aiProvider, fallbackProvider } from '../ai/index.js';
import { PROMPT_VERSION } from '../ai/prompts.js';
import { templateReply } from '../ai/templates.js';
import type { AiProvider, AiResult, AiUsage, ReplyContext, ReplyDraft } from '../ai/types.js';
import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import type {
  Customer,
  Decision,
  Extraction,
  Order,
  Outcome,
  PolicyEvaluation,
  ReasonCategory,
  TraceStep,
} from '../domain/types.js';
import { HttpError, RefundConflictError } from '../lib/errors.js';
import { caseReference } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { DAY_MS, formatCents } from '../lib/money.js';
import { evaluateRefund } from '../policy/engine.js';
import { ruleCatalog, type ActivePolicy, type RuleDefinition } from '../policy/policy.js';
import { recordEvents, type AuditEvent } from '../repositories/audit.repo.js';
import {
  addMessage,
  listMessages,
  type Message,
  type MessageMeta,
} from '../repositories/conversation.repo.js';
import {
  countRefundsSince,
  getCustomer,
  getOrderById,
  getOrderByNumber,
  listOrdersForCustomer,
  recordRefund,
} from '../repositories/crm.repo.js';
import { findOpenEscalation, insertRequest } from '../repositories/request.repo.js';
import { guardReply } from '../security/output-guard.js';
import { sanitizeInput, scanForInjection } from '../security/input.js';
import { getActivePolicy } from './policy.service.js';
import { isActiveOrder, orderForAi, orderLabel, orderStatusLine } from './presenters.js';

export interface TurnResult {
  customerMessage: Message;
  assistantMessage: Message;
  outcome: Outcome;
  caseId: string | null;
  caseReference: string | null;
}

interface AiCallOutcome<T> {
  data: T;
  provider: AiProvider;
  usage?: AiUsage;
  fellBack: boolean;
  error?: string;
}

/** Runs an AI step with a hard timeout; on any failure the deterministic provider takes over. */
async function runAi<T>(
  trace: TraceStep[],
  stage: string,
  fn: (p: AiProvider, signal: AbortSignal) => Promise<AiResult<T>>,
): Promise<AiCallOutcome<T>> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
  try {
    const res = await fn(aiProvider, controller.signal);
    trace.push({
      stage,
      ms: Math.round(performance.now() - t0),
      status: 'ok',
      note: `${aiProvider.name}:${res.model ?? aiProvider.model}`,
      data: { usage: res.usage },
    });
    return { data: res.data, usage: res.usage, provider: aiProvider, fellBack: false };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.warn({ err, stage, provider: aiProvider.name }, 'AI step failed; using deterministic fallback');
    const res = await fn(fallbackProvider, new AbortController().signal);
    trace.push({
      stage,
      ms: Math.round(performance.now() - t0),
      status: 'fallback',
      note: `${aiProvider.name} failed, used ${fallbackProvider.name}`,
      data: { error },
    });
    return { data: res.data, provider: fallbackProvider, fellBack: true, error };
  } finally {
    clearTimeout(timer);
  }
}

function timed<T>(trace: TraceStep[], stage: string, fn: () => T, summarize?: (r: T) => Partial<TraceStep>): T {
  const t0 = performance.now();
  const result = fn();
  trace.push({ stage, ms: Math.round(performance.now() - t0), status: 'ok', ...summarize?.(result) });
  return result;
}

const firstName = (c: Customer) => c.name.split(' ')[0] ?? c.name;

/**
 * Handles one customer chat turn end to end.
 *
 *   sanitize + injection scan -> AI extraction -> resolve order from DB
 *   -> deterministic policy engine -> AI reply draft -> output guard -> persist + audit
 *
 * The model only ever produces (a) structured facts that are validated against the
 * database and (b) wording that is validated against the engine's decision.
 */
export async function handleCustomerTurn(args: {
  customerId: string;
  conversationId: string;
  content: string;
}): Promise<TurnResult> {
  const started = performance.now();
  const trace: TraceStep[] = [];
  const audit: AuditEvent[] = [];
  const { conversationId } = args;

  // 1. Input guard
  const { text, removedInvisible } = sanitizeInput(args.content);
  if (!text) throw HttpError.badRequest('Message is empty');
  const scan = timed(trace, 'input_guard', () => scanForInjection(text, removedInvisible), (s) => ({
    status: s.flagged ? 'warn' : 'ok',
    data: s,
  }));

  // 2. Load context (identity comes from the session, never from the message)
  const [policy, customer, orders, history] = await Promise.all([
    getActivePolicy(),
    getCustomer(args.customerId),
    listOrdersForCustomer(args.customerId),
    listMessages(conversationId, 12),
  ]);
  if (!customer) throw HttpError.unauthorized('Unknown customer');
  const customerMessage = await addMessage({ conversationId, role: 'customer', content: text });

  // 3. AI extraction
  const extractionCall = await runAi(trace, 'ai_extraction', (p, signal) =>
    p.extract(
      {
        customerFirstName: firstName(customer),
        orders: orders.map(orderForAi),
        history: history.map((m) => ({ role: m.role, content: m.content })),
        message: text,
      },
      signal,
    ),
  );
  const extraction = extractionCall.data;
  trace.at(-1)!.data = { ...(trace.at(-1)!.data as object), extraction };

  const manipulation = [
    ...new Set([
      ...(scan.flagged ? scan.matches.map((m) => `heuristic:${m}`) : []),
      ...extraction.manipulationSignals,
    ]),
  ];
  if (manipulation.length > 0) {
    audit.push({
      conversationId,
      actor: 'system',
      type: 'security.manipulation_detected',
      severity: scan.flagged ? 'critical' : 'warning',
      detail: { signals: manipulation, heuristicScore: scan.score, excerpt: text.slice(0, 280) },
    });
  }

  // 4. Resolve the order against the database
  const active = orders.filter(isActiveOrder);
  const missing: string[] = [];
  let order: Order | null = null;
  const lastOrderInConversation = [...history].reverse().find((m) => m.meta?.orderNumber)?.meta.orderNumber;

  if (extraction.orderNumber) {
    order = orders.find((o) => o.orderNumber === extraction.orderNumber) ?? (await getOrderByNumber(extraction.orderNumber));
    if (!order) missing.push('valid_order');
  } else if (lastOrderInConversation) {
    order = orders.find((o) => o.orderNumber === lastOrderInConversation) ?? null;
  } else if (active.length === 1) {
    order = active[0]!;
  } else if (extraction.itemSkus.length > 0) {
    const matches = active.filter((o) => o.items.some((i) => extraction.itemSkus.includes(i.sku)));
    if (matches.length === 1) order = matches[0]!;
  }
  if (!order && missing.length === 0) missing.push('order');
  if (order && order.customerId !== customer.id) {
    audit.push({
      conversationId,
      actor: 'system',
      type: 'security.ownership_mismatch',
      severity: 'critical',
      detail: { requestedOrder: order.orderNumber, excerpt: text.slice(0, 280) },
    });
  }
  trace.push({
    stage: 'order_resolution',
    ms: 0,
    status: order ? 'ok' : 'warn',
    note: order ? `${order.orderNumber} (${order.customerId === customer.id ? 'owned' : 'NOT owned'})` : `missing: ${missing.join(', ')}`,
  });

  const isRefundIntent =
    extraction.intent === 'refund_request' ||
    extraction.intent === 'cancel_request' ||
    extraction.reasonCategory !== 'unknown';

  const ctxBase = {
    customerFirstName: firstName(customer),
    customerMessage: text,
    orderChoices: active.map(orderLabel),
  };

  // 5a. Not a refund request: answer and stop.
  if (!isRefundIntent && manipulation.length === 0) {
    const ownOrder = order && order.customerId === customer.id ? order : null;
    return replyWithoutCase({
      trace, audit, started, policy, conversationId, customerMessage, extraction, outcome: 'INFO',
      ctx: {
        ...ctxBase,
        outcome: 'INFO',
        orderNumber: ownOrder?.orderNumber ?? null,
        statusLine: ownOrder ? orderStatusLine(ownOrder) : null,
      },
    });
  }

  let reason: ReasonCategory = extraction.reasonCategory;
  if (reason === 'unknown' && (extraction.intent === 'cancel_request' || order?.status === 'processing')) {
    reason = 'cancel_order';
  }
  // Never ask follow-up questions about someone else's order: that would confirm it exists.
  const foreignOrder = !!order && order.customerId !== customer.id;
  // Do not engage in back-and-forth with a manipulation attempt; send it to a human instead.
  if (reason === 'unknown' && manipulation.length === 0 && !foreignOrder) missing.push('reason');

  // 5b. Clarify, or escalate if we have already asked too many times.
  if (missing.length > 0 || !order) {
    const askedSinceLastCase = countClarifications(history);
    if (askedSinceLastCase >= policy.config.maxClarificationTurns) {
      return createCase({
        trace, audit, started, policy, conversationId, customer, customerMessage, extraction, reason,
        order: order && order.customerId === customer.id ? order : null,
        evaluation: {
          decision: 'ESCALATED',
          lines: [],
          rules: [{ id: 'UNRESOLVED_CLARIFICATION', effect: 'ESCALATED', detail: `Still missing ${missing.join(', ')} after ${askedSinceLastCase} clarification attempts.` }],
          riskFlags: manipulation.length ? ['manipulation_attempt'] : [],
          refundAmountCents: 0,
          reviewAmountCents: 0,
        },
        aiProviderUsed: extractionCall.provider,
      });
    }
    return replyWithoutCase({
      trace, audit, started, policy, conversationId, customerMessage, extraction, outcome: 'NEEDS_INFO',
      ctx: { ...ctxBase, outcome: 'NEEDS_INFO', orderNumber: order?.orderNumber ?? null, missingInfo: missing },
    });
  }

  // 5c. Idempotency: an open review already exists for this order.
  if (order.customerId === customer.id) {
    const open = await findOpenEscalation(order.id);
    if (open) {
      return replyWithoutCase({
        trace, audit, started, policy, conversationId, customerMessage, extraction, outcome: 'ESCALATED',
        ctx: { ...ctxBase, outcome: 'ESCALATED', orderNumber: order.orderNumber, caseReference: open.reference, isDuplicate: true },
        metaExtra: { caseId: open.id, caseReference: open.reference },
      });
    }
  }

  // 6. Cross-check the customer's claims against the record
  const claimMismatches: string[] = [];
  if (extraction.unknownItemMentions.length > 0) {
    claimMismatches.push(`Customer mentions items not on any of their orders: ${extraction.unknownItemMentions.join(', ')}.`);
  }
  if (extraction.claimedAmount !== null && extraction.claimedAmount * 100 > order.totalCents + 100) {
    claimMismatches.push(
      `Customer cites ${formatCents(Math.round(extraction.claimedAmount * 100))} but ${order.orderNumber} totals ${formatCents(order.totalCents)}.`,
    );
  }
  const requestedIds = order.items.filter((i) => extraction.itemSkus.includes(i.sku)).map((i) => i.id);
  const refundsInLookback = await countRefundsSince(customer.id, new Date(Date.now() - policy.config.frequencyLookbackDays * DAY_MS));

  // 7. Deterministic policy decision. If a concurrent request refunds the same items
  // between evaluation and commit, reload the order and decide again on fresh data.
  let current: Order = order;
  for (let attempt = 1; ; attempt++) {
    const snapshot = current;
    const evaluation = timed(
      trace,
      'policy_engine',
      () =>
        evaluateRefund({
          now: new Date(),
          customer,
          order: snapshot,
          reason,
          requestedItemIds: requestedIds.length > 0 ? requestedIds : null,
          signals: { refundsInLookback, manipulationSignals: manipulation, confidence: extraction.confidence, claimMismatches },
        }, policy),
      (e) => ({ note: `${e.decision} (${e.rules.map((r) => r.id).join(', ')})`, data: { policyVersion: policy.version } }),
    );

    try {
      return await createCase({
        trace, audit, started, policy, conversationId, customer, customerMessage, extraction, reason, evaluation,
        order: snapshot.customerId === customer.id ? snapshot : null,
        requestedOrderNumber: snapshot.orderNumber,
        aiProviderUsed: extractionCall.provider,
      });
    } catch (err) {
      if (!(err instanceof RefundConflictError) || attempt >= 2) throw err;
      trace.push({ stage: 'concurrency_retry', ms: 0, status: 'warn', note: 'Items refunded by a concurrent request; re-evaluating' });
      current = (await getOrderById(snapshot.id)) ?? snapshot;
    }
  }
}

function countClarifications(history: Message[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const outcome = history[i]!.meta?.outcome;
    if (outcome === 'NEEDS_INFO') n++;
    else if (outcome && outcome !== 'INFO') break;
  }
  return n;
}

function customerReasons(evaluation: PolicyEvaluation, catalog: Map<string, RuleDefinition>): string[] {
  const relevant = evaluation.rules.filter((r) => r.effect === evaluation.decision);
  return [...new Set(relevant.map((r) => catalog.get(r.id)?.customerText).filter((t): t is string => !!t))];
}

/** Dollar amounts quoted in rule wording (such as a review threshold) are legitimate in replies. */
function amountsIn(texts: string[]): number[] {
  return texts.flatMap((t) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => Math.round(Number(m[1]!.replace(/,/g, '')) * 100)));
}

async function draftGuardedReply(
  trace: TraceStep[],
  audit: AuditEvent[],
  ctx: ReplyContext,
  allowedAmountsCents: number[],
  conversationId: string,
): Promise<{ draft: ReplyDraft; provider: AiProvider; usage?: AiUsage }> {
  const call = await runAi(trace, 'ai_reply', (p, signal) => p.draftReply(ctx, signal));
  const guard = guardReply(call.data.customerReply, {
    outcome: ctx.outcome,
    allowedAmountsCents,
    partial: ctx.deniedItems.length > 0,
  });
  if (guard.ok) {
    trace.push({ stage: 'output_guard', ms: 0, status: 'ok' });
    return { draft: call.data, provider: call.provider, usage: call.usage };
  }
  trace.push({ stage: 'output_guard', ms: 0, status: 'fallback', note: 'Model reply rejected; template used', data: guard });
  audit.push({
    conversationId,
    actor: 'system',
    type: 'security.reply_blocked',
    severity: 'warning',
    detail: { violations: guard.violations, rejectedReply: call.data.customerReply.slice(0, 600) },
  });
  return { draft: { ...templateReply(ctx), internalNote: call.data.internalNote }, provider: call.provider };
}

const emptyCtx: Omit<ReplyContext, 'outcome' | 'customerFirstName' | 'customerMessage'> = {
  orderNumber: null,
  caseReference: null,
  refundAmount: null,
  reviewAmount: null,
  approvedItems: [],
  deniedItems: [],
  reviewItems: [],
  reasons: [],
  missingInfo: [],
  orderChoices: [],
  statusLine: null,
  isDuplicate: false,
};

async function replyWithoutCase(args: {
  trace: TraceStep[];
  audit: AuditEvent[];
  started: number;
  policy: ActivePolicy;
  conversationId: string;
  customerMessage: Message;
  extraction: Extraction;
  outcome: Outcome;
  ctx: Partial<ReplyContext> & Pick<ReplyContext, 'outcome' | 'customerFirstName' | 'customerMessage'>;
  metaExtra?: MessageMeta;
}): Promise<TurnResult> {
  const ctx: ReplyContext = { ...emptyCtx, ...args.ctx };
  const { draft } = await draftGuardedReply(args.trace, args.audit, ctx, [args.policy.config.humanReviewThresholdCents, ...amountsIn(ctx.reasons)], args.conversationId);
  const assistantMessage = await withTransaction(async (db) => {
    const msg = await addMessage(
      {
        conversationId: args.conversationId,
        role: 'assistant',
        content: draft.customerReply,
        meta: { outcome: args.outcome, orderNumber: ctx.orderNumber, ...args.metaExtra },
      },
      db,
    );
    await recordEvents(args.audit, db);
    return msg;
  });
  logger.info(
    { conversationId: args.conversationId, outcome: args.outcome, ms: Math.round(performance.now() - args.started), trace: args.trace.map((t) => `${t.stage}:${t.status}`) },
    'Customer turn handled without a case',
  );
  return {
    customerMessage: args.customerMessage,
    assistantMessage,
    outcome: args.outcome,
    caseId: args.metaExtra?.caseId ?? null,
    caseReference: args.metaExtra?.caseReference ?? null,
  };
}

async function createCase(args: {
  trace: TraceStep[];
  audit: AuditEvent[];
  started: number;
  policy: ActivePolicy;
  conversationId: string;
  customer: Customer;
  customerMessage: Message;
  extraction: Extraction;
  reason: ReasonCategory;
  evaluation: PolicyEvaluation;
  /** The resolved order if it belongs to the customer. */
  order: Order | null;
  /** Order number as requested, which may belong to someone else. */
  requestedOrderNumber?: string;
  aiProviderUsed: AiProvider;
}): Promise<TurnResult> {
  const { evaluation, order, trace, audit, conversationId } = args;
  const id = `req_${randomUUID()}`;
  const reference = caseReference();
  const decision: Decision = evaluation.decision;

  const approved = evaluation.lines.filter((l) => l.decision === 'APPROVED');
  const denied = evaluation.lines.filter((l) => l.decision === 'DENIED');
  const review = evaluation.lines.filter((l) => l.decision === 'ESCALATED');
  const catalog = ruleCatalog(args.policy);
  const firstRuleText = (ids: string[]) =>
    catalog.get(ids.find((r) => catalog.get(r)?.effect === 'DENIED') ?? ids[0] ?? '')?.customerText ?? 'it does not meet our refund policy';

  const ctx: ReplyContext = {
    ...emptyCtx,
    outcome: decision,
    customerFirstName: firstName(args.customer),
    customerMessage: args.customerMessage.content,
    orderNumber: order?.orderNumber ?? null,
    caseReference: reference,
    refundAmount: decision === 'APPROVED' ? formatCents(evaluation.refundAmountCents) : null,
    reviewAmount: decision === 'ESCALATED' && evaluation.reviewAmountCents > 0 ? formatCents(evaluation.reviewAmountCents) : null,
    approvedItems: decision === 'APPROVED' ? approved.map((l) => ({ name: l.name, amount: formatCents(l.amountCents) })) : [],
    deniedItems: denied.map((l) => ({ name: l.name, reason: firstRuleText(l.ruleIds) })),
    reviewItems: review.map((l) => ({ name: l.name })),
    reasons: customerReasons(evaluation, catalog),
  };
  const allowed = [
    ...evaluation.lines.map((l) => l.amountCents),
    evaluation.refundAmountCents,
    evaluation.reviewAmountCents,
    order?.totalCents ?? 0,
    args.policy.config.humanReviewThresholdCents,
    ...amountsIn([...ctx.reasons, ...ctx.deniedItems.map((d) => d.reason)]),
  ];
  const { draft, provider: replyProvider } = await draftGuardedReply(trace, audit, ctx, allowed, conversationId);

  const latencyMs = Math.round(performance.now() - args.started);
  const riskSeverity = evaluation.riskFlags.length > 0 ? 'warning' : 'info';

  const assistantMessage = await withTransaction(async (db) => {
    await insertRequest(db, {
      id,
      reference,
      conversationId,
      customerId: args.customer.id,
      orderId: order?.id ?? null,
      customerMessage: args.customerMessage.content,
      reasonCategory: args.reason,
      reasonSummary: args.extraction.reasonSummary,
      decision,
      refundAmountCents: evaluation.refundAmountCents,
      reviewAmountCents: evaluation.reviewAmountCents,
      lines: evaluation.lines,
      rules: evaluation.rules,
      riskFlags: evaluation.riskFlags,
      extraction: args.extraction,
      trace,
      customerReply: draft.customerReply,
      internalNote: draft.internalNote || null,
      aiProvider: replyProvider.name === args.aiProviderUsed.name ? replyProvider.name : `${args.aiProviderUsed.name}+${replyProvider.name}`,
      aiModel: args.aiProviderUsed.model,
      policyVersion: `${args.policy.version} / ${PROMPT_VERSION}`,
      latencyMs,
    });

    if (decision === 'APPROVED' && order) {
      await recordRefund(db, {
        refundId: `rfd_${randomUUID()}`,
        orderId: order.id,
        customerId: args.customer.id,
        itemIds: approved.map((l) => l.itemId),
        amountCents: evaluation.refundAmountCents,
        source: 'automated',
      });
    }

    const msg = await addMessage(
      {
        conversationId,
        role: 'assistant',
        content: draft.customerReply,
        meta: {
          outcome: decision,
          caseId: id,
          caseReference: reference,
          orderNumber: order?.orderNumber ?? null,
          refundAmountCents: evaluation.refundAmountCents,
          reviewAmountCents: evaluation.reviewAmountCents,
          lines: evaluation.lines.map((l) => ({ name: l.name, amountCents: l.amountCents, decision: l.decision })),
          reasons: ctx.reasons,
        },
      },
      db,
    );

    await recordEvents(
      [
        ...audit.map((e) => ({ ...e, requestId: id })),
        {
          requestId: id,
          conversationId,
          actor: `ai:${args.aiProviderUsed.name}`,
          type: 'ai.extraction',
          detail: { ...args.extraction },
        },
        {
          requestId: id,
          conversationId,
          actor: 'policy-engine',
          type: `decision.${decision.toLowerCase()}`,
          severity: riskSeverity,
          detail: {
            policyVersion: args.policy.version,
            requestedOrder: args.requestedOrderNumber ?? null,
            rules: evaluation.rules.map((r) => `${r.id}:${r.effect}`),
            refundAmountCents: evaluation.refundAmountCents,
            reviewAmountCents: evaluation.reviewAmountCents,
          },
        },
      ],
      db,
    );
    return msg;
  });

  logger.info({ caseId: id, reference, decision, latencyMs, rules: evaluation.rules.map((r) => r.id) }, 'Refund case decided');
  return { customerMessage: args.customerMessage, assistantMessage, outcome: decision, caseId: id, caseReference: reference };
}
