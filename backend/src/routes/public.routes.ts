import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { aiProvider } from '../ai/index.js';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { passwordMatches, signToken } from '../lib/auth.js';
import { HttpError } from '../lib/errors.js';
import { renderPolicyDocument } from '../policy/document.js';
import { ruleCatalog } from '../policy/policy.js';
import { getCustomer, listCustomers, listOrdersForCustomer } from '../repositories/crm.repo.js';
import { SEED_CUSTOMERS } from '../seed/data.js';
import { getActivePolicy } from '../services/policy.service.js';
import { publicCustomer } from '../services/presenters.js';

// Password attempts are tightly limited against brute force; demo sign-ins only switch personas.
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true });
const demoLoginLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });

export const publicRouter = Router();

publicRouter.get('/health', async (_req, res) => {
  const t0 = Date.now();
  let db = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    db = 'unavailable';
  }
  res.status(db === 'ok' ? 200 : 503).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    dbLatencyMs: Date.now() - t0,
    ai: { provider: aiProvider.name, model: aiProvider.model },
    policyVersion: (await getActivePolicy()).version,
    demoMode: env.DEMO_MODE,
  });
});

/** The customer-facing policy, rendered from the active version so it always matches the engine. */
publicRouter.get('/policy', async (_req, res) => {
  const policy = await getActivePolicy();
  res.json({
    version: policy.version,
    markdown: renderPolicyDocument(policy),
    rules: [...ruleCatalog(policy).values()],
  });
});

/** Demo only: lists synthetic customers with the scenario each one exercises. */
publicRouter.get('/demo/customers', async (_req, res) => {
  if (!env.DEMO_MODE) throw HttpError.notFound();
  const customers = await listCustomers();
  const scenarios = new Map(SEED_CUSTOMERS.map((c) => [c.id, c.scenario]));
  // Only the documented personas; background customers exist to populate the console.
  res.json({
    customers: customers
      .filter((c) => scenarios.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, email: c.email, tier: c.tier, scenario: scenarios.get(c.id) ?? null })),
  });
});

/**
 * Demo sign-in: stands in for the store's real customer authentication. The chat API
 * derives identity only from this token, so a customer can never act on another account.
 */
publicRouter.post('/auth/customer/demo-login', demoLoginLimiter, async (req, res) => {
  if (!env.DEMO_MODE) throw HttpError.notFound();
  const { customerId } = z.object({ customerId: z.string().min(1).max(64) }).parse(req.body);
  const customer = await getCustomer(customerId);
  if (!customer) throw HttpError.notFound('Customer not found');
  const token = await signToken({ kind: 'customer', customerId }, '12h');
  res.json({ token, customer: publicCustomer(customer), orders: await listOrdersForCustomer(customerId) });
});

publicRouter.post('/auth/admin/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = z
    .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) })
    .parse(req.body);
  if (!passwordMatches(password, env.ADMIN_PASSWORD)) throw HttpError.unauthorized('Invalid credentials');
  const token = await signToken({ kind: 'admin', username }, '8h');
  res.json({ token, username });
});
