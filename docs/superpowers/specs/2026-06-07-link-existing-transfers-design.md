# Link Existing Transfers Design

## Goal

Allow users to link two already-imported transactions as a transfer pair (setting `transfer_peer_id` on both), either from the transaction list or as a post-import step. Supports batch-linking all transactions with the same payee via a review table.

---

## Scope

- Link two existing transactions to each other as a transfer pair
- Candidate selection is always manual (always show a list, never auto-link silently)
- Batch "apply to all with same payee" shows a review table with auto-proposed pairs; user confirms before committing
- Post-import: after importing rows flagged `is_transfer: true`, a link step is surfaced automatically
- Out of scope: creating new transfer legs from scratch (already handled by `POST /api/transfers`)

---

## Backend

### New repo methods (`TransactionRepo`)

**`TransferCandidates(ctx context.Context, accountID string, amount int64) ([]Transaction, error)`**
- Returns unlinked transactions (`transfer_peer_id IS NULL`) in `accountID` where `amount = -amount` (the exact opposite sign), ordered by `date DESC`
- Used to populate the candidate picker list

**`LinkTransfer(ctx context.Context, idA, idB string) error`**
- Validates:
  - Both rows exist
  - Neither already has a `transfer_peer_id`
  - They belong to different accounts
  - Their amounts sum to zero (`amount_a + amount_b = 0`)
- Atomically sets `transfer_peer_id = idB` on row A and `transfer_peer_id = idA` on row B in a single DB transaction
- Returns a 422-equivalent error if any validation fails

**`LinkTransferBatch(ctx context.Context, pairs [][2]string) (int, error)`**
- Links multiple pairs in one DB transaction using the same validation logic per pair
- Returns count of successfully linked pairs
- Rolls back all pairs if any fail

### New routes

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| `GET` | `/api/accounts/{id}/transfer-candidates` | `TransactionHandler.TransferCandidates` | Returns unlinked transactions with opposite amount |
| `POST` | `/api/transfers/link` | `TransactionHandler.Link` | Links two transactions as a transfer pair |
| `POST` | `/api/transfers/link-batch` | `TransactionHandler.LinkBatch` | Links multiple pairs atomically |

**`GET /api/accounts/{id}/transfer-candidates?amount={n}`**
- `amount` is the signed amount of the transaction being matched (e.g. `-5000`)
- Response: `{ transactions: Transaction[] }` — same shape as existing transaction responses

**`POST /api/transfers/link`**
- Body: `{ transaction_a_id: string, transaction_b_id: string }`
- Response: `{ from: Transaction, to: Transaction }` — both updated rows
- Errors: 400 if IDs missing, 422 if validation fails (already linked, same account, amounts don't match)

**`POST /api/transfers/link-batch`**
- Body: `{ pairs: [[a_id, b_id], ...] }`
- Response: `{ linked: number }`
- Rolls back entirely on any validation failure

---

## Frontend

### New API functions (`frontend/src/api.ts`)

```typescript
fetchTransferCandidates(accountId: string, amount: number): Promise<Transaction[]>
linkTransfer(transactionAId: string, transactionBId: string): Promise<{ from: Transaction; to: Transaction }>
linkTransferBatch(pairs: [string, string][]): Promise<{ linked: number }>
```

`amount` is passed in major units; converted to centimos (`Math.round(amount * 100)`) before the query param.

### "Link as transfer" on transaction rows (`Accounts.tsx`)

- Unlinked rows (no `transfer_peer_id`) show a small "Link" button in the category column area, visible on hover
- Already-linked rows show the existing "⇄ Transfer" badge (no link button)
- Clicking "Link" opens a two-step modal:
  1. **Pick account** — dropdown of all accounts except the current one; selecting one fetches candidates
  2. **Pick match** — scrollable list of candidates (date · payee · amount); click to select, then "Link" to confirm
- On success: both rows refresh showing the "⇄ Transfer" badge

### "Apply to all with same payee" batch flow

- After a successful single link, if other unlinked transactions in the current account share the same payee: show a prompt — *"N other [Payee] transactions are unlinked — match them all?"*
- Clicking opens a review table:

  | This account | | Target account (proposed) | Include |
  |---|---|---|---|
  | date · amount | → | closest-date candidate | ☑ |
  | date · amount | → | closest-date candidate | ☑ |
  | date · amount | → | *(no candidate)* | ☐ (disabled) |

- Proposed match = candidate with the smallest `|date_a - date_b|` difference (computed client-side from the already-fetched candidate list)
- User can uncheck rows; rows with no candidate are unchecked and disabled
- "Link All" button → calls `POST /api/transfers/link-batch` with checked pairs
- On success: all matched rows refresh

### Post-import link step (`Import.tsx`)

- During confirm review: rows with `is_transfer: true` display a "Transfer" badge (informational only, no action required before import)
- After import completes: if any imported rows had `is_transfer: true`, the success screen shows a "Link Transfers" section listing those transactions with a "Link" button next to each
- Clicking "Link" opens the same two-step modal (pick account → pick candidate)
- Once all are linked or skipped, the flow ends normally
- No changes to the import service or confirm API

---

## Data flow summary

```
User clicks "Link" on row
  → picks target account
  → GET /api/accounts/{target}/transfer-candidates?amount={-n}
  → picks candidate from list
  → POST /api/transfers/link { transaction_a_id, transaction_b_id }
  → both rows updated with transfer_peer_id
  → prompt: "N others with same payee — match all?"
    → review table with auto-proposed pairs
    → POST /api/transfers/link-batch { pairs: [...] }
```

---

## Error handling

- If `LinkTransfer` fails validation (amounts don't match, already linked, same account): show inline error in modal, keep modal open
- If `LinkTransferBatch` fails: show error toast, no rows linked (atomic rollback)
- If no candidates found: show empty state — "No unlinked transactions with matching amount found in this account"
