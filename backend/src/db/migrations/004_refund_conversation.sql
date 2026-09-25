-- The conversation a refund came from. Cases already carry one; refunds made before RefundDesk
-- (by the support team) record theirs here, so every refund can be traced back to what was said.
ALTER TABLE refunds ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;
