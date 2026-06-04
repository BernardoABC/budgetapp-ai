# Splits & Reconcile Wiring — Design Spec

**Date:** 2026-06-04  
**Status:** Approved

## Problem

Two modal actions in `frontend/src/components/Accounts.tsx` show a toast and do nothing:

```typescript
const saveSplit = () => { setModal(null); toast.info('Split persistence is not yet wired to the API'); };
const reconcile = (_diff: number) => { setModal(null); toast.info('Reconcile persistence is not yet wired to the API'); };
```

Both need wiring to real backend persistence.

---

## Database Schema

New migration file: `server/internal/database/migrations/004_splits_reconcile.sql`

```sql
-- Reconciled flag on transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT false;

-- Split rows with FK to categories
CREATE TABLE IF NOT EXISTS transaction_splits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    amount          BIGINT NOT NULL,   -- centimos, always positive (outflow portion)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_splits_transaction ON transaction_splits(transaction_id);
```

- `reconciled` defaults `false` for all existing rows — safe, non-breaking.
- `ON DELETE CASCADE` on `transaction_splits.transaction_id` means deleting a transaction automatically removes its splits.
- `ON DELETE SET NULL` on `category_id` means deleting a category doesn't orphan the split row.

---

## Backend Go

### `server/internal/model/transaction.go`

Add `SplitRow` type and extend existing structs:

```go
type SplitRow struct {
    CategoryID   string `json:"category_id"`
    CategoryName string `json:"category"`   // populated via JOIN on reads
    Amount       int64  `json:"amount"`     // centimos
}
```

- Add `Reconciled bool` and `Splits []SplitRow` to `Transaction`.
- Add `Splits []SplitRow` to `UpdateTransactionReq` (category_id + amount in centimos; empty slice clears all splits).

### `server/internal/repository/transaction_repo.go`

**`ListByAccount` and `Get`:**  
Add to the SELECT query:
- `LEFT JOIN transaction_splits s ON s.transaction_id = t.id`
- `LEFT JOIN categories c2 ON c2.id = s.category_id`
- `json_agg(json_build_object('category', c2.name, 'amount', s.amount) ORDER BY s.created_at) FILTER (WHERE s.id IS NOT NULL)` aliased as `splits`
- Extend `GROUP BY` to cover all non-aggregate columns (all `t.*` fields + `c.name`)
- Scan splits column as `json.RawMessage`, unmarshal into `[]SplitRow`
- Also scan `t.reconciled`

The two summary/count sub-queries (no splits join) are unchanged.

**`Update`:**  
Inside the existing DB transaction, after updating the `transactions` row:
1. `DELETE FROM transaction_splits WHERE transaction_id = $id`
2. Batch-insert new splits (one `INSERT` per row, same tx)

If `req.Splits` is empty, the DELETE alone clears existing splits.

**New method `Reconcile`:**

```go
func (r *TransactionRepo) Reconcile(ctx context.Context, accountID string, adjustment int64) (int64, error)
```

1. Begin DB transaction
2. If `adjustment != 0`: insert a transaction (`payee = "Reconciliation Adjustment"`, `cleared = true`, `reconciled = true`, `amount = adjustment`) and `UPDATE accounts SET balance = balance + $adjustment`
3. `UPDATE transactions SET reconciled = true WHERE account_id = $1 AND cleared = true` — capture rows affected
4. Commit; return affected count

### `server/internal/handler/transactions.go`

**`toResponse`:** include `reconciled` (bool) and `splits` (`[]map[string]any` with `category` name + `amount` in centimos) in the returned map.

**New handler `Reconcile`:**
- Parse `{ adjustment: int64 }` from request body
- Call `repo.Reconcile`
- Return `{ reconciled_count: int64 }`

### `server/main.go`

```go
mux.HandleFunc("POST /api/accounts/{id}/reconcile", txns.Reconcile)
```

---

## Frontend

### `frontend/src/api.ts`

**`updateTransaction`:** add `splits?: { category_id: string; amount: number }[]` to body type. Split amounts are passed in centimos (caller converts). The function applies `Math.round(s.amount)` — no further multiply needed since the caller already centimo-converted.

**`mapApiTxn`:** 
- Map `splits` from API response: divide each `amount` by 100 → major units, pass `category` (name) through as-is.
- Add `reconciled: boolean` passthrough.

**New export:**
```typescript
export async function reconcileAccount(
  accountId: string,
  adjustment: number,  // major units
): Promise<{ reconciled_count: number }> {
  return apiFetch(`/accounts/${accountId}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ adjustment: Math.round(adjustment * 100) }),
  });
}
```

### `frontend/src/components/Accounts.tsx`

**`saveSplit(id: string, splits: { category: string; amount: number }[])`:**
1. Find the transaction in `page.transactions` by `id`
2. Resolve each category name → ID via `categoryIdByName`
3. Call `updateTransaction(id, { date, payee, category_id, amount, memo, cleared, splits: splits.map(s => ({ category_id: categoryIdByName[s.category], amount: Math.round(s.amount * 100) })) })`
4. On success: `setModal(null)`, `toast.success('Split saved')`, `onAccountsChanged()`, `reload()`
5. On error: `toast.error(...)`, `reload()`

**`reconcile(diff: number)`:**
1. Call `reconcileAccount(accountId, diff)`
2. On success: `setModal(null)`, `toast.success('Reconciled')`, `onAccountsChanged()`, `reload()`
3. On error: `toast.error(...)`

No new loading state needed — modals close immediately and the list reloads in the background, same pattern as `toggleCleared`.

---

## Constraints

- Inline styles only — no CSS, no Tailwind
- No new npm dependencies
- Money in centimos server-side; `api.ts` converts at the boundary
- `go test ./...` and `npm run build` must pass
