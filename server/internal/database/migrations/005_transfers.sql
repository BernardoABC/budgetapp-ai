-- server/internal/database/migrations/005_transfers.sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_peer_id UUID
    REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_peer
  ON transactions(transfer_peer_id)
  WHERE transfer_peer_id IS NOT NULL;
