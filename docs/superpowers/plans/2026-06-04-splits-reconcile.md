# Splits & Reconcile Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `saveSplit` and `reconcile` in `Accounts.tsx` to real backend persistence via a new `transaction_splits` table and a `POST /api/accounts/{id}/reconcile` endpoint.

**Architecture:** A new migration adds a `transaction_splits` child table (FK cascade) and a `reconciled` boolean to `transactions`. The repo layer handles delete-then-reinsert of splits inside the existing `Update` transaction, and a new `Reconcile` method creates an optional adjustment transaction and bulk-marks cleared rows as reconciled. The frontend resolves split category names → IDs before calling the API, and maps IDs → names on reads via the JSON-aggregated response.

**Tech Stack:** Go 1.22, pgx/v5, PostgreSQL 15+, React 19, TypeScript 5

---

## File Map

| File | Change |
|---|---|
| `server/internal/database/migrations/004_splits_reconcile.sql` | **Create** — migration |
| `server/internal/model/transaction.go` | **Modify** — add `SplitRow`, extend `Transaction` and `UpdateTransactionReq` |
| `server/internal/repository/transaction_repo.go` | **Modify** — `Update` (splits), `Get`, `ListByAccount` (splits + reconciled), new `Reconcile` |
| `server/internal/repository/transaction_repo_test.go` | **Modify** — new tests for splits and Reconcile |
| `server/internal/handler/transactions.go` | **Modify** — `toResponse`, new `Reconcile` handler and request struct |
| `server/main.go` | **Modify** — register `POST /api/accounts/{id}/reconcile` |
| `frontend/src/api.ts` | **Modify** — `Transaction` interface, `updateTransaction`, `mapApiTxn`, new `reconcileAccount` |
| `frontend/src/components/Accounts.tsx` | **Modify** — `saveSplit`, `reconcile` |

---

## Task 1: Migration

**Files:**
- Create: `server/internal/database/migrations/004_splits_reconcile.sql`

- [ ] **Step 1: Create the migration file**

```sql
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
```

- [ ] **Step 2: Verify migration runs**

```bash
cd server && go test ./... 2>&1 | head -20
```

Expected: tests pass or skip (DB migrations run automatically via `testutil.NewTestPool`). No compile errors.

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/004_splits_reconcile.sql
git commit -m "feat: add transaction_splits table and reconciled column"
```

---

## Task 2: Go model

**Files:**
- Modify: `server/internal/model/transaction.go`

- [ ] **Step 1: Add `SplitRow` and extend the existing structs**

Replace the entire file with:

```go
package model

type SplitRow struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category"`  // populated via JOIN on reads; ignored on writes
	Amount       int64  `json:"amount"`    // centimos
}

type Transaction struct {
	ID           string
	AccountID    string
	CategoryID   string    // empty string if NULL
	CategoryName string    // populated via JOIN; empty if no category
	Date         string    // "YYYY-MM-DD"
	Amount       int64     // centimos; negative=outflow, positive=inflow
	Currency     string
	Payee        string
	Memo         string
	Cleared      bool
	Reconciled   bool
	ExchangeRate *float64  // nil if not stamped
	Splits       []SplitRow
}

type CreateTransactionReq struct {
	Date       string `json:"date"`
	Payee      string `json:"payee"`
	CategoryID string `json:"category_id"`
	Amount     int64  `json:"amount"` // signed minor units (negative = outflow)
	Memo       string `json:"memo"`
	Cleared    bool   `json:"cleared"`
}

type UpdateTransactionReq struct {
	Date       string     `json:"date"`
	Payee      string     `json:"payee"`
	CategoryID string     `json:"category_id"`
	Amount     int64      `json:"amount"` // signed minor units (negative = outflow)
	Memo       string     `json:"memo"`
	Cleared    bool       `json:"cleared"`
	Splits     []SplitRow `json:"splits"` // category_id + amount (centimos); nil/empty clears splits
}
```

- [ ] **Step 2: Verify compile**

```bash
cd server && go build ./...
```

Expected: exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add server/internal/model/transaction.go
git commit -m "feat: add SplitRow type and extend Transaction/UpdateTransactionReq"
```

---

## Task 3: Repo — `Update` with splits

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_UpdateSplits_StoresAndClearsRows(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat1 := testutil.SeedCategory(t, pool)
	cat2 := testutil.SeedCategory(t, pool)
	txnID := testutil.SeedTransactionFull(t, pool, acc, cat1, "2026-04-01", -5000, "SUPER", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// first update: store two splits
	_, err := repo.Update(ctx, txnID, model.UpdateTransactionReq{
		Date: "2026-04-01", Payee: "SUPER", CategoryID: cat1, Amount: -5000,
		Splits: []model.SplitRow{
			{CategoryID: cat1, Amount: 3000},
			{CategoryID: cat2, Amount: 2000},
		},
	})
	if err != nil {
		t.Fatalf("first update: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = $1::uuid`, txnID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("after first update want 2 splits, got %d", count)
	}

	// second update: clear splits
	_, err = repo.Update(ctx, txnID, model.UpdateTransactionReq{
		Date: "2026-04-01", Payee: "SUPER", CategoryID: cat1, Amount: -5000,
		Splits: nil,
	})
	if err != nil {
		t.Fatalf("second update: %v", err)
	}

	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = $1::uuid`, txnID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("after clear update want 0 splits, got %d", count)
	}
}
```

Also add `"budgetapp/internal/model"` to the test file's imports if it isn't already there.

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_UpdateSplits -v
```

Expected: FAIL — `repo.Update` doesn't handle splits yet.

- [ ] **Step 3: Update `Update` in `transaction_repo.go` to delete+insert splits**

In `Update` (around line 274), replace the `QueryRow` block and everything after until `tx.Commit` with:

```go
	var t model.Transaction
	err = tx.QueryRow(ctx, `
		UPDATE transactions
		SET category_id=$1, date=$2, amount=$3, payee=$4, memo=NULLIF($5,''), cleared=$6, updated_at=NOW()
		WHERE id=$7
		RETURNING id::text, account_id::text,
		          COALESCE(category_id::text,''), '',
		          date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled
	`, catIDParam, req.Date, newAmount, req.Payee, req.Memo, req.Cleared, id,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared, &t.Reconciled)
	if err != nil {
		return t, fmt.Errorf("update transaction: %w", err)
	}

	diff := newAmount - oldAmount
	if diff != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
			diff, accountID,
		); err != nil {
			return t, fmt.Errorf("update balance: %w", err)
		}
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM transaction_splits WHERE transaction_id = $1`, id,
	); err != nil {
		return t, fmt.Errorf("delete splits: %w", err)
	}
	for _, s := range req.Splits {
		var catParam interface{}
		if s.CategoryID != "" {
			catParam = s.CategoryID
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES ($1, $2, $3)`,
			id, catParam, s.Amount,
		); err != nil {
			return t, fmt.Errorf("insert split: %w", err)
		}
	}

	if t.CategoryID != "" {
		tx.QueryRow(ctx, `SELECT name FROM categories WHERE id = $1`, t.CategoryID).Scan(&t.CategoryName) //nolint:errcheck
	}

	return t, tx.Commit(ctx)
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_UpdateSplits -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/transaction_repo.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: persist splits in Update (delete-then-insert within tx)"
```

---

## Task 4: Repo — `ListByAccount` and `Get` return splits + reconciled

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_ListWithSplits(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat1 := testutil.SeedCategory(t, pool)
	cat2 := testutil.SeedCategory(t, pool)
	txnID := testutil.SeedTransactionFull(t, pool, acc, cat1, "2026-04-01", -5000, "SUPER", "", false)

	// Insert splits directly to test the read path independently of Update
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO transaction_splits (transaction_id, category_id, amount)
		VALUES ($1::uuid, $2::uuid, 3000), ($1::uuid, $3::uuid, 2000)
	`, txnID, cat1, cat2); err != nil {
		t.Fatalf("seed splits: %v", err)
	}

	repo := repository.NewTransactionRepo(pool)
	txns, _, _, err := repo.ListByAccount(context.Background(), acc, repository.TxnFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(txns) == 0 {
		t.Fatal("expected at least one transaction")
	}
	if len(txns[0].Splits) != 2 {
		t.Errorf("want 2 splits, got %d", len(txns[0].Splits))
	}
	total := txns[0].Splits[0].Amount + txns[0].Splits[1].Amount
	if total != 5000 {
		t.Errorf("want split total 5000, got %d", total)
	}
}
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_ListWithSplits -v
```

Expected: FAIL — scan mismatch (wrong column count).

- [ ] **Step 3: Add `"encoding/json"` to imports in `transaction_repo.go`**

In the `import` block at the top of `transaction_repo.go`, add `"encoding/json"`.

- [ ] **Step 4: Replace the paginated `Query` in `ListByAccount`**

Find the `r.pool.Query(ctx, \`` block (around line 148) and replace it with:

```go
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(
		         json_agg(
		           json_build_object('category', c2.name, 'amount', s.amount)
		           ORDER BY s.created_at
		         ) FILTER (WHERE s.id IS NOT NULL),
		         '[]'::json
		       ) AS splits
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		LEFT JOIN transaction_splits s ON s.transaction_id = t.id
		LEFT JOIN categories c2 ON c2.id = s.category_id
		WHERE `+where+`
		GROUP BY t.id, c.name
		ORDER BY `+sortClause(f.Sort)+`
		LIMIT `+limPlace+` OFFSET `+offPlace, pageArgs...)
```

- [ ] **Step 5: Replace the scan inside the `for rows.Next()` loop**

Find the existing `rows.Scan(...)` call and replace it with:

```go
		var t model.Transaction
		var splitsJSON []byte
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate, &t.Reconciled, &splitsJSON); err != nil {
			return nil, 0, summary, fmt.Errorf("scan transaction: %w", err)
		}
		if len(splitsJSON) > 0 {
			if err := json.Unmarshal(splitsJSON, &t.Splits); err != nil {
				return nil, 0, summary, fmt.Errorf("unmarshal splits: %w", err)
			}
		}
```

- [ ] **Step 6: Replace the `Get` query and scan**

Replace the entire `Get` function body with:

```go
func (r *TransactionRepo) Get(ctx context.Context, id string) (model.Transaction, error) {
	var t model.Transaction
	var splitsJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(
		         json_agg(
		           json_build_object('category', c2.name, 'amount', s.amount)
		           ORDER BY s.created_at
		         ) FILTER (WHERE s.id IS NOT NULL),
		         '[]'::json
		       ) AS splits
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		LEFT JOIN transaction_splits s ON s.transaction_id = t.id
		LEFT JOIN categories c2 ON c2.id = s.category_id
		WHERE t.id = $1
		GROUP BY t.id, c.name
	`, id).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
		&t.ExchangeRate, &t.Reconciled, &splitsJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return t, ErrNotFound
		}
		return t, fmt.Errorf("get transaction %s: %w", id, err)
	}
	if len(splitsJSON) > 0 {
		if err := json.Unmarshal(splitsJSON, &t.Splits); err != nil {
			return t, fmt.Errorf("unmarshal splits: %w", err)
		}
	}
	return t, nil
}
```

- [ ] **Step 7: Run the test**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_ListWithSplits -v
```

Expected: PASS.

- [ ] **Step 8: Run all tests**

```bash
cd server && go test ./...
```

Expected: all pass or skip.

- [ ] **Step 9: Commit**

```bash
git add server/internal/repository/transaction_repo.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: ListByAccount and Get return splits and reconciled via json_agg"
```

---

## Task 5: Repo — `Reconcile` method

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write failing tests**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_Reconcile_NoAdjustment(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-03", -3000, "C", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	count, err := repo.Reconcile(ctx, acc, 0)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("want 2 reconciled, got %d", count)
	}

	var reconciledInDB int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE account_id = $1::uuid AND reconciled = true`, acc,
	).Scan(&reconciledInDB) //nolint:errcheck
	if reconciledInDB != 2 {
		t.Errorf("want 2 reconciled rows in DB, got %d", reconciledInDB)
	}
}

func TestTransactionRepo_Reconcile_WithAdjustment(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, err := repo.Reconcile(ctx, acc, 500)
	if err != nil {
		t.Fatal(err)
	}

	var adjCount int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE account_id = $1::uuid AND payee = 'Reconciliation Adjustment'`, acc,
	).Scan(&adjCount) //nolint:errcheck
	if adjCount != 1 {
		t.Errorf("want 1 adjustment transaction, got %d", adjCount)
	}

	var balance int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, acc).Scan(&balance) //nolint:errcheck
	if balance != 500 {
		t.Errorf("want account balance 500, got %d", balance)
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_Reconcile -v
```

Expected: FAIL — `repo.Reconcile` undefined.

- [ ] **Step 3: Add `Reconcile` method to `transaction_repo.go`**

Append after `BatchUpdate`:

```go
// Reconcile marks all cleared transactions in an account as reconciled.
// If adjustment != 0, it first inserts a "Reconciliation Adjustment" transaction
// (cleared + reconciled) and adjusts the account balance.
// Returns the number of transactions marked reconciled.
func (r *TransactionRepo) Reconcile(ctx context.Context, accountID string, adjustment int64) (int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if adjustment != 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO transactions (account_id, date, amount, currency, payee, cleared, reconciled)
			VALUES ($1, NOW()::date, $2, (SELECT currency FROM accounts WHERE id=$1::uuid), 'Reconciliation Adjustment', true, true)
		`, accountID, adjustment); err != nil {
			return 0, fmt.Errorf("insert adjustment: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
			adjustment, accountID,
		); err != nil {
			return 0, fmt.Errorf("update balance: %w", err)
		}
	}

	tag, err := tx.Exec(ctx,
		`UPDATE transactions SET reconciled = true WHERE account_id = $1::uuid AND cleared = true`,
		accountID,
	)
	if err != nil {
		return 0, fmt.Errorf("reconcile transactions: %w", err)
	}

	return tag.RowsAffected(), tx.Commit(ctx)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_Reconcile -v
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

```bash
cd server && go test ./...
```

Expected: all pass or skip.

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/transaction_repo.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: add TransactionRepo.Reconcile method"
```

---

## Task 6: Handler — `toResponse`, `Reconcile` handler, and route

**Files:**
- Modify: `server/internal/handler/transactions.go`
- Modify: `server/main.go`

- [ ] **Step 1: Update `toResponse` to include `reconciled` and `splits`**

Replace the `toResponse` function in `server/internal/handler/transactions.go`:

```go
func (h *TransactionHandler) toResponse(t model.Transaction) map[string]any {
	var category any = nil
	if t.CategoryName != "" {
		category = t.CategoryName
	}
	var categoryID any = nil
	if t.CategoryID != "" {
		categoryID = t.CategoryID
	}
	splits := make([]map[string]any, len(t.Splits))
	for i, s := range t.Splits {
		splits[i] = map[string]any{"category": s.CategoryName, "amount": s.Amount}
	}
	return map[string]any{
		"id":            t.ID,
		"account":       t.AccountID,
		"date":          t.Date,
		"payee":         t.Payee,
		"category":      category,
		"category_id":   categoryID,
		"memo":          t.Memo,
		"amount":        t.Amount,
		"currency":      t.Currency,
		"cleared":       t.Cleared,
		"reconciled":    t.Reconciled,
		"exchange_rate": t.ExchangeRate,
		"splits":        splits,
	}
}
```

- [ ] **Step 2: Add `reconcileReq` struct and `Reconcile` handler**

Append to `server/internal/handler/transactions.go` (after the `Batch` function):

```go
type reconcileReq struct {
	Adjustment int64 `json:"adjustment"`
}

func (h *TransactionHandler) Reconcile(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	var req reconcileReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	count, err := h.repo.Reconcile(r.Context(), accountID, req.Adjustment)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reconciled_count": count})
}
```

- [ ] **Step 3: Register the route in `server/main.go`**

Find the block with the transaction routes (around line 105) and add after `POST /api/accounts/{id}/transactions`:

```go
mux.HandleFunc("POST /api/accounts/{id}/reconcile", txns.Reconcile)
```

- [ ] **Step 4: Build**

```bash
cd server && go build ./...
```

Expected: exits 0.

- [ ] **Step 5: Run all tests**

```bash
cd server && go test ./...
```

Expected: all pass or skip.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/transactions.go server/main.go
git commit -m "feat: expose reconciled+splits in toResponse, add Reconcile handler and route"
```

---

## Task 7: Frontend — `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add `reconciled` to the `Transaction` interface**

Find the `Transaction` interface and add `reconciled: boolean` after `cleared: boolean`:

```typescript
export interface Transaction {
  id: string;
  date: string;
  payee: string;
  category: string | null;
  memo: string;
  outflow: number;
  inflow: number;
  cleared: boolean;
  reconciled: boolean;
  account: string;
  currency?: string;
  exchange_rate?: number | null;
  splits?: { category: string; amount: number }[];
}
```

- [ ] **Step 2: Extend `updateTransaction` to accept splits**

Replace the `updateTransaction` function:

```typescript
export async function updateTransaction(
  id: string,
  body: {
    date?: string; payee?: string; category_id?: string; amount?: number;
    memo?: string; cleared?: boolean;
    splits?: { category_id: string; amount: number }[]; // amounts in centimos
  },
): Promise<Transaction> {
  const payload = body.amount === undefined ? body : { ...body, amount: Math.round(body.amount * 100) };
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
```

Note: split amounts are passed in centimos by the caller — no additional conversion happens here.

- [ ] **Step 3: Update `mapApiTxn` to map splits and reconciled**

Replace the `mapApiTxn` function:

```typescript
function mapApiTxn(t: {
  id: string; date: string; payee: string; category: string | null; memo: string;
  cleared: boolean; account: string; currency: string; amount: number;
  exchange_rate?: number | null; reconciled?: boolean;
  splits?: { category: string; amount: number }[];
}): Transaction {
  const major = t.amount / 100;
  return {
    id: t.id, date: t.date, payee: t.payee, category: t.category,
    memo: t.memo, cleared: t.cleared, account: t.account,
    currency: t.currency, exchange_rate: t.exchange_rate,
    outflow: major < 0 ? -major : 0,
    inflow: major > 0 ? major : 0,
    reconciled: t.reconciled ?? false,
    splits: (t.splits ?? []).map(s => ({ category: s.category, amount: s.amount / 100 })),
  };
}
```

- [ ] **Step 4: Add `reconcileAccount`**

Append after `batchTransactions`:

```typescript
export async function reconcileAccount(
  accountId: string,
  adjustment: number, // major units (will be converted to centimos)
): Promise<{ reconciled_count: number }> {
  return apiFetch(`/accounts/${accountId}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ adjustment: Math.round(adjustment * 100) }),
  });
}
```

- [ ] **Step 5: Build**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: extend api.ts with splits, reconciled, and reconcileAccount"
```

---

## Task 8: Frontend — wire `Accounts.tsx`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add `reconcileAccount` to the import**

Find line 2 (the `../api` import) and add `reconcileAccount` to it:

```typescript
import { updateTransaction, deleteTransaction, createTransaction, fetchTransactionsPage, batchTransactions, reconcileAccount, type TxnPage, type TxnFilterParams } from '../api';
```

- [ ] **Step 2: Replace `saveSplit`**

Find (around line 214):

```typescript
  const saveSplit = () => { setModal(null); toast.info('Split persistence is not yet wired to the API'); };
```

Replace with:

```typescript
  const saveSplit = (id: string, splits: { category: string; amount: number }[]) => {
    const txn = page?.transactions.find(t => t.id === id);
    if (!txn) return;
    const category_id = txn.category ? (categoryIdByName[txn.category] ?? undefined) : undefined;
    const amount = txn.inflow > 0 ? txn.inflow : -txn.outflow;
    updateTransaction(id, {
      date: txn.date, payee: txn.payee, category_id, amount, memo: txn.memo, cleared: txn.cleared,
      splits: splits.map(s => ({ category_id: categoryIdByName[s.category] ?? '', amount: Math.round(s.amount * 100) })),
    })
      .then(() => { setModal(null); toast.success('Split saved'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('save split failed:', err); toast.error('Save failed: ' + (err as Error).message); reload(); });
  };
```

- [ ] **Step 3: Replace `reconcile`**

Find (around line 215):

```typescript
  const reconcile = (_diff: number) => { setModal(null); toast.info('Reconcile persistence is not yet wired to the API'); };
```

Replace with:

```typescript
  const reconcile = (diff: number) => {
    reconcileAccount(accountId, diff)
      .then(() => { setModal(null); toast.success('Reconciled'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('reconcile failed:', err); toast.error('Reconcile failed: ' + (err as Error).message); });
  };
```

- [ ] **Step 4: Build**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Run Go tests for a final full check**

```bash
cd server && go test ./...
```

Expected: all pass or skip.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: wire saveSplit and reconcile to real API calls"
```

---

## Self-Review

- **Spec coverage:** Migration ✓, splits table ✓, reconciled column ✓, Update with splits ✓, ListByAccount/Get with splits ✓, Reconcile repo method ✓, toResponse with reconciled+splits ✓, Reconcile handler ✓, route ✓, api.ts Transaction.reconciled ✓, updateTransaction splits ✓, mapApiTxn ✓, reconcileAccount ✓, Accounts.tsx saveSplit ✓, Accounts.tsx reconcile ✓.
- **No placeholders** — every step has complete code.
- **Type consistency:** `SplitRow.CategoryID`/`CategoryName`/`Amount` used consistently across model, repo, handler. `splits` in `updateTransaction` are `{ category_id, amount }` (centimos) throughout. `mapApiTxn` output `splits` uses `{ category, amount }` (major units) matching `Transaction.splits`.
