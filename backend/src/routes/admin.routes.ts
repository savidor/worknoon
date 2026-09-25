import { Router } from 'express';
import { z } from 'zod';
import { aiProvider } from '../ai/index.js';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { adminName, requireRole } from '../middleware/auth.js';
import { eventsForRequest, securityEvents } from '../repositories/audit.repo.js';
import { listMessages } from '../repositories/conversation.repo.js';
import { getOrderById, refundHistory } from '../repositories/crm.repo.js';
import { getRequest, getStats, listRequests } from '../repositories/request.repo.js';
import { resetDemoData } from '../seed/demo.js';
import { getActivePolicy } from '../services/policy.service.js';
import { reviewRequest } from '../services/review.service.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

adminRouter.get('/system', async (_req, res) => {
  res.json({ ai: { provider: aiProvider.name, model: aiProvider.model }, policyVersion: (await getActivePolicy()).version, demoMode: env.DEMO_MODE });
});

adminRouter.get('/stats', async (_req, res) => {
  res.json(await getStats());
});

const ListQuery = z.object({
  status: z.enum(['APPROVED', 'DENIED', 'ESCALATED']).optional(),
  flagged: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

adminRouter.get('/requests', async (req, res) => {
  res.json(await listRequests(ListQuery.parse(req.query)));
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
  res.json({
    request,
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
