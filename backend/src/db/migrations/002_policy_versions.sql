-- Published refund policies. Versions are immutable; exactly one is active at a time.
CREATE TABLE policy_versions (
  id           SERIAL PRIMARY KEY,
  version      TEXT NOT NULL UNIQUE,
  config       JSONB NOT NULL,
  custom_rules JSONB NOT NULL DEFAULT '[]',
  note         TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active    BOOLEAN NOT NULL DEFAULT false
);

-- The database itself guarantees there is never more than one active policy.
CREATE UNIQUE INDEX policy_versions_single_active ON policy_versions (is_active) WHERE is_active;
