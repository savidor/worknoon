export type Decision = 'APPROVED' | 'DENIED' | 'ESCALATED';
export type Outcome = Decision | 'NEEDS_INFO' | 'INFO';

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
  status: 'processing' | 'shipped' | 'delivered' | 'cancelled';
  orderedAt: string;
  deliveredAt: string | null;
  expectedDeliveryAt: string | null;
  totalCents: number;
  currency: string;
  items: OrderItem[];
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  tier: string;
}

export interface DemoCustomer extends Customer {
  scenario: { title: string; expected: string; prompts: string[] } | null;
}

export interface MessageMeta {
  outcome?: Outcome;
  caseId?: string;
  caseReference?: string;
  orderNumber?: string | null;
  refundAmountCents?: number;
  reviewAmountCents?: number;
  lines?: Array<{ name: string; amountCents: number; decision: Decision }>;
  reasons?: string[];
}

export interface Message {
  id: string;
  role: 'customer' | 'assistant' | 'agent';
  content: string;
  meta: MessageMeta;
  createdAt: string;
}

export interface Health {
  status: string;
  db: string;
  ai: { provider: 'gemini' | 'mock'; model: string };
  policyVersion: string;
  demoMode: boolean;
}

export interface RequestSummary {
  id: string;
  reference: string;
  status: Decision;
  system_decision: Decision;
  reason_category: string;
  reason_summary: string;
  refund_amount_cents: number;
  review_amount_cents: number;
  risk_flags: string[];
  ai_provider: string;
  latency_ms: number;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  customer_message: string;
  customer_id: string;
  customer_name: string;
  order_number: string | null;
}

export interface TraceStep {
  stage: string;
  ms: number;
  status: 'ok' | 'warn' | 'fallback' | 'error';
  note?: string;
  data?: unknown;
}

export interface RequestDetail extends RequestSummary {
  conversation_id: string;
  customer_email: string;
  customer_tier: string;
  customer_flags: string[];
  order_status: string | null;
  order_total_cents: number | null;
  line_decisions: Array<{ itemId: string; sku: string; name: string; amountCents: number; decision: Decision; ruleIds: string[] }>;
  rules_triggered: Array<{ id: string; effect: Decision | 'FLAG'; detail: string; itemId?: string }>;
  extraction: Record<string, unknown> | null;
  trace: TraceStep[];
  customer_reply: string;
  internal_note: string | null;
  ai_model: string;
  policy_version: string;
  review_note: string | null;
}

export interface AuditEvent {
  id: number;
  actor: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Stats {
  total: number;
  approved: number;
  denied: number;
  pending_review: number;
  escalated_total: number;
  human_reviewed: number;
  flagged: number;
  refunded_cents: number;
  pending_cents: number;
  avg_latency_ms: number;
  daily: Array<{ day: string; approved: number; denied: number; escalated: number }>;
  reasons: Array<{ reason: string; count: number }>;
}

export type FieldType = 'enum' | 'string' | 'money' | 'number' | 'boolean';

export interface PolicyConfig {
  refundWindowDays: number;
  humanReviewThresholdCents: number;
  frequencyLookbackDays: number;
  frequencyMaxRefunds: number;
  lostParcelGraceDays: number;
  minExtractionConfidence: number;
  maxClarificationTurns: number;
  nonReturnableCategories: string[];
  riskAccountFlags: string[];
}

export interface Condition {
  field: string;
  operator: string;
  value: string | number | string[] | null;
}

export interface CustomRule {
  id?: string;
  name: string;
  enabled: boolean;
  effect: 'DENIED' | 'ESCALATED';
  conditions: Condition[];
  customerText: string;
}

export interface PolicyDraft {
  config: PolicyConfig;
  customRules: CustomRule[];
}

export interface PolicyVersion extends PolicyDraft {
  id: number;
  version: string;
  note: string;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

export interface PolicyStudioData {
  active: PolicyDraft & { version: string };
  versions: PolicyVersion[];
  catalog: {
    fields: Record<string, { label: string; type: FieldType; help: string; options?: string[] }>;
    operators: Record<string, { label: string; types: FieldType[] }>;
    reasons: string[];
    knownCategories: string[];
    knownFlags: string[];
    orders: Array<{ order_number: string; status: string; customer_name: string; items: Array<{ sku: string; name: string }> }>;
  };
}

export interface EvaluationView {
  decision: Decision;
  refundAmountCents: number;
  reviewAmountCents: number;
  lines: Array<{ itemId: string; sku: string; name: string; amountCents: number; decision: Decision; ruleIds: string[] }>;
  rules: Array<{ id: string; effect: Decision | 'FLAG'; detail: string; title: string; custom: boolean; itemId?: string }>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

const TOKEN_KEYS = { customer: 'rd.customerToken', admin: 'rd.adminToken' } as const;
export type Role = keyof typeof TOKEN_KEYS;

export const tokens = {
  get: (role: Role) => {
    try {
      return sessionStorage.getItem(TOKEN_KEYS[role]);
    } catch {
      return null;
    }
  },
  set: (role: Role, token: string | null) => {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEYS[role], token);
      else sessionStorage.removeItem(TOKEN_KEYS[role]);
    } catch {
      /* storage unavailable; session lasts for this page only */
    }
  },
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown; role?: Role } = {}): Promise<T> {
  const token = opts.role ? tokens.get(opts.role) : null;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && opts.role) tokens.set(opts.role, null);
    throw new ApiError(res.status, json?.error?.message ?? `Request failed (${res.status})`, Array.isArray(json?.error?.details) ? json.error.details : []);
  }
  return json as T;
}
