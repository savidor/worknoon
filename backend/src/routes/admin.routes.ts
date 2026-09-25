import { Router } from 'express';
import { z } from 'zod';
import { aiProvider } from '../ai/index.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { adminName, requireRole } from '../middleware/auth.js';
import { eventsForRequest, securityEvents } from '../repositories/audit.repo.js';
import { listMessages } from '../repositories/conversation.repo.js';
import { getOrderById, refundHistory } from '../repositories/crm.repo.js';
import { exportRequests, getRequest, getStats, listRequests } from '../repositories/request.repo.js';
import { SORTS, toCsv, type SortKey } from '../repositories/request-query.js';
import { resetDemoData } from '../seed/demo.js';
import { ruleCatalog } from '../policy/policy.js';
import { getActivePolicy } from '../services/policy.service.js';
import { reviewRequest } from '../services/review.service.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

adminRouter.get('/system', async (_req, res) => {
  res.json({ ai: { provider: aiProvider.name, model: aiProvider.model }, policyVersion: (await getActivePolicy()).version, demoMode: env.DEMO_MODE });
});

adminRouter.get('/stats', async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(7) }).parse(req.query);
  res.json(await getStats(days));
});

/** Comma-separated list parameter, e.g. reasons=wrong_item,changed_mind. */
const csvList = (max: number) =>
  z
    .string()
    .max(2000)
    .optional()
    .transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, max) : undefined))
    .pipe(z.array(z.string().max(80)).optional());

const cents = z.coerce.number().int().min(0).max(100_000_000).optional();

const Filters = z.object({
  status: z.enum(['APPROVED', 'DENIED', 'ESCALATED']).optional(),
  flagged: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  q: z.string().trim().max(80).optional(),
  reasons: csvList(20),
  signals: csvList(20),
  decidedBy: z.enum(['auto', 'team']).optional(),
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
  minCents: cents,
  maxCents: cents,
  sort: z.enum(Object.keys(SORTS) as [SortKey, ...SortKey[]]).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

const ListQuery = Filters.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

adminRouter.get('/requests', async (req, res) => {
  res.json(await listRequests(ListQuery.parse(req.query)));
});

const EXPORT_HEADER = ['Reference', 'Created', 'Customer', 'Order', 'Reason', 'Outcome', 'System decision', 'Amount', 'Risk signals', 'Reviewed by', 'Reviewed at', 'Decision time (ms)', 'Policy version', 'Customer message'];

/** The current view as CSV: same filters and order as the table, or just the selected cases. */
adminRouter.get('/requests/export', async (req, res) => {
  const f = Filters.extend({ ids: csvList(100) }).parse(req.query);
  const rows = await exportRequests({ ...f, limit: 0, offset: 0 });
  const amount = (r: Record<string, unknown>) =>
    r.status === 'APPROVED' ? r.refund_amount_cents : r.status === 'ESCALATED' ? r.review_amount_cents : null;
  const csv = toCsv([
    EXPORT_HEADER,
    ...rows.map((r) => [
      r.reference, new Date(r.created_at).toISOString(), r.customer_name, r.order_number, r.reason_category, r.status,
      r.system_decision, amount(r) === null ? '' : (Number(amount(r)) / 100).toFixed(2), (r.risk_flags as string[]).join('; '),
      r.reviewed_by, r.reviewed_at ? new Date(r.reviewed_at).toISOString() : '', r.latency_ms, r.policy_version, r.customer_message,
    ]),
  ]);
  res
    .type('text/csv; charset=utf-8')
    .attachment(`refund-cases-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(`\uFEFF${csv}`);
});

adminRouter.get('/requests/:id', async (req, res) => {
  const request = await getRequest(z.string().max(80).parse(req.params.id));
  if (!request) throw HttpError.notFound('Refund request not found');
  const [events, transcript, order, history, policy] = await Promise.all([
    eventsForRequest(request.id),
    listMessages(request.conversation_id, 50),
    request.order_id ? getOrderById(request.order_id) : null,
    refundHistory(request.customer_id),
    getActivePolicy(),
  ]);
  // How the frequency rule saw this customer: refunds in the lookback window before the case.
  const caseAt = new Date(request.created_at).getTime();
  const windowStart = caseAt - policy.config.frequencyLookbackDays * 86_400_000;
  const inWindow = history.filter((h) => h.createdAt.getTime() < caseAt && h.createdAt.getTime() >= windowStart);
  // Plain-language guidance for every rule on this case, for reviewers who are not engineers.
  const catalog = ruleCatalog(policy);
  const ruleGuide = Object.fromEntries(
    (request.rules_triggered as Array<{ id: string }>).map((r) => {
      const def = catalog.get(r.id);
      return [r.id, { title: def?.title ?? r.id, hint: def?.reviewerHint ?? null }];
    }),
  );
  // The exact words that triggered the manipulation scan, to highlight in the message.
  const inputGuard = (request.trace as Array<{ stage: string; data?: { evidence?: unknown } }>).find((t) => t.stage === 'input_guard');
  res.json({
    request,
    ruleGuide,
    evidence: inputGuard?.data?.evidence ?? [],
    events,
    transcript,
    order,
    refundHistory: {
      entries: history,
      lookbackDays: policy.config.frequencyLookbackDays,
      reviewFrom: policy.config.frequencyMaxRefunds,
      countInWindow: inWindow.length,
      amountInWindowCents: inWindow.reduce((s, h) => s + h.amountCents, 0),
    },
  });
});

const ReviewBody = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  note: z.string().trim().min(3, 'Add a short note explaining the decision').max(1000),
  customerMessage: z.string().trim().max(500).optional(),
});

adminRouter.post('/requests/:id/review', async (req, res) => {
  const body = ReviewBody.parse(req.body);
  const updated = await reviewRequest({
    requestId: z.string().max(80).parse(req.params.id),
    reviewer: adminName(req),
    ...body,
  });
  res.json({ request: updated });
});

adminRouter.get('/security-events', async (_req, res) => {
  res.json({ events: await securityEvents(50) });
});

adminRouter.post('/demo/reset', async (req, res) => {
  if (!env.DEMO_MODE) throw HttpError.notFound();
  const { sampleActivity } = z.object({ sampleActivity: z.boolean().default(true) }).parse(req.body ?? {});
  await resetDemoData({ sampleActivity });
  res.json({ ok: true, sampleActivity });
});
