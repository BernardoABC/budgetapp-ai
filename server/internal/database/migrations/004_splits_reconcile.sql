-- server/internal/database/migrations/004_splits_reconcile.sql

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS transaction_splits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    amount          BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_splits_transaction ON transaction_splits(transaction_id);
