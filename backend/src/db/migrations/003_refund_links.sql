-- Link each ledger entry to the case that produced it and the items it covered, so a
-- customer (and a reviewer) can see exactly what was refunded, when, and how it was decided.
ALTER TABLE refunds ADD COLUMN request_id TEXT REFERENCES refund_requests(id) ON DELETE SET NULL;
ALTER TABLE refunds ADD COLUMN item_ids TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX refunds_order_idx ON refunds (order_id, created_at);
