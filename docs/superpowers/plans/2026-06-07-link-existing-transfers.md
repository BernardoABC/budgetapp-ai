# Link Existing Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to link two already-imported transactions as a YNAB-style transfer pair — from the transaction list or after import — including a batch "same payee" review table.

**Architecture:** Three new repo methods (`TransferCandidates`, `LinkTransfer`, `LinkTransferBatch`) and three new routes back the feature. The frontend gets a two-step link modal on unlinked rows in `Accounts.tsx`, a batch review table triggered after a successful single link, and a post-import link step in `Import.tsx` for bank-flagged transfer rows.

**Tech Stack:** Go 1.22 (pgx/v5, net/http ServeMux), PostgreSQL, React + TypeScript (Vite)

---

## File Map

| File | Change |
|------|--------|
| `server/internal/repository/transaction_repo.go` | Fix `Get`/`ListByAccount` to return `transfer_peer_id`; add `TransferCandidates`, `LinkTransfer`, `LinkTransferBatch` |
| `server/internal/repository/transaction_repo_test.go` | Tests for `TransferCandidates`, `LinkTransfer`, `LinkTransferBatch` |
| `server/internal/repository/import_repo.go` | Change `InsertImportedTxn` to return the created transaction ID |
| `server/internal/model/import.go` | Add `IsTransfer bool` to `ConfirmTxnReq`; add `TransferTransactionIDs []string` to `ConfirmResponse` |
| `server/internal/service/import_service.go` | Collect IDs of `is_transfer` rows and include in response |
| `server/internal/handler/transactions.go` | Add `TransferCandidates`, `Link`, `LinkBatch` handlers |
| `server/main.go` | Register three new routes |
| `frontend/src/api.ts` | Add `fetchTransferCandidates`, `linkTransfer`, `linkTransferBatch`; update `ConfirmTxn` and `ImportConfirmResponse` |
| `frontend/src/components/Accounts.tsx` | Add "Link" button + two-step modal + batch review table |
| `frontend/src/components/Import.tsx` | Add post-import link step for `is_transfer` rows |

---

### Task 1: Fix Get and ListByAccount to return transfer_peer_id

The `Get` and `ListByAccount` queries were written before `transfer_peer_id` was added and don't include it. The "⇄ Transfer" badge currently never renders on listed rows because the field is always empty.

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`

- [ ] **Step 1: Update the `Get` query**

In `Get` (around line 194), the SELECT currently ends with `t.exchange_rate, t.reconciled, ...splits`. Add `COALESCE(t.transfer_peer_id::text,'')` before the splits aggregate and add `&t.TransferPeerID` to the Scan call before `&splitsJSON`:

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
		       COALESCE(t.transfer_peer_id::text,''),
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
		&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &splitsJSON)
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

- [ ] **Step 2: Update the `ListByAccount` query**

In `ListByAccount` (around line 149), the page-rows SELECT and Scan need the same addition. Find the `rows, err := r.pool.Query(ctx, ...` block and replace just the SELECT and Scan:

```go
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(t.transfer_peer_id::text,''),
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

And in the scan loop:

```go
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &splitsJSON); err != nil {
```

- [ ] **Step 3: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

- [ ] **Step 4: Run existing repo tests**

```bash
cd server && go test ./internal/repository/... -v
```

Expected: all pass or SKIP (no test DB).

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/transaction_repo.go
git commit -m "fix: include transfer_peer_id in Get and ListByAccount responses"
```

---

### Task 2: Repo — TransferCandidates + test

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `transaction_repo_test.go`:

```go
func TestTransactionRepo_TransferCandidates(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	// One candidate: opposite amount, no peer.
	testutil.SeedTransactionFull(t, pool, accB, "", "2026-06-01", 5000, "Salary", "", false)
	// Not a candidate: same amount sign.
	testutil.SeedTransactionFull(t, pool, accB, "", "2026-06-01", -5000, "Other", "", false)

	// Create a linked pair so we can verify already-linked rows are excluded.
	_, _, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: accA, ToAccountID: accB, Date: "2026-06-02", Amount: 3000, Cleared: false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	// accA outflow = -5000; candidates in accB should have amount = +5000, no peer.
	cands, err := repo.TransferCandidates(ctx, accB, -5000)
	if err != nil {
		t.Fatalf("TransferCandidates: %v", err)
	}
	if len(cands) != 1 {
		t.Fatalf("want 1 candidate got %d", len(cands))
	}
	if cands[0].Payee != "Salary" {
		t.Errorf("want payee Salary got %q", cands[0].Payee)
	}
}
```

- [ ] **Step 2: Run — expect SKIP or FAIL**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_TransferCandidates -v
```

Expected: FAIL `undefined: repo.TransferCandidates` or SKIP.

- [ ] **Step 3: Implement TransferCandidates**

Append after the `CreateTransfer` method in `transaction_repo.go`:

```go
// TransferCandidates returns unlinked transactions in accountID whose amount equals
// -amount (the sign-opposite of the given amount), ordered newest first.
// Used to populate the candidate picker when linking a transfer.
func (r *TransactionRepo) TransferCandidates(ctx context.Context, accountID string, amount int64) ([]model.Transaction, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(t.transfer_peer_id::text,'')
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = $1::uuid
		  AND t.amount = $2
		  AND t.transfer_peer_id IS NULL
		ORDER BY t.date DESC, t.created_at DESC
		LIMIT 50
	`, accountID, -amount)
	if err != nil {
		return nil, fmt.Errorf("transfer candidates: %w", err)
	}
	defer rows.Close()
	var txns []model.Transaction
	for rows.Next() {
		var t model.Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID); err != nil {
			return nil, fmt.Errorf("scan candidate: %w", err)
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_TransferCandidates -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add TransferCandidates to repo with test"
```

---

### Task 3: Repo — LinkTransfer + test

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `transaction_repo_test.go`:

```go
func TestTransactionRepo_LinkTransfer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "Transfer", "", false)
	idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "Transfer", "", false)

	if err := repo.LinkTransfer(ctx, idA, idB); err != nil {
		t.Fatalf("LinkTransfer: %v", err)
	}

	a, _ := repo.Get(ctx, idA)
	b, _ := repo.Get(ctx, idB)

	if a.TransferPeerID != idB {
		t.Errorf("a.TransferPeerID want %q got %q", idB, a.TransferPeerID)
	}
	if b.TransferPeerID != idA {
		t.Errorf("b.TransferPeerID want %q got %q", idA, b.TransferPeerID)
	}
}

func TestTransactionRepo_LinkTransfer_Validations(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	t.Run("same account", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", 5000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err == nil {
			t.Error("expected error for same account, got nil")
		}
	})
	t.Run("amounts don't sum to zero", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 3000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err == nil {
			t.Error("expected error for mismatched amounts, got nil")
		}
	})
	t.Run("already linked", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-03", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-03", 5000, "T", "", false)
		idC := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-03", 5000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err != nil {
			t.Fatalf("first link: %v", err)
		}
		if err := repo.LinkTransfer(ctx, idA, idC); err == nil {
			t.Error("expected error linking already-linked transaction, got nil")
		}
	})
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd server && go test ./internal/repository/... -run "TestTransactionRepo_LinkTransfer" -v
```

Expected: FAIL `undefined: repo.LinkTransfer` or SKIP.

- [ ] **Step 3: Implement LinkTransfer**

Append after `TransferCandidates` in `transaction_repo.go`:

```go
// LinkTransfer atomically sets transfer_peer_id on two existing transactions,
// making them a linked transfer pair. Returns an error if either is already linked,
// both belong to the same account, or their amounts don't sum to zero.
func (r *TransactionRepo) LinkTransfer(ctx context.Context, idA, idB string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	type row struct {
		accountID string
		amount    int64
		peerID    *string
	}
	var a, b row

	if err := tx.QueryRow(ctx,
		`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, idA,
	).Scan(&a.accountID, &a.amount, &a.peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get txn A: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, idB,
	).Scan(&b.accountID, &b.amount, &b.peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get txn B: %w", err)
	}

	if a.peerID != nil {
		return fmt.Errorf("transaction %s is already linked to a transfer", idA)
	}
	if b.peerID != nil {
		return fmt.Errorf("transaction %s is already linked to a transfer", idB)
	}
	if a.accountID == b.accountID {
		return fmt.Errorf("both transactions belong to the same account")
	}
	if a.amount+b.amount != 0 {
		return fmt.Errorf("amounts do not sum to zero (%d + %d = %d)", a.amount, b.amount, a.amount+b.amount)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
		idB, idA); err != nil {
		return fmt.Errorf("link A: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
		idA, idB); err != nil {
		return fmt.Errorf("link B: %w", err)
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && go test ./internal/repository/... -run "TestTransactionRepo_LinkTransfer" -v
```

Expected: all subtests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add LinkTransfer to repo with validation tests"
```

---

### Task 4: Repo — LinkTransferBatch + test

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `transaction_repo_test.go`:

```go
func TestTransactionRepo_LinkTransferBatch(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA1 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
	idB1 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "T", "", false)
	idA2 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -3000, "T", "", false)
	idB2 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 3000, "T", "", false)

	linked, err := repo.LinkTransferBatch(ctx, [][2]string{{idA1, idB1}, {idA2, idB2}})
	if err != nil {
		t.Fatalf("LinkTransferBatch: %v", err)
	}
	if linked != 2 {
		t.Errorf("want linked=2 got %d", linked)
	}

	a1, _ := repo.Get(ctx, idA1)
	if a1.TransferPeerID != idB1 {
		t.Errorf("a1 peer want %q got %q", idB1, a1.TransferPeerID)
	}
}

func TestTransactionRepo_LinkTransferBatch_RollbackOnError(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA1 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
	idB1 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "T", "", false)
	// Second pair has mismatched amounts — should cause rollback.
	idA2 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -3000, "T", "", false)
	idB2 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 9999, "T", "", false)

	_, err := repo.LinkTransferBatch(ctx, [][2]string{{idA1, idB1}, {idA2, idB2}})
	if err == nil {
		t.Fatal("expected error from batch with invalid pair, got nil")
	}

	// First pair must NOT be linked (rolled back).
	a1, _ := repo.Get(ctx, idA1)
	if a1.TransferPeerID != "" {
		t.Errorf("pair 1 should not be linked after rollback, got peer %q", a1.TransferPeerID)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd server && go test ./internal/repository/... -run "TestTransactionRepo_LinkTransferBatch" -v
```

Expected: FAIL `undefined: repo.LinkTransferBatch` or SKIP.

- [ ] **Step 3: Implement LinkTransferBatch**

Append after `LinkTransfer` in `transaction_repo.go`:

```go
// LinkTransferBatch atomically links multiple transaction pairs as transfers.
// All pairs are validated and linked in a single DB transaction — any failure
// rolls back the entire batch.
func (r *TransactionRepo) LinkTransferBatch(ctx context.Context, pairs [][2]string) (int, error) {
	if len(pairs) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, pair := range pairs {
		idA, idB := pair[0], pair[1]

		type row struct {
			accountID string
			amount    int64
			peerID    *string
		}
		var a, b row

		if err := tx.QueryRow(ctx,
			`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, idA,
		).Scan(&a.accountID, &a.amount, &a.peerID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrNotFound
			}
			return 0, fmt.Errorf("get txn A %s: %w", idA, err)
		}
		if err := tx.QueryRow(ctx,
			`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, idB,
		).Scan(&b.accountID, &b.amount, &b.peerID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrNotFound
			}
			return 0, fmt.Errorf("get txn B %s: %w", idB, err)
		}

		if a.peerID != nil {
			return 0, fmt.Errorf("transaction %s is already linked", idA)
		}
		if b.peerID != nil {
			return 0, fmt.Errorf("transaction %s is already linked", idB)
		}
		if a.accountID == b.accountID {
			return 0, fmt.Errorf("transactions %s and %s belong to the same account", idA, idB)
		}
		if a.amount+b.amount != 0 {
			return 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", idA, idB)
		}

		if _, err := tx.Exec(ctx,
			`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
			idB, idA); err != nil {
			return 0, fmt.Errorf("link A %s: %w", idA, err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
			idA, idB); err != nil {
			return 0, fmt.Errorf("link B %s: %w", idB, err)
		}
	}

	return len(pairs), tx.Commit(ctx)
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd server && go test ./internal/repository/... -run "TestTransactionRepo_LinkTransferBatch" -v
```

Expected: both tests PASS.

- [ ] **Step 5: Run all repo tests**

```bash
cd server && go test ./internal/repository/... -v
```

Expected: all pass or SKIP.

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add LinkTransferBatch to repo with rollback test"
```

---

### Task 5: Handler — TransferCandidates, Link, LinkBatch + routes

**Files:**
- Modify: `server/internal/handler/transactions.go`
- Modify: `server/main.go`

- [ ] **Step 1: Add three handler methods**

Append to the end of `server/internal/handler/transactions.go`:

```go
func (h *TransactionHandler) TransferCandidates(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	amountStr := r.URL.Query().Get("amount")
	if amountStr == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount query param is required")
		return
	}
	amount, err := strconv.ParseInt(amountStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be an integer (centimos)")
		return
	}
	txns, err := h.repo.TransferCandidates(r.Context(), accountID, amount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]map[string]any, len(txns))
	for i, t := range txns {
		resp[i] = h.toResponse(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": resp})
}

func (h *TransactionHandler) Link(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TransactionAID string `json:"transaction_a_id"`
		TransactionBID string `json:"transaction_b_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.TransactionAID == "" || req.TransactionBID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "transaction_a_id and transaction_b_id are required")
		return
	}
	if err := h.repo.LinkTransfer(r.Context(), req.TransactionAID, req.TransactionBID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	a, _ := h.repo.Get(r.Context(), req.TransactionAID)
	b, _ := h.repo.Get(r.Context(), req.TransactionBID)
	writeJSON(w, http.StatusOK, map[string]any{
		"from": h.toResponse(a),
		"to":   h.toResponse(b),
	})
}

func (h *TransactionHandler) LinkBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pairs [][2]string `json:"pairs"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.Pairs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "pairs must be a non-empty array")
		return
	}
	linked, err := h.repo.LinkTransferBatch(r.Context(), req.Pairs)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": linked})
}
```

- [ ] **Step 2: Register routes in main.go**

After the line `mux.HandleFunc("POST /api/transfers", txns.CreateTransfer)`, add:

```go
mux.HandleFunc("GET /api/accounts/{id}/transfer-candidates", txns.TransferCandidates)
mux.HandleFunc("POST /api/transfers/link", txns.Link)
mux.HandleFunc("POST /api/transfers/link-batch", txns.LinkBatch)
```

- [ ] **Step 3: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

- [ ] **Step 4: Smoke test**

Start the server (`cd server && go run .`) and in another terminal:

```bash
# Replace UUIDs with real IDs from your dev DB.
curl -s "http://localhost:8080/api/accounts/<ACCOUNT_ID>/transfer-candidates?amount=-10000" | jq .
```

Expected: JSON with `{"transactions": [...]}`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/transactions.go server/main.go
git commit -m "feat: add TransferCandidates, Link, LinkBatch handlers and routes"
```

---

### Task 6: Import pipeline — track and return transfer transaction IDs

When the bank marks a row as a transfer (`is_transfer: true`), the app needs to surface those transaction IDs after import so the UI can prompt the user to link them.

**Files:**
- Modify: `server/internal/model/import.go`
- Modify: `server/internal/repository/import_repo.go`
- Modify: `server/internal/service/import_service.go`

- [ ] **Step 1: Update the import model**

In `server/internal/model/import.go`, add `IsTransfer bool` to `ConfirmTxnReq` and `TransferTransactionIDs []string` to `ConfirmResponse`:

```go
type ConfirmTxnReq struct {
	Include        bool    `json:"include"`
	Date           string  `json:"date"`
	Amount         int64   `json:"amount"`
	DescriptionRaw string  `json:"description_raw"`
	Reference      string  `json:"reference"`
	CategoryID     *string `json:"category_id"`
	PayeeOverride  *string `json:"payee_override"`
	Memo           *string `json:"memo"`
	IsTransfer     bool    `json:"is_transfer"`
}

type ConfirmResponse struct {
	ImportID               string   `json:"import_id"`
	ImportedCount          int      `json:"imported_count"`
	SkippedCount           int      `json:"skipped_count"`
	NewRulesCreated        int      `json:"new_rules_created"`
	RulesUpdated           int      `json:"rules_updated"`
	TransferTransactionIDs []string `json:"transfer_transaction_ids"`
}
```

- [ ] **Step 2: Change InsertImportedTxn to return the created ID**

In `server/internal/repository/import_repo.go`, replace `InsertImportedTxn`:

```go
// InsertImportedTxn inserts one imported transaction within the confirm transaction
// and returns the newly created transaction ID.
func (r *ImportRepo) InsertImportedTxn(
	ctx context.Context, tx pgx.Tx,
	accountID, importID, date string, amount int64, currency, payee, reference string,
	categoryID *string, memo *string, exchangeRate *float64,
) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO transactions
			(account_id, category_id, date, amount, currency, payee, check_number, memo, import_id, cleared, exchange_rate)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), $8, $9, false, $10)
		RETURNING id::text
	`, accountID, categoryID, date, amount, currency, payee, reference, memo, importID, exchangeRate).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert imported txn: %w", err)
	}
	return id, nil
}
```

- [ ] **Step 3: Update import_service.go to collect transfer IDs**

In `server/internal/service/import_service.go`, update the `Confirm` method. The loop currently calls `InsertImportedTxn` and discards the return. Change it to capture the ID and track transfer rows:

Replace the section starting with `for _, t := range included {` through the end of the loop with:

```go
	var transferTxnIDs []string

	for _, t := range included {
		payee := strings.TrimSpace(t.DescriptionRaw)
		if t.PayeeOverride != nil && *t.PayeeOverride != "" {
			payee = *t.PayeeOverride
		}

		var rate *float64
		if r, ok := rateMap[t.Date]; ok {
			r := r
			rate = &r
		}

		txnID, err := s.importRepo.InsertImportedTxn(
			ctx, tx, req.AccountID, importID, t.Date, t.Amount,
			account.Currency, payee, t.Reference, t.CategoryID, t.Memo, rate,
		)
		if err != nil {
			return model.ConfirmResponse{}, err
		}
		balanceDelta += t.Amount

		if t.IsTransfer {
			transferTxnIDs = append(transferTxnIDs, txnID)
		}

		if t.CategoryID != nil && *t.CategoryID != "" {
			created, err := s.ruleRepo.Learn(ctx, tx, importer.Normalize(t.DescriptionRaw), *t.CategoryID)
			if err != nil {
				return model.ConfirmResponse{}, err
			}
			if created {
				newRules++
			} else {
				updatedRules++
			}
		}
	}
```

Then update the `ConfirmResponse` at the end of `Confirm`:

```go
	return model.ConfirmResponse{
		ImportID:               importID,
		ImportedCount:          len(included),
		SkippedCount:           len(req.Transactions) - len(included),
		NewRulesCreated:        newRules,
		RulesUpdated:           updatedRules,
		TransferTransactionIDs: transferTxnIDs,
	}, nil
```

- [ ] **Step 4: Build**

```bash
cd server && go build ./...
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/internal/model/import.go server/internal/repository/import_repo.go server/internal/service/import_service.go
git commit -m "feat: return transfer_transaction_ids from import confirm"
```

---

### Task 7: Frontend API — new functions and updated types

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add `is_transfer` to `ConfirmTxn` and `transfer_transaction_ids` to `ImportConfirmResponse`**

Find the `ConfirmTxn` interface and add the field:

```typescript
export interface ConfirmTxn {
  include: boolean;
  date: string;
  amount: number;
  description_raw: string;
  reference: string;
  category_id: string | null;
  payee_override: string | null;
  memo: string | null;
  is_transfer: boolean;
}
```

Find the `ImportConfirmResponse` interface and add:

```typescript
export interface ImportConfirmResponse {
  import_id: string;
  imported_count: number;
  skipped_count: number;
  new_rules_created: number;
  rules_updated: number;
  transfer_transaction_ids: string[];
}
```

- [ ] **Step 2: Add the three new API functions**

After the `deleteTransaction` function, append:

```typescript
export async function fetchTransferCandidates(
  accountId: string,
  amount: number, // major units; converted to centimos
): Promise<Transaction[]> {
  const centimos = Math.round(amount * 100);
  const data = await apiFetch<{ transactions: Parameters<typeof mapApiTxn>[0][] }>(
    `/accounts/${accountId}/transfer-candidates?amount=${centimos}`
  );
  return (data.transactions ?? []).map(mapApiTxn);
}

export async function linkTransfer(
  transactionAId: string,
  transactionBId: string,
): Promise<{ from: Transaction; to: Transaction }> {
  const raw = await apiFetch<{ from: Parameters<typeof mapApiTxn>[0]; to: Parameters<typeof mapApiTxn>[0] }>(
    '/transfers/link',
    { method: 'POST', body: JSON.stringify({ transaction_a_id: transactionAId, transaction_b_id: transactionBId }) },
  );
  return { from: mapApiTxn(raw.from), to: mapApiTxn(raw.to) };
}

export async function linkTransferBatch(
  pairs: [string, string][],
): Promise<{ linked: number }> {
  return apiFetch('/transfers/link-batch', {
    method: 'POST',
    body: JSON.stringify({ pairs }),
  });
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add fetchTransferCandidates, linkTransfer, linkTransferBatch to frontend API"
```

---

### Task 8: Frontend UI — Link modal in Accounts.tsx

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add imports**

At the top of `Accounts.tsx`, update the api import to include the new functions:

```typescript
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransferCandidates, linkTransfer, linkTransferBatch, fetchTransactionsPage, batchTransactions, reconcileAccount, type TxnPage, type TxnFilterParams } from '../api';
```

- [ ] **Step 2: Add link modal state**

Inside the `Accounts` function body, after the existing state declarations, add:

```typescript
const [linkModal, setLinkModal] = useState<{
  txn: Transaction;
  step: 1 | 2;
  targetAccountId: string;
  candidates: Transaction[];
  loading: boolean;
} | null>(null);

const [batchReview, setBatchReview] = useState<{
  payee: string;
  targetAccountId: string;
  pairs: Array<{ source: Transaction; candidate: Transaction | null; include: boolean }>;
} | null>(null);
```

- [ ] **Step 3: Add openLinkModal and handleLink handlers**

After the existing `handleAddTxn` function, add:

```typescript
const openLinkModal = (txn: Transaction) => {
  setLinkModal({ txn, step: 1, targetAccountId: '', candidates: [], loading: false });
};

const handleLinkSelectAccount = async (targetAccountId: string) => {
  if (!linkModal) return;
  setLinkModal(m => m ? { ...m, targetAccountId, loading: true } : null);
  const cands = await fetchTransferCandidates(targetAccountId, linkModal.txn.outflow > 0 ? -linkModal.txn.outflow : linkModal.txn.inflow).catch(() => []);
  setLinkModal(m => m ? { ...m, step: 2, candidates: cands, loading: false } : null);
};

const handleLinkConfirm = async (candidateId: string) => {
  if (!linkModal) return;
  try {
    await linkTransfer(linkModal.txn.id, candidateId);
    reload();
    setLinkModal(null);

    // Check for other unlinked rows with the same payee.
    const samePay = txnPage?.transactions.filter(
      t => t.payee === linkModal.txn.payee && !t.transfer_peer_id && t.id !== linkModal.txn.id
    ) ?? [];
    if (samePay.length > 0) {
      const tgtAccId = linkModal.targetAccountId;
      const allCands = await fetchTransferCandidates(tgtAccId, linkModal.txn.outflow > 0 ? -linkModal.txn.outflow : linkModal.txn.inflow).catch(() => []);
      const pairs = samePay.map(src => {
        const best = allCands
          .filter(c => !c.transfer_peer_id)
          .sort((a, b) => Math.abs(new Date(a.date).getTime() - new Date(src.date).getTime()) - Math.abs(new Date(b.date).getTime() - new Date(src.date).getTime()))[0] ?? null;
        return { source: src, candidate: best, include: best !== null };
      });
      setBatchReview({ payee: linkModal.txn.payee, targetAccountId: tgtAccId, pairs });
    }
  } catch (e: any) {
    alert('Link failed: ' + e.message);
  }
};

const handleBatchLink = async () => {
  if (!batchReview) return;
  const pairs: [string, string][] = batchReview.pairs
    .filter(p => p.include && p.candidate)
    .map(p => [p.source.id, p.candidate!.id]);
  if (pairs.length === 0) { setBatchReview(null); return; }
  try {
    await linkTransferBatch(pairs);
    reload();
    setBatchReview(null);
  } catch (e: any) {
    alert('Batch link failed: ' + e.message);
  }
};
```

- [ ] **Step 4: Add "Link" button to transaction rows**

In the row rendering, find where `t.transfer_peer_id` is checked (the "⇄ Transfer" badge). After that badge's span, add a Link button for unlinked rows. The current pattern is:

```tsx
{t.transfer_peer_id
  ? <span style={...}>⇄ Transfer</span>
  : t.splits ...
```

Change it to also include the Link button:

```tsx
{t.transfer_peer_id
  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '2px 6px' }}>⇄ Transfer</span>
  : (
    <>
      {t.splits && t.splits.length > 0
        ? <span style={st.splitChip} title={t.splits.map(s => s.category + ' ' + fmt(s.amount)).join('  ·  ')}>⑂ Split · {t.splits.length}</span>
        : t.category
          ? <span style={{ ...st.catTag, color: catColor(t.category) }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor' }} />{t.category}</span>
          : null
      }
      <button
        onClick={e => { e.stopPropagation(); openLinkModal(t); }}
        style={{ fontSize: 10, color: T.textFaint, background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', marginLeft: 4 }}
        title="Link as transfer"
      >Link</button>
    </>
  )
}
```

- [ ] **Step 5: Add the link modal JSX**

Inside the return of `Accounts`, before the closing fragment tag, add:

```tsx
{/* Link modal */}
{linkModal && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => setLinkModal(null)}>
    <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 480, maxHeight: '80vh', overflowY: 'auto' }}
      onClick={e => e.stopPropagation()}>
      <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 16 }}>Link as Transfer</div>
      {linkModal.step === 1 && (
        <>
          <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>
            Linking: <b style={{ color: T.text }}>{linkModal.txn.payee}</b> · {linkModal.txn.outflow > 0 ? '-' : '+'}{fmt(linkModal.txn.outflow || linkModal.txn.inflow)}
          </div>
          <label style={st.label}>Target account</label>
          <select
            style={{ ...st.inlineSelect, width: '100%', marginTop: 6 }}
            value={linkModal.targetAccountId}
            onChange={e => handleLinkSelectAccount(e.target.value)}
          >
            <option value="">Select account…</option>
            {[...(accounts.budget ?? []), ...(accounts.tracking ?? [])].filter(a => a.id !== accountId).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {linkModal.loading && <div style={{ marginTop: 12, color: T.textDim, fontSize: 13 }}>Loading candidates…</div>}
        </>
      )}
      {linkModal.step === 2 && (
        <>
          <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>Select the matching transaction:</div>
          {linkModal.candidates.length === 0
            ? <div style={{ color: T.textFaint, fontSize: 13 }}>No unlinked transactions with matching amount found.</div>
            : linkModal.candidates.map(c => (
              <div key={c.id}
                onClick={() => handleLinkConfirm(c.id)}
                style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: T.text, fontSize: 13 }}>{c.payee}</div>
                  <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>{c.date}</div>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 13, color: c.inflow > 0 ? T.pos : T.textMid }}>
                  {c.inflow > 0 ? '+' : '-'}{fmt(c.inflow || c.outflow)}
                </div>
              </div>
            ))
          }
        </>
      )}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setLinkModal(null)} style={st.ghostBtn}>Cancel</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Build TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add Link button and two-step link modal to Accounts"
```

---

### Task 9: Frontend UI — Batch review table in Accounts.tsx

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add batch review table JSX**

Inside the return of `Accounts`, after the link modal block, add:

```tsx
{/* Batch review table */}
{batchReview && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => setBatchReview(null)}>
    <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 640, maxHeight: '80vh', overflowY: 'auto' }}
      onClick={e => e.stopPropagation()}>
      <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 4 }}>Match All "{batchReview.payee}" Transfers</div>
      <div style={{ fontSize: 13, color: T.textDim, marginBottom: 18 }}>Review auto-proposed matches. Uncheck any you want to skip.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['', 'This account', '', 'Target account'].map((h, i) => (
              <th key={i} style={{ fontSize: 10.5, fontWeight: 700, color: T.textDim, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {batchReview.pairs.map((pair, i) => (
            <tr key={pair.source.id} style={{ borderBottom: `1px solid ${T.borderSoft}`, opacity: pair.include ? 1 : 0.45 }}>
              <td style={{ padding: '8px 8px' }}>
                <input
                  type="checkbox"
                  checked={pair.include}
                  disabled={!pair.candidate}
                  onChange={() => setBatchReview(br => br ? {
                    ...br,
                    pairs: br.pairs.map((p, j) => j === i ? { ...p, include: !p.include } : p)
                  } : null)}
                />
              </td>
              <td style={{ padding: '8px 8px', fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: T.text }}>{pair.source.date}</div>
                <div style={{ color: T.textDim }}>{fmt(pair.source.outflow || pair.source.inflow)}</div>
              </td>
              <td style={{ padding: '8px 4px', color: T.textFaint }}>→</td>
              <td style={{ padding: '8px 8px', fontSize: 12 }}>
                {pair.candidate
                  ? <><div style={{ fontWeight: 600, color: T.text }}>{pair.candidate.date}</div><div style={{ color: T.textDim }}>{fmt(pair.candidate.inflow || pair.candidate.outflow)}</div></>
                  : <span style={{ color: T.textFaint, fontStyle: 'italic' }}>No candidate found</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: T.textDim }}>{batchReview.pairs.filter(p => p.include).length} pairs selected</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setBatchReview(null)} style={st.ghostBtn}>Cancel</button>
          <button
            onClick={handleBatchLink}
            disabled={batchReview.pairs.filter(p => p.include).length === 0}
            style={{ ...st.primaryBtn, opacity: batchReview.pairs.filter(p => p.include).length === 0 ? 0.45 : 1 }}
          >
            Link {batchReview.pairs.filter(p => p.include).length} pairs
          </button>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Check TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add batch transfer review table to Accounts"
```

---

### Task 10: Frontend UI — Post-import link step in Import.tsx

**Files:**
- Modify: `frontend/src/components/Import.tsx`

- [ ] **Step 1: Add imports**

At the top of `Import.tsx`, update the api import to include the new functions and update `ConfirmTxn` type usage:

```typescript
import {
  fetchImportHistory, fetchAccounts, fetchPayeeRules,
  createPayeeRule, updatePayeeRule, deletePayeeRule,
  importPreview, importConfirm, fetchTransferCandidates, linkTransfer,
} from '../api';
import type { ImportRecord, PayeeRule as ApiPayeeRule, ConfirmTxn, Account } from '../api';
```

- [ ] **Step 2: Add `isTransfer` to `ParsedRow`**

Update the `ParsedRow` interface:

```typescript
interface ParsedRow {
  tempId: string;
  date: string;
  descriptionRaw: string;
  amount: number;
  reference: string;
  categoryId: string | null;
  autoCat: boolean;
  duplicateOf: string | null;
  include: boolean;
  isTransfer: boolean;
}
```

- [ ] **Step 3: Parse `is_transfer` in `runPreview`**

In the `runPreview` function, update the row mapping to include `isTransfer`:

```typescript
const rows: ParsedRow[] = resp.transactions.map(t => ({
  tempId: t.temp_id,
  date: t.date,
  descriptionRaw: t.description_raw,
  amount: t.amount,
  reference: t.reference,
  categoryId: t.suggested_category_id,
  autoCat: t.suggested_category_id != null,
  duplicateOf: t.duplicate_of,
  include: t.duplicate_of == null,
  isTransfer: t.is_transfer,
}));
```

- [ ] **Step 4: Pass `is_transfer` in the confirm payload**

In `runConfirm`, update the payload mapping:

```typescript
const payload: ConfirmTxn[] = parsed.map(r => ({
  include: r.include,
  date: r.date,
  amount: r.amount,
  description_raw: r.descriptionRaw,
  reference: r.reference,
  category_id: r.categoryId,
  payee_override: null,
  memo: null,
  is_transfer: r.isTransfer,
}));
```

- [ ] **Step 5: Add pending transfer state and link step**

Inside `ImportWizard`, add state for pending transfers and the link modal:

```typescript
const [pendingTransferIds, setPendingTransferIds] = useState<string[]>([]);
const [linkState, setLinkState] = useState<{
  id: string;
  date: string;
  amount: number;
  description: string;
  step: 1 | 2;
  targetAccountId: string;
  candidates: import('../api').Transaction[];
  loading: boolean;
} | null>(null);
```

- [ ] **Step 6: Capture transfer IDs in runConfirm**

Update `runConfirm`'s `.then` callback:

```typescript
importConfirm(uploadInfo.accountId, uploadInfo.file.name, payload)
  .then(resp => {
    setResult({ imported: resp.imported_count, skipped: resp.skipped_count });
    if (resp.transfer_transaction_ids && resp.transfer_transaction_ids.length > 0) {
      setPendingTransferIds(resp.transfer_transaction_ids);
      // Build display info from parsed rows that were included + isTransfer.
      const transferRows = parsed.filter(r => r.include && r.isTransfer);
      setStep(3); // Link step
    } else {
      setDone(true);
    }
  })
  .catch(err => toast.error('Import failed: ' + err.message))
  .finally(() => setConfirming(false));
```

- [ ] **Step 7: Add the link step JSX (step 3)**

In the step rendering block inside `ImportWizard`, after `{step === 2 && <Step3 ...>}`, add:

```tsx
{step === 3 && (
  <div style={st.stepCard}>
    <h3 style={st.stepTitle}>Link Transfer Transactions</h3>
    <p style={st.stepSub}>
      {pendingTransferIds.length} imported transaction{pendingTransferIds.length > 1 ? 's were' : ' was'} flagged as a bank transfer.
      Link each one to its counterpart in another account, or skip.
    </p>
    {pendingTransferIds.map((txnId, i) => {
      const row = parsed.filter(r => r.include && r.isTransfer)[i];
      return (
        <div key={txnId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>{row?.descriptionRaw ?? txnId}</div>
            <div style={{ fontSize: 11, color: T.textDim }}>{row?.date} · {row ? (row.amount > 0 ? '+' : '−') + fmt(Math.abs(row.amount) / 100) : ''}</div>
          </div>
          <button
            onClick={() => setLinkState({
              id: txnId,
              date: row?.date ?? '',
              amount: row?.amount ?? 0,
              description: row?.descriptionRaw ?? '',
              step: 1,
              targetAccountId: '',
              candidates: [],
              loading: false,
            })}
            style={{ ...st.primaryBtn, fontSize: 12, padding: '6px 14px' }}
          >
            Link…
          </button>
        </div>
      );
    })}
    <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={() => setDone(true)} style={st.ghostBtn}>Done</button>
    </div>
  </div>
)}
```

- [ ] **Step 8: Add the link modal inside ImportWizard**

Inside the ImportWizard return, before the closing fragment, add:

```tsx
{linkState && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => setLinkState(null)}>
    <div style={{ background: T.surface, borderRadius: 12, padding: 28, width: 460, maxHeight: '80vh', overflowY: 'auto' }}
      onClick={e => e.stopPropagation()}>
      <div style={{ fontWeight: 700, fontSize: 16, color: T.text, marginBottom: 16 }}>Link Transfer</div>
      {linkState.step === 1 && (
        <>
          <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>
            <b style={{ color: T.text }}>{linkState.description}</b><br />
            {linkState.date} · {linkState.amount > 0 ? '+' : '−'}{fmt(Math.abs(linkState.amount) / 100)}
          </div>
          <label style={st.label}>Target account</label>
          <select
            style={{ ...st.select, marginTop: 6 }}
            value={linkState.targetAccountId}
            onChange={async e => {
              const tgtId = e.target.value;
              setLinkState(s => s ? { ...s, targetAccountId: tgtId, loading: true } : null);
              const cands = await fetchTransferCandidates(tgtId, linkState.amount / 100).catch(() => []);
              setLinkState(s => s ? { ...s, step: 2, candidates: cands, loading: false } : null);
            }}
          >
            <option value="">Select account…</option>
            {[...(accounts.budget ?? []), ...(accounts.tracking ?? [])].map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {linkState.loading && <div style={{ marginTop: 10, color: T.textDim, fontSize: 13 }}>Loading…</div>}
        </>
      )}
      {linkState.step === 2 && (
        <>
          <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12 }}>Select the matching transaction:</div>
          {linkState.candidates.length === 0
            ? <div style={{ color: T.textFaint, fontSize: 13 }}>No unlinked matching transactions found.</div>
            : linkState.candidates.map(c => (
              <div key={c.id}
                onClick={async () => {
                  try {
                    await linkTransfer(linkState.id, c.id);
                    setPendingTransferIds(ids => ids.filter(id => id !== linkState.id));
                    setLinkState(null);
                    if (pendingTransferIds.length === 1) setDone(true);
                  } catch (e: any) { alert('Link failed: ' + e.message); }
                }}
                style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.payee}</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>{c.date}</div>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 13 }}>{c.inflow > 0 ? '+' : '−'}{fmt(c.inflow || c.outflow)}</div>
              </div>
            ))
          }
        </>
      )}
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setLinkState(null)} style={st.ghostBtn}>Cancel</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 9: Show "Transfer" badge on import review rows**

In `Step2`, the row table currently shows payee info. In the payee `<td>`, after the `{row.autoCat && ...}` and `{row.duplicateOf ...}` badges, add:

```tsx
{row.isTransfer && <span style={{ fontSize: 9, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }}>⇄</span>}
```

Since `Step2` receives `parsed: ParsedRow[]` and `ParsedRow` now has `isTransfer`, this works without any prop changes.

- [ ] **Step 10: Check TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/Import.tsx
git commit -m "feat: add post-import link step for bank-flagged transfer rows"
```

---

## Self-Review

**Spec coverage:**
- [x] `TransferCandidates` — returns unlinked rows with opposite amount (Task 2)
- [x] `LinkTransfer` — validates + atomically sets peer IDs (Task 3)
- [x] `LinkTransferBatch` — atomic batch with rollback (Task 4)
- [x] Three new routes (Task 5)
- [x] Import pipeline returns transfer IDs (Task 6)
- [x] Frontend API functions (Task 7)
- [x] "Link" button + two-step modal on transaction rows (Task 8)
- [x] Batch review table triggered after successful link (Task 9)
- [x] Post-import link step for `is_transfer` rows (Task 10)
- [x] Bug fix: `Get`/`ListByAccount` now return `transfer_peer_id` (Task 1)

**Placeholder scan:** No TBD or TODO in any step. All code blocks are complete.

**Type consistency:** `TransferCandidates(ctx, accountID string, amount int64)` — the `amount` parameter is the **signed** amount of the source transaction; the query filters for `-amount`. Frontend passes `linkModal.txn.outflow > 0 ? -linkModal.txn.outflow : linkModal.txn.inflow` which correctly converts from the outflow/inflow split back to a signed major-unit amount before `fetchTransferCandidates` converts to centimos. Consistent end-to-end.
