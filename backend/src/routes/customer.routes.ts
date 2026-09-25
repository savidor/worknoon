import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { customerId, requireRole } from '../middleware/auth.js';
import {
  createConversation,
  getConversation,
  latestConversationFor,
  listConversationsFor,
  listMessages,
} from '../repositories/conversation.repo.js';
import { customerRefunds, getCustomer, listOrdersForCustomer } from '../repositories/crm.repo.js';
import { MAX_MESSAGE_CHARS } from '../security/input.js';
import { publicCustomer } from '../services/presenters.js';
import { handleCustomerTurn } from '../services/refund-pipeline.js';

export const customerRouter = Router();
customerRouter.use(requireRole('customer'));

// Per-customer limit on the expensive AI endpoint.
const messageLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `customer:${customerId(req)}`,
  message: { error: { code: 'rate_limited', message: 'Too many messages. Please wait a moment and try again.' } },
});

customerRouter.get('/me', async (req, res) => {
  const customer = await getCustomer(customerId(req));
  if (!customer) throw HttpError.unauthorized();
  res.json({ customer: publicCustomer(customer), orders: await listOrdersForCustomer(customer.id) });
});

/** The customer's refunds: what was refunded, when, and how it was decided. */
customerRouter.get('/refunds', async (req, res) => {
  res.json({ refunds: await customerRefunds(customerId(req)) });
});

customerRouter.post('/conversations', async (req, res) => {
  res.status(201).json(await createConversation(customerId(req)));
});

/** Earlier enquiries, each with how it ended, so a customer can pick up where they left off. */
customerRouter.get('/conversations', async (req, res) => {
  res.json({ conversations: await listConversationsFor(customerId(req)) });
});

/** Resumes the most recent conversation, or starts one. */
customerRouter.get('/conversations/current', async (req, res) => {
  const id = (await latestConversationFor(customerId(req))) ?? (await createConversation(customerId(req))).id;
  res.json({ id, messages: await listMessages(id) });
});

async function ownedConversation(req: Parameters<typeof customerId>[0]): Promise<string> {
  const id = z.string().max(80).parse(req.params.id);
  const conversation = await getConversation(id);
  // Same response for "missing" and "not yours" so ids cannot be probed.
  if (!conversation || conversation.customerId !== customerId(req)) throw HttpError.notFound('Conversation not found');
  return conversation.id;
}

customerRouter.get('/conversations/:id/messages', async (req, res) => {
  res.json({ messages: await listMessages(await ownedConversation(req)) });
});

customerRouter.post('/conversations/:id/messages', messageLimiter, async (req, res) => {
  const conversationId = await ownedConversation(req);
  const { content } = z.object({ content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }).parse(req.body);
  const result = await handleCustomerTurn({ customerId: customerId(req), conversationId, content });
  res.status(201).json(result);
});
