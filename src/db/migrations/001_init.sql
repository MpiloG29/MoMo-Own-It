CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  msisdn      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  image_url         TEXT,
  price_cents       BIGINT NOT NULL CHECK (price_cents > 0),
  mode              TEXT NOT NULL CHECK (mode IN ('reserve', 'take_it_now')),
  min_weekly_cents  BIGINT NOT NULL CHECK (min_weekly_cents > 0),
  max_weeks         INTEGER NOT NULL CHECK (max_weeks BETWEEN 1 AND 260),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_supplier_idx ON items (supplier_id);

CREATE TABLE IF NOT EXISTS plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             UUID NOT NULL REFERENCES items(id),
  supplier_id         UUID NOT NULL REFERENCES suppliers(id),
  buyer_msisdn        TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('reserve', 'take_it_now')),
  possession          TEXT NOT NULL CHECK (possession IN ('on_completion', 'immediate')),
  total_cents         BIGINT NOT NULL CHECK (total_cents > 0),
  weekly_amount_cents BIGINT NOT NULL CHECK (weekly_amount_cents > 0),
  weeks               INTEGER NOT NULL CHECK (weeks > 0),
  paid_cents          BIGINT NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  periods_covered     INTEGER NOT NULL DEFAULT 0,
  missed_count        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('active', 'behind', 'complete', 'cancelled')),
  next_due_at         TIMESTAMPTZ,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  collection_code     TEXT,
  CONSTRAINT paid_not_over_total CHECK (paid_cents <= total_cents)
);

CREATE INDEX IF NOT EXISTS plans_buyer_idx ON plans (buyer_msisdn);
CREATE INDEX IF NOT EXISTS plans_due_idx ON plans (next_due_at) WHERE status IN ('active', 'behind');

CREATE TABLE IF NOT EXISTS payments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id                   UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  amount_cents              BIGINT NOT NULL CHECK (amount_cents > 0),
  -- MoMo X-Reference-Id. Our idempotency key: one row per requestToPay, ever.
  momo_reference            UUID NOT NULL UNIQUE,
  status                    TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'failed')),
  financial_transaction_id  TEXT,
  failure_reason            TEXT,
  due_at                    TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_plan_idx ON payments (plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS unlock_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  sequence      INTEGER NOT NULL,
  days_granted  INTEGER NOT NULL,
  permanent     BOOLEAN NOT NULL DEFAULT FALSE,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  UNIQUE (plan_id, sequence)
);

CREATE TABLE IF NOT EXISTS disbursements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  momo_reference  UUID NOT NULL UNIQUE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'failed')),
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ,
  -- Reserve pays out exactly once per plan.
  UNIQUE (plan_id)
);
