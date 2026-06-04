# Linked Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** When a user creates a transfer between two accounts, both sides are automatically created as linked transaction records — deleting or editing one side cascades to the peer (YNAB-style).

**Architecture:** A new `transfer_peer_id` column on `transactions` self-references the paired leg. A new `POST /api/transfers` endpoint creates both rows atomically in a single DB transaction. The existing `DELETE` and `PUT` handlers for transactions detect the peer link and cascade accordingly. The frontend gets a "Transfer" toggle in the add-transaction form.

**Tech Stack:** Go 1.22 (pgx/v5, net/http ServeMux), PostgreSQL, React + TypeScript (Vite)

---

## File Map

| File | Change |
|------|--------|
| `server/internal/database/migrations/005_transfers.sql` | **Create** — adds `transfer_peer_id` column |
| `server/internal/model/transaction.go` | **Modify** — add `TransferPeerID string` to `Transaction`; add `CreateTransferReq` |
| `server/internal/repository/transaction_repo.go` | **Modify** — add `CreateTransfer`; update `Delete` to cascade; update `Update` to mirror amount |
| `server/internal/repository/transaction_repo_test.go` | **Modify** — tests for transfer create, delete cascade, update mirror |
| `server/internal/handler/transactions.go` | **Modify** — add `CreateTransfer` handler; include `transfer_peer_id` in `toResponse` |
| `server/main.go` | **Modify** — register `POST /api/transfers` |
| `frontend/src/api.ts` | **Modify** — add `transfer_peer_id` to `Transaction`; add `createTransfer()` |
| `frontend/src/components/Accounts.tsx` | **Modify** — add Transfer toggle + to-account selector in add-transaction form |

---

### Task 1: DB Migration — add `transfer_peer_id`

**Files:**
- Create: `server/internal/database/migrations/005_transfers.sql`

- [x] **Step 1: Write the migration**

```sql
-- server/internal/database/migrations/005_transfers.sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_peer_id UUID
    REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_peer
  ON transactions(transfer_peer_id)
  WHERE transfer_peer_id IS NOT NULL;
```

`ON DELETE SET NULL` means if one leg is hard-deleted via raw SQL the other survives with a NULL peer — the Go layer always deletes both sides deliberately.

- [x] **Step 2: Apply the migration to dev DB**

```bash
psql $DATABASE_URL -f server/internal/database/migrations/005_transfers.sql
```

Expected: `ALTER TABLE` and `CREATE INDEX` printed with no errors.

- [x] **Step 3: Apply to test DB**

```bash
psql $TEST_DATABASE_URL -f server/internal/database/migrations/005_transfers.sql
```

- [x] **Step 4: Commit**

```bash
git add server/internal/database/migrations/005_transfers.sql
git commit -m "feat: add transfer_peer_id column to transactions"
```

---

### Task 2: Model — add TransferPeerID and CreateTransferReq

**Files:**
- Modify: `server/internal/model/transaction.go`

- [x] **Step 1: Update the model file**

Replace the entire file with:

```go
package model

type SplitRow struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category"`  // populated via JOIN on reads; ignored on writes
	Amount       int64  `json:"amount"`    // centimos
}

type Transaction struct {
	ID             string
	AccountID      string
	CategoryID     string   // empty string if NULL
	CategoryName   string   // populated via JOIN; empty if no category
	Date           string   // "YYYY-MM-DD"
	Amount         int64    // centimos; negative=outflow, positive=inflow
	Currency       string
	Payee          string
	Memo           string
	Cleared        bool
	Reconciled     bool
	ExchangeRate   *float64 // nil if not stamped
	Splits         []SplitRow
	TransferPeerID string   // empty if not a transfer
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

// CreateTransferReq describes a double-sided transfer between two accounts.
// Amount is positive minor units; the outflow side stores it negative, the inflow side positive.
type CreateTransferReq struct {
	FromAccountID string `json:"from_account_id"`
	ToAccountID   string `json:"to_account_id"`
	Date          string `json:"date"`
	Amount        int64  `json:"amount"` // positive minor units
	Memo          string `json:"memo"`
	Cleared       bool   `json:"cleared"`
}
```

- [x] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: no output (success).

- [x] **Step 3: Commit**

```bash
git add server/internal/model/transaction.go
git commit -m "feat: add TransferPeerID to Transaction and CreateTransferReq"
```

---

### Task 3: Repo — CreateTransfer method

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`

- [x] **Step 1: Write the failing test first (see Task 4 Step 1)**

Skip ahead to Task 4 Step 1 to write the test, then come back here.

- [x] **Step 2: Add CreateTransfer to transaction_repo.go**

Append this method after the existing `Create` method (around line 277):

```go
// CreateTransfer atomically inserts two linked transaction rows — one outflow
// from fromAccountID and one inflow to toAccountID — and updates both balances.
// Returns the outflow (from) leg first, then the inflow (to) leg.
func (r *TransactionRepo) CreateTransfer(ctx context.Context, req model.CreateTransferReq) (from, to model.Transaction, err error) {
	if req.Amount <= 0 {
		return from, to, fmt.Errorf("transfer amount must be positive")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return from, to, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Fetch account names for payee labels.
	var fromName, toName string
	if err := tx.QueryRow(ctx, `SELECT name FROM accounts WHERE id = $1::uuid`, req.FromAccountID).Scan(&fromName); err != nil {
		return from, to, fmt.Errorf("get from-account: %w", err)
	}
	if err := tx.QueryRow(ctx, `SELECT name FROM accounts WHERE id = $1::uuid`, req.ToAccountID).Scan(&toName); err != nil {
		return from, to, fmt.Errorf("get to-account: %w", err)
	}

	// Insert outflow leg (negative amount).
	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (account_id, date, amount, currency, payee, memo, cleared)
		VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, NULLIF($5,''), $6)
		RETURNING id::text, account_id::text, '', '', date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled
	`, req.FromAccountID, req.Date, -req.Amount, "Transfer : "+toName, req.Memo, req.Cleared,
	).Scan(&from.ID, &from.AccountID, &from.CategoryID, &from.CategoryName,
		&from.Date, &from.Amount, &from.Currency, &from.Payee, &from.Memo, &from.Cleared, &from.Reconciled); err != nil {
		return from, to, fmt.Errorf("insert from leg: %w", err)
	}

	// Insert inflow leg (positive amount).
	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (account_id, date, amount, currency, payee, memo, cleared)
		VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, NULLIF($5,''), $6)
		RETURNING id::text, account_id::text, '', '', date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled
	`, req.ToAccountID, req.Date, req.Amount, "Transfer : "+fromName, req.Memo, req.Cleared,
	).Scan(&to.ID, &to.AccountID, &to.CategoryID, &to.CategoryName,
		&to.Date, &to.Amount, &to.Currency, &to.Payee, &to.Memo, &to.Cleared, &to.Reconciled); err != nil {
		return from, to, fmt.Errorf("insert to leg: %w", err)
	}

	// Link the two legs.
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid WHERE id = $2::uuid`,
		to.ID, from.ID); err != nil {
		return from, to, fmt.Errorf("link from leg: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid WHERE id = $2::uuid`,
		from.ID, to.ID); err != nil {
		return from, to, fmt.Errorf("link to leg: %w", err)
	}
	from.TransferPeerID = to.ID
	to.TransferPeerID = from.ID

	// Update both account balances.
	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
		-req.Amount, req.FromAccountID); err != nil {
		return from, to, fmt.Errorf("update from balance: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
		req.Amount, req.ToAccountID); err != nil {
		return from, to, fmt.Errorf("update to balance: %w", err)
	}

	return from, to, tx.Commit(ctx)
}
```

- [x] **Step 3: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

---

### Task 4: Repo tests — CreateTransfer

**Files:**
- Modify: `server/internal/repository/transaction_repo_test.go`

- [x] **Step 1: Append the test**

```go
func TestTransactionRepo_CreateTransfer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        5000, // ₡50.00
		Cleared:       true,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	// Amounts must be mirrored.
	if from.Amount != -5000 {
		t.Errorf("from.Amount want -5000 got %d", from.Amount)
	}
	if to.Amount != 5000 {
		t.Errorf("to.Amount want 5000 got %d", to.Amount)
	}

	// Each leg must point at the other.
	if from.TransferPeerID != to.ID {
		t.Errorf("from.TransferPeerID %q != to.ID %q", from.TransferPeerID, to.ID)
	}
	if to.TransferPeerID != from.ID {
		t.Errorf("to.TransferPeerID %q != from.ID %q", to.TransferPeerID, from.ID)
	}

	// Account balances must reflect the transfer.
	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != -5000 {
		t.Errorf("from account balance want -5000 got %d", fromBal)
	}
	if toBal != 5000 {
		t.Errorf("to account balance want 5000 got %d", toBal)
	}
}
```

- [x] **Step 2: Run the test (expect fail before implementation)**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_CreateTransfer -v
```

Expected: FAIL or SKIP (no test DB). If SKIP, the test is still correct — continue.

- [x] **Step 3: Run after implementation (Task 3 Step 2 done)**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_CreateTransfer -v
```

Expected: `PASS`.

- [x] **Step 4: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add CreateTransfer to repo with test"
```

---

### Task 5: Repo — Delete cascades to peer

**Files:**
- Modify: `server/internal/repository/transaction_repo.go` (the `Delete` method)

- [x] **Step 1: Write the failing test (see Task 6 Step 1)**

Skip ahead to Task 6 Step 1 to write the test, then come back here.

- [x] **Step 2: Replace the existing `Delete` method**

Find the `Delete` method (starts around line 357) and replace it entirely:

```go
func (r *TransactionRepo) Delete(ctx context.Context, id string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Fetch amount, account, and potential transfer peer in one query.
	var amount int64
	var accountID string
	var peerID *string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, id,
	).Scan(&amount, &accountID, &peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get transaction for delete: %w", err)
	}

	// If this is a transfer leg, delete the peer first (and reverse its balance).
	if peerID != nil && *peerID != "" {
		var peerAmount int64
		var peerAccountID string
		if err := tx.QueryRow(ctx,
			`SELECT amount, account_id::text FROM transactions WHERE id = $1::uuid`, *peerID,
		).Scan(&peerAmount, &peerAccountID); err == nil {
			if _, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = $1::uuid`, *peerID); err != nil {
				return fmt.Errorf("delete peer leg: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
				peerAmount, peerAccountID); err != nil {
				return fmt.Errorf("reverse peer balance: %w", err)
			}
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = $1::uuid`, id); err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
		amount, accountID,
	); err != nil {
		return fmt.Errorf("reverse balance: %w", err)
	}

	return tx.Commit(ctx)
}
```

- [x] **Step 3: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

---

### Task 6: Repo test — Delete cascade

**Files:**
- Modify: `server/internal/repository/transaction_repo_test.go`

- [x] **Step 1: Append the test**

```go
func TestTransactionRepo_DeleteTransfer_CascadePeer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        3000,
		Cleared:       false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	// Delete the outflow leg — the inflow peer must disappear too.
	if err := repo.Delete(ctx, from.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Peer must be gone.
	if _, err := repo.Get(ctx, to.ID); err == nil {
		t.Error("peer transaction still exists after deleting one transfer leg")
	}

	// Both account balances must be back to zero.
	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != 0 {
		t.Errorf("from account balance want 0 got %d", fromBal)
	}
	if toBal != 0 {
		t.Errorf("to account balance want 0 got %d", toBal)
	}
}
```

- [x] **Step 2: Run the test**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_DeleteTransfer_CascadePeer -v
```

Expected: `PASS`.

- [x] **Step 3: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: Delete cascades to transfer peer with test"
```

---

### Task 7: Repo — Update mirrors amount to peer

**Files:**
- Modify: `server/internal/repository/transaction_repo.go` (the `Update` method)

- [x] **Step 1: Write the failing test (see Task 8 Step 1)**

Skip ahead to Task 8 Step 1 to write the test, then come back here.

- [x] **Step 2: Replace the `Update` method**

Find the existing `Update` method (starts around line 281) and replace it entirely:

```go
// Update replaces a transaction and adjusts the account balance for the diff.
// If the transaction is a transfer leg, it mirrors the amount change (sign-flipped) to the peer.
func (r *TransactionRepo) Update(ctx context.Context, id string, req model.UpdateTransactionReq) (model.Transaction, error) {
	newAmount := req.Amount

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return model.Transaction{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var oldAmount int64
	var accountID string
	var peerID *string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, id,
	).Scan(&oldAmount, &accountID, &peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.Transaction{}, ErrNotFound
		}
		return model.Transaction{}, fmt.Errorf("get old transaction: %w", err)
	}

	var catIDParam interface{}
	if req.CategoryID != "" {
		catIDParam = req.CategoryID
	}

	var t model.Transaction
	err = tx.QueryRow(ctx, `
		UPDATE transactions
		SET category_id=$1, date=$2, amount=$3, payee=$4, memo=NULLIF($5,''), cleared=$6, updated_at=NOW()
		WHERE id=$7::uuid
		RETURNING id::text, account_id::text,
		          COALESCE(category_id::text,''), '',
		          date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled,
		          COALESCE(transfer_peer_id::text,'')
	`, catIDParam, req.Date, newAmount, req.Payee, req.Memo, req.Cleared, id,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared, &t.Reconciled, &t.TransferPeerID)
	if err != nil {
		return t, fmt.Errorf("update transaction: %w", err)
	}

	diff := newAmount - oldAmount
	if diff != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
			diff, accountID,
		); err != nil {
			return t, fmt.Errorf("update balance: %w", err)
		}
	}

	if t.CategoryID != "" {
		tx.QueryRow(ctx, `SELECT name FROM categories WHERE id = $1::uuid`, t.CategoryID).Scan(&t.CategoryName) //nolint:errcheck
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM transaction_splits WHERE transaction_id = $1::uuid`, id,
	); err != nil {
		return t, fmt.Errorf("delete splits: %w", err)
	}
	for _, s := range req.Splits {
		var catParam interface{}
		if s.CategoryID != "" {
			catParam = s.CategoryID
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES ($1::uuid, $2, $3)`,
			id, catParam, s.Amount,
		); err != nil {
			return t, fmt.Errorf("insert split: %w", err)
		}
	}

	// Mirror amount and date to the peer leg (sign-flipped).
	if peerID != nil && *peerID != "" && diff != 0 {
		var peerOldAmount int64
		var peerAccountID string
		if err := tx.QueryRow(ctx,
			`SELECT amount, account_id::text FROM transactions WHERE id = $1::uuid`, *peerID,
		).Scan(&peerOldAmount, &peerAccountID); err == nil {
			peerNewAmount := -newAmount
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET amount = $1, date = $2, updated_at = NOW() WHERE id = $3::uuid`,
				peerNewAmount, req.Date, *peerID,
			); err != nil {
				return t, fmt.Errorf("update peer leg: %w", err)
			}
			peerDiff := peerNewAmount - peerOldAmount
			if peerDiff != 0 {
				if _, err := tx.Exec(ctx,
					`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
					peerDiff, peerAccountID,
				); err != nil {
					return t, fmt.Errorf("update peer balance: %w", err)
				}
			}
		}
	}

	return t, tx.Commit(ctx)
}
```

- [x] **Step 3: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

---

### Task 8: Repo test — Update mirrors peer

**Files:**
- Modify: `server/internal/repository/transaction_repo_test.go`

- [x] **Step 1: Append the test**

```go
func TestTransactionRepo_UpdateTransfer_MirrorsPeer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        2000,
		Cleared:       false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	// Change the amount on the outflow leg from -2000 to -4000.
	_, err = repo.Update(ctx, from.ID, model.UpdateTransactionReq{
		Date:    "2026-06-04",
		Payee:   from.Payee,
		Amount:  -4000,
		Cleared: false,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	// Peer leg must now be +4000.
	peer, err := repo.Get(ctx, to.ID)
	if err != nil {
		t.Fatalf("Get peer: %v", err)
	}
	if peer.Amount != 4000 {
		t.Errorf("peer.Amount want 4000 got %d", peer.Amount)
	}

	// Account balances: from=-4000, to=+4000.
	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != -4000 {
		t.Errorf("from balance want -4000 got %d", fromBal)
	}
	if toBal != 4000 {
		t.Errorf("to balance want 4000 got %d", toBal)
	}
}
```

- [x] **Step 2: Run the test**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_UpdateTransfer_MirrorsPeer -v
```

Expected: `PASS`.

- [x] **Step 3: Run all repo tests**

```bash
cd server && go test ./internal/repository/... -v
```

Expected: all pass (or SKIP on tests requiring DB).

- [x] **Step 4: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: Update mirrors amount to transfer peer with test"
```

---

### Task 9: Handler + route — CreateTransfer endpoint

**Files:**
- Modify: `server/internal/handler/transactions.go`
- Modify: `server/main.go`

- [x] **Step 1: Update `toResponse` to include `transfer_peer_id`**

In `handler/transactions.go`, find the `toResponse` method and add `transfer_peer_id` to the returned map:

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
	var transferPeerID any = nil
	if t.TransferPeerID != "" {
		transferPeerID = t.TransferPeerID
	}
	return map[string]any{
		"id":               t.ID,
		"account":          t.AccountID,
		"date":             t.Date,
		"payee":            t.Payee,
		"category":         category,
		"category_id":      categoryID,
		"memo":             t.Memo,
		"amount":           t.Amount,
		"currency":         t.Currency,
		"cleared":          t.Cleared,
		"exchange_rate":    t.ExchangeRate,
		"transfer_peer_id": transferPeerID,
	}
}
```

- [x] **Step 2: Add the `CreateTransfer` handler method**

Append to `handler/transactions.go` after the `Delete` method:

```go
func (h *TransactionHandler) CreateTransfer(w http.ResponseWriter, r *http.Request) {
	var req model.CreateTransferReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.FromAccountID == "" || req.ToAccountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from_account_id and to_account_id are required")
		return
	}
	if req.FromAccountID == req.ToAccountID {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to accounts must differ")
		return
	}
	if req.Date == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "date is required")
		return
	}
	if req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be positive")
		return
	}

	from, to, err := h.repo.CreateTransfer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"from": h.toResponse(from),
		"to":   h.toResponse(to),
	})
}
```

- [x] **Step 3: Register the route in main.go**

In `server/main.go`, after line `mux.HandleFunc("PATCH /api/transactions/batch", txns.Batch)`, add:

```go
mux.HandleFunc("POST /api/transfers", txns.CreateTransfer)
```

- [x] **Step 4: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

- [x] **Step 5: Smoke-test the endpoint**

Start the server (`go run ./...` in `server/`) then in another terminal:

```bash
# Replace UUIDs with real account IDs from your dev DB.
curl -s -X POST http://localhost:8080/api/transfers \
  -H 'Content-Type: application/json' \
  -d '{"from_account_id":"<FROM_ID>","to_account_id":"<TO_ID>","date":"2026-06-04","amount":10000,"cleared":false}' | jq .
```

Expected: JSON with `from` and `to` objects, each with mirrored amounts and matching `transfer_peer_id` values.

- [x] **Step 6: Commit**

```bash
git add server/internal/handler/transactions.go server/main.go
git commit -m "feat: add CreateTransfer handler and POST /api/transfers route"
```

---

### Task 10: Frontend API — createTransfer + type update

**Files:**
- Modify: `frontend/src/api.ts`

- [x] **Step 1: Add `transfer_peer_id` to the `Transaction` interface**

Find the `Transaction` interface (line 21) and add the field:

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
  transfer_peer_id?: string | null;
}
```

- [x] **Step 2: Update `mapApiTxn` to forward `transfer_peer_id`**

Find `mapApiTxn` (line 136) and update its parameter type and return:

```typescript
function mapApiTxn(t: {
  id: string; date: string; payee: string; category: string | null; memo: string;
  cleared: boolean; account: string; currency: string; amount: number;
  exchange_rate?: number | null; reconciled?: boolean;
  splits?: { category: string; amount: number }[];
  transfer_peer_id?: string | null;
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
    transfer_peer_id: t.transfer_peer_id ?? null,
  };
}
```

- [x] **Step 3: Add the `createTransfer` function**

After the `createTransaction` function (around line 205), add:

```typescript
export async function createTransfer(body: {
  from_account_id: string;
  to_account_id: string;
  date: string;
  amount: number;   // major units; converted to centimos here
  memo?: string;
  cleared?: boolean;
}): Promise<{ from: Transaction; to: Transaction }> {
  const raw = await apiFetch<{ from: ReturnType<typeof Object.create>; to: ReturnType<typeof Object.create> }>('/transfers', {
    method: 'POST',
    body: JSON.stringify({ ...body, amount: Math.round(body.amount * 100) }),
  });
  return { from: mapApiTxn(raw.from), to: mapApiTxn(raw.to) };
}
```

- [x] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add createTransfer to frontend API and transfer_peer_id to Transaction type"
```

---

### Task 11: Frontend UI — Transfer toggle in add-transaction form

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [x] **Step 1: Import `createTransfer`**

At line 2, the existing import is:

```typescript
import { updateTransaction, deleteTransaction, createTransaction, fetchTransactionsPage, batchTransactions, reconcileAccount, type TxnPage, type TxnFilterParams } from '../api';
```

Replace it with:

```typescript
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, type TxnPage, type TxnFilterParams } from '../api';
```

- [x] **Step 2: Add `isTransfer` and `transferToAccount` to the addForm state**

Find the `addForm` state initialiser (line 120):

```typescript
const [addForm, setAddForm] = useState({
  date: new Date().toISOString().slice(0, 10),
  payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false,
});
```

Replace with:

```typescript
const [addForm, setAddForm] = useState({
  date: new Date().toISOString().slice(0, 10),
  payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false,
  isTransfer: false, transferToAccountId: '',
});
```

- [x] **Step 3: Replace `handleAddTxn` to branch on `isTransfer`**

Find `handleAddTxn` (around line 232) and replace it:

```typescript
const handleAddTxn = async (e: React.FormEvent) => {
  e.preventDefault();
  if (addForm.isTransfer) {
    if (!addForm.transferToAccountId) return;
    const amount = parseFloat(addForm.outflow) || parseFloat(addForm.inflow) || 0;
    if (amount <= 0) return;
    await createTransfer({
      from_account_id: accountId,
      to_account_id: addForm.transferToAccountId,
      date: addForm.date,
      amount,
      memo: addForm.memo,
      cleared: addForm.cleared,
    });
  } else {
    const amount = parseFloat(addForm.inflow) > 0 ? parseFloat(addForm.inflow) : -(parseFloat(addForm.outflow) || 0);
    const category_id = addForm.category ? (categoryIdByName[addForm.category] ?? undefined) : undefined;
    await createTransaction(accountId, {
      date: addForm.date, payee: addForm.payee, category_id, amount,
      memo: addForm.memo, cleared: addForm.cleared,
    });
  }
  reload();
  setAddForm({ date: new Date().toISOString().slice(0, 10), payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false, isTransfer: false, transferToAccountId: '' });
};
```

- [x] **Step 4: Add the Transfer toggle and to-account selector to the form JSX**

Find the `<form onSubmit={handleAddTxn}` block. After the date/category row and before the payee input, add:

```tsx
{/* Transfer toggle */}
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <input
    type="checkbox"
    id="addIsTransfer"
    checked={addForm.isTransfer}
    onChange={e => setAddForm(f => ({ ...f, isTransfer: e.target.checked, category: '', transferToAccountId: '' }))}
  />
  <label htmlFor="addIsTransfer" style={{ fontSize: 12, color: T.textMid, fontWeight: 600 }}>Transfer to another account</label>
</div>
{addForm.isTransfer && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={st.label}>To Account</label>
    <select
      value={addForm.transferToAccountId}
      onChange={e => setAddForm(f => ({ ...f, transferToAccountId: e.target.value }))}
      style={st.inlineSelect}
      required
    >
      <option value="">Select account…</option>
      {[...(accounts.budget ?? []), ...(accounts.tracking ?? [])].filter(a => a.id !== accountId).map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  </div>
)}
```

When `isTransfer` is true, the category dropdown should be hidden. Find the category `<select>` inside the form and wrap it:

```tsx
{!addForm.isTransfer && (
  <select value={addForm.category}
    onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
    {/* ... keep all existing props ... */}
  >
    {/* ... keep existing options ... */}
  </select>
)}
```

- [x] **Step 5: Display a transfer badge on transaction rows**

Find the row rendering block where payee is shown (around line 67). After the existing category/split display, add a transfer indicator. Find where `t.payee` is rendered and look for where `t.category` is shown:

```tsx
{t.transfer_peer_id
  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '2px 6px' }}>⇄ Transfer</span>
  : t.splits && t.splits.length > 0
    ? <span style={st.splitChip} title={t.splits.map(s => s.category + ' ' + fmt(s.amount)).join('  ·  ')}>⑂ Split · {t.splits.length}</span>
    : t.category
      ? <span style={{ ...st.catTag, color: catColor(t.category) }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor' }} />{t.category}</span>
      : null
}
```

- [x] **Step 6: Pass `accounts` prop into the form area**

`accounts` is already in scope as a prop — verify `accounts.budget` and `accounts.tracking` are accessible where you added the `<select>`. Check the `Props` interface (around line 92) to confirm it includes `accounts` and if not, add it:

```typescript
accounts: { budget: Account[]; tracking: Account[] };
```

- [x] **Step 7: Start the dev server and verify manually**

```bash
cd frontend && npm run dev
```

Open the app, navigate to an account, click "Add Transaction", check the "Transfer to another account" checkbox, select a destination account, enter an amount, and submit. Verify:
- Both accounts show the transfer transaction
- Payees read "Transfer : AccountName"
- A "⇄ Transfer" badge shows on each row

- [x] **Step 8: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add transfer toggle to add-transaction form with linked-row badge"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] DB column linking the two legs (`transfer_peer_id`)
- [x] Atomic creation of both sides (`CreateTransfer`)
- [x] Delete one leg → peer deleted too (Task 5–6)
- [x] Edit amount → peer amount mirrored (Task 7–8)
- [x] New API endpoint `POST /api/transfers` (Task 9)
- [x] Frontend can create a transfer (Task 10–11)
- [x] Transfer badge visible on transaction rows (Task 11 Step 5)

**Placeholder scan:** No TBD/TODO in plan. All code blocks are complete.

**Type consistency:** `TransferPeerID string` used consistently in model, repo scans, handler response key `"transfer_peer_id"`, and frontend `transfer_peer_id?: string | null`.
