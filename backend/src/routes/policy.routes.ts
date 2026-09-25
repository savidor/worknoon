import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { REASON_CATEGORIES } from '../domain/types.js';
import { adminName, requireRole } from '../middleware/auth.js';
import { FIELDS, OPERATORS } from '../policy/custom-rules.js';
import { renderPolicyDocument } from '../policy/document.js';
import { DEFAULT_POLICY_CONFIG } from '../policy/policy.js';
import { normalizeDraft } from '../policy/policy-schema.js';
import { listVersions } from '../repositories/policy.repo.js';
import {
  activatePolicyVersion,
  getActivePolicy,
  policyImpact,
  publishPolicy,
  simulatePolicy,
} from '../services/policy.service.js';

/** Policy Studio: edit, test and publish refund policy versions. Admin only. */
export const policyRouter = Router();
policyRouter.use(requireRole('admin'));

policyRouter.get('/', async (_req, res) => {
  const [active, versions, categories, flags, orders] = await Promise.all([
    getActivePolicy(),
    listVersions(),
    pool.query<{ category: string }>('SELECT DISTINCT category FROM order_items ORDER BY category'),
    pool.query<{ flag: string }>('SELECT DISTINCT unnest(account_flags) AS flag FROM customers ORDER BY flag'),
    pool.query(
      `SELECT o.order_number, o.status, c.name AS customer_name,
              json_agg(json_build_object('sku', i.sku, 'name', i.name) ORDER BY i.id) AS items
       FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items i ON i.order_id = o.id
       WHERE o.order_number NOT LIKE 'WN-0%'
       GROUP BY o.id, c.name ORDER BY o.order_number`,
    ),
  ]);
  res.json({
    active,
    versions,
    catalog: {
      fields: FIELDS,
      operators: OPERATORS,
      reasons: REASON_CATEGORIES.filter((r) => r !== 'unknown'),
      knownCategories: categories.rows.map((r) => r.category),
      knownFlags: [...new Set([...flags.rows.map((r) => r.flag), ...DEFAULT_POLICY_CONFIG.riskAccountFlags])],
      orders: orders.rows,
    },
  });
});

const DraftBody = z.object({ draft: z.unknown() });

/** The customer-facing document as it would read if the draft were published. */
policyRouter.post('/preview', (req, res) => {
  const { draft } = DraftBody.parse(req.body);
  res.json({ markdown: renderPolicyDocument({ version: 'draft', ...normalizeDraft(draft) }) });
});

policyRouter.post('/simulate', async (req, res) => {
  const body = DraftBody.extend({
    orderNumber: z.string().trim().max(20),
    reason: z.enum(REASON_CATEGORIES),
    itemSkus: z.array(z.string().max(64)).max(20).optional(),
  }).parse(req.body);
  res.json(await simulatePolicy(body));
});

policyRouter.post('/impact', async (req, res) => {
  const body = DraftBody.extend({ limit: z.number().int().min(1).max(200).optional() }).parse(req.body);
  res.json(await policyImpact(body));
});

policyRouter.post('/publish', async (req, res) => {
  const body = DraftBody.extend({ note: z.string().trim().min(5, 'Explain the change in a short note').max(500) }).parse(req.body);
  const version = await publishPolicy(body.draft, body.note, adminName(req));
  res.status(201).json({ version });
});

policyRouter.post('/versions/:id/activate', async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { note } = z.object({ note: z.string().trim().min(5, 'Explain why you are restoring this version').max(500) }).parse(req.body);
  res.json({ version: await activatePolicyVersion(id, note, adminName(req)) });
});
