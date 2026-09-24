-- RefundDesk schema. Money is stored as integer cents. Timestamps are UTC.

CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  tier          TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'silver', 'gold')),
  account_flags TEXT[] NOT NULL DEFAULT '{}',
  member_since  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id                   TEXT PRIMARY KEY,
  order_number         TEXT NOT NULL UNIQUE,
  customer_id          TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status               TEXT NOT NULL CHECK (status IN ('processing', 'shipped', 'delivered', 'cancelled')),
  ordered_at           TIMESTAMPTZ NOT NULL,
  shipped_at           TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  expected_delivery_at TIMESTAMPTZ,
  carrier_tracking     TEXT,
  total_cents          INTEGER NOT NULL CHECK (total_cents >= 0),
  currency             TEXT NOT NULL DEFAULT 'USD'
);
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  final_sale        BOOLEAN NOT NULL DEFAULT false,
  refunded_quantity INTEGER NOT NULL DEFAULT 0,
  CHECK (refunded_quantity BETWEEN 0 AND quantity)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- Ledger of money actually returned. In production an outbox would hand these to the PSP.
CREATE TABLE refunds (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id  TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  source       TEXT NOT NULL CHECK (source IN ('historical', 'automated', 'human_review')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refunds_customer_created_idx ON refunds (customer_id, created_at DESC);

CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_customer_idx ON conversations (customer_id, updated_at DESC);

-- A refund case: one decision about one order. Created only when the pipeline reaches a decision.
CREATE TABLE refund_requests (
  id                  TEXT PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id            TEXT REFERENCES orders(id) ON DELETE SET NULL,
  customer_message    TEXT NOT NULL,
  reason_category     TEXT NOT NULL,
  reason_summary      TEXT NOT NULL,
  system_decision     TEXT NOT NULL CHECK (system_decision IN ('APPROVED', 'DENIED', 'ESCALATED')),
  status              TEXT NOT NULL CHECK (status IN ('APPROVED', 'DENIED', 'ESCALATED')),
  refund_amount_cents INTEGER NOT NULL DEFAULT 0,
  review_amount_cents INTEGER NOT NULL DEFAULT 0,
  line_decisions      JSONB NOT NULL DEFAULT '[]',
  rules_triggered     JSONB NOT NULL DEFAULT '[]',
  risk_flags          TEXT[] NOT NULL DEFAULT '{}',
  extraction          JSONB,
  trace               JSONB NOT NULL DEFAULT '[]',
  customer_reply      TEXT NOT NULL,
  internal_note       TEXT,
  ai_provider         TEXT NOT NULL,
  ai_model            TEXT NOT NULL,
  policy_version      TEXT NOT NULL,
  latency_ms          INTEGER NOT NULL,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refund_requests_created_idx ON refund_requests (created_at DESC);
CREATE INDEX refund_requests_status_idx ON refund_requests (status, created_at DESC);
CREATE INDEX refund_requests_order_idx ON refund_requests (order_id);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('customer', 'assistant', 'agent')),
  content         TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

-- Append-only audit trail for AI steps, decisions, security events and human actions.
CREATE TABLE audit_events (
  id              BIGSERIAL PRIMARY KEY,
  request_id      TEXT REFERENCES refund_requests(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  actor           TEXT NOT NULL,
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  detail          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_request_idx ON audit_events (request_id, created_at);
CREATE INDEX audit_events_type_idx ON audit_events (type, created_at DESC);
