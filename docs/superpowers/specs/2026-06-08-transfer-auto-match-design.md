# Transfer Auto-Match — Design

## Summary

After a user manually links one transfer pair (establishing a payee mapping between two accounts), automatically propose all remaining same-payee pairs for batch confirmation. Pairs where the peer transaction already exists are linked; pairs where it doesn't are created (cleared) and linked. Everything executes atomically on confirm.

## Trigger

The feature activates in the existing `handleLinkConfirm` flow in `Accounts.tsx` — the same point where the current batch review modal is shown after a first manual link.

## Matching Logic

When the user confirms the first manual link, the system captures the **payee mapping** established by that link:

- `sourcePayee` — payee of the transaction in the current account (e.g. `TEF DE: 953435013`)
- `targetPayee` — payee of the transaction in the target account (e.g. `TEF A: 926452046`)
- `targetAccountId` — the account the peer transaction belongs to

For all subsequent unlinked transactions in the current account with `payee == sourcePayee`, a match is a transaction in `targetAccountId` where:
- `payee == targetPayee`
- `date == source.date` (exact)
- `amount == -source.amount` (opposite sign, same magnitude)
- `transfer_peer_id IS NULL`

Rows satisfying all four criteria → **Link** bucket.
Rows with no match in the target account → **Will create** bucket.

Source transactions that already have `transfer_peer_id` set are excluded entirely.

## Batch Review Modal Changes

The existing batch modal (`batchReview` state in `Accounts.tsx`) is updated:

- **"Will create" rows**: the right-hand cell shows a ghost peer with date, amount, payee, and a faint `New` badge instead of "No candidate found". The checkbox is **enabled and checked by default**.
- **Column header**: "Candidate" → "Peer (existing / to create)"
- All other layout, confirm flow, and "Done" (0-selectable) behaviour unchanged.

## Backend — New Endpoint

### Route

`POST /api/transfers/link-or-create-batch`

### Request

```json
{
  "pairs": [
    { "source_id": "uuid", "target_id": "uuid" },
    { "source_id": "uuid", "target_account_id": "uuid", "target_payee": "TEF A : 926452046", "target_date": "2026-05-03", "target_amount": 50000 }
  ]
}
```

Each pair has either `target_id` (link existing) or `target_account_id` + `target_payee` + `target_date` + `target_amount` (create then link). `target_amount` is in minor units (centimos), positive (the inflow side).

### Behaviour (single DB transaction)

**Link pairs** (`target_id` set):
- Same validation as `LinkTransferBatch`: both transactions exist, neither already linked, different accounts, amounts sum to zero.

**Create pairs** (`target_account_id` set):
1. **Idempotency check**: `SELECT id FROM transactions WHERE account_id=$targetAccountId AND date=$targetDate AND amount=$targetAmount AND payee=$targetPayee AND transfer_peer_id IS NULL LIMIT 1`. If found, treat as a link pair (use that ID).
2. Otherwise insert a new transaction: `account_id=$targetAccountId`, `date`, `amount` (positive), `payee`, `currency` from the account, `cleared=true`, `reconciled=false`, no category.
3. Update `accounts.balance` for `targetAccountId`.
4. Link both directions (`transfer_peer_id` on source and new/found peer).

A failure on any pair rolls back the entire batch.

### Response

```json
{ "linked": 4, "created": 2 }
```

## Duplicate Prevention

Two layers prevent double-creation:

1. **At create time (backend)**: idempotency check described above — if a matching unlinked transaction already exists, link it instead of inserting.
2. **At proposal time (frontend)**: source transactions with `transfer_peer_id` already set are excluded from the batch proposals before the modal opens.

## Scope

| File | Change |
|------|--------|
| `server/internal/repository/transaction_repo.go` | New `LinkOrCreateBatch(ctx, pairs []LinkOrCreatePair) (linked, created int, err error)` |
| `server/internal/handler/transactions.go` | New `LinkOrCreateBatch` handler; register route |
| `server/internal/model/transaction.go` | `LinkOrCreatePair` request struct (or inline in handler) |
| `frontend/src/api.ts` | New `linkOrCreateBatch(pairs)` function |
| `frontend/src/components/Accounts.tsx` | Update `handleLinkConfirm` matching logic; update batch modal UI; update `handleBatchLink` to call new API |

No DB schema changes. No new tables.
