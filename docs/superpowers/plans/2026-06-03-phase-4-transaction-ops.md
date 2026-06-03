# Phase 4 Transaction Operations + Toast Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side transaction search/filter/sort/pagination with a summary block, a batch operations endpoint, and a toast notification system; rewire the Accounts page to be fully server-driven with bulk actions, persisted cleared-toggle, confirmations, and loading/empty/error states.

**Architecture:** The Go list endpoint gains a `TxnFilter` struct whose WHERE clause is shared by the count, page, and summary aggregate queries. A new `PATCH /api/transactions/batch` runs categorize/clear/unclear/delete in one DB transaction. The React Accounts page replaces all client-side filtering/sorting with server calls keyed off a `filter` state object, and a new `ToastProvider` context (mirroring the existing currency/data patterns) surfaces success/error feedback.

**Tech Stack:** Go 1.26, pgx v5, PostgreSQL 18 (backend); React 19 + TypeScript + Vite, inline styles only (frontend). Money in centimos server-side; major-unit conversion lives only in `api.ts`.

---

## File Structure

**Backend:**
- `server/internal/repository/transaction_repo.go` — add `TxnFilter`, `TxnSummary`, rewrite `ListByAccount`, add `BatchUpdate`
- `server/internal/repository/transaction_repo_test.go` — **new**, filter/sort/summary/batch tests
- `server/internal/testutil/helpers.go` — add `SeedTransactionFull` (payee/memo/cleared)
- `server/internal/handler/transactions.go` — rewrite `ListByAccount`, add `Batch`
- `server/main.go` — register the batch route

**Frontend:**
- `frontend/src/api.ts` — `TxnPage`, `TxnFilterParams` types, `fetchTransactionsPage`, `batchTransactions`, update `fetchAccountTransactions`
- `frontend/src/components/Toast.tsx` — **new**, `ToastProvider` + `useToast` + `ToastContainer`
- `frontend/src/App.tsx` — wrap tree in `<ToastProvider>`, render `<ToastContainer>`
- `frontend/src/components/Accounts.tsx` — server-driven data flow, pagination, bulk bar, confirmations, toasts, states

---

## Task 1: Repo — TxnFilter, TxnSummary, and filtered ListByAccount

**Files:**
- Modify: `server/internal/testutil/helpers.go`
- Modify: `server/internal/repository/transaction_repo.go:20-64` (replace `ListByAccount`)
- Test: `server/internal/repository/transaction_repo_test.go` (new)

- [ ] **Step 1: Add a seed helper with payee/memo/cleared**

Add to `server/internal/testutil/helpers.go` (before `var idCounter`):

```go
// SeedTransactionFull inserts a transaction with payee, memo, and cleared set.
func SeedTransactionFull(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64, payee, memo string, cleared bool) string {
	t.Helper()
	var catParam interface{}
	if categoryID != "" {
		catParam = categoryID
	}
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, category_id, date, amount, currency, payee, memo, cleared)
		 VALUES ($1::uuid, $2::uuid, $3::date, $4, 'CRC', $5, NULLIF($6,''), $7) RETURNING id::text`,
		accountID, catParam, date, amount, payee, memo, cleared,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransactionFull: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}
```

- [ ] **Step 2: Write the failing repo tests**

Create `server/internal/repository/transaction_repo_test.go`:

```go
// server/internal/repository/transaction_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestTransactionRepo_FilterSearch(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "ZARA", "shirt", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "NIKE", "zapatos", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-03", -3000, "WALMART", "ZARA-brand socks", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// search matches payee (ZARA) and memo (ZARA-brand socks) -> 2 rows
	txns, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Search: "zara"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Errorf("want total 2 got %d (txns len %d)", total, len(txns))
	}
}

func TestTransactionRepo_FilterDateRange(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-15", -2000, "B", "", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-05-01", -3000, "C", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{FromDate: "2026-04-10", ToDate: "2026-04-30"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 got %d", total)
	}
}

func TestTransactionRepo_FilterCleared(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	cleared := true

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Cleared: &cleared})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 cleared got %d", total)
	}
}

func TestTransactionRepo_FilterUncategorized(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{CategoryID: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 uncategorized got %d", total)
	}
}

func TestTransactionRepo_SortAndSummary(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "AAA", "", true)  // outflow, cleared
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", 5000, "BBB", "", false)  // inflow, uncleared

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	txns, total, summary, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Sort: "amount_asc"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Fatalf("want 2 got %d", total)
	}
	if txns[0].Amount != -1000 {
		t.Errorf("amount_asc: want first -1000 got %d", txns[0].Amount)
	}
	if summary.TotalInflow != 5000 {
		t.Errorf("want inflow 5000 got %d", summary.TotalInflow)
	}
	if summary.TotalOutflow != 1000 {
		t.Errorf("want outflow magnitude 1000 got %d", summary.TotalOutflow)
	}
	if summary.ClearedBalance != -1000 {
		t.Errorf("want cleared_balance -1000 got %d", summary.ClearedBalance)
	}
	if summary.UnclearedBalance != 5000 {
		t.Errorf("want uncleared_balance 5000 got %d", summary.UnclearedBalance)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail to compile**

Run: `cd server && go test ./internal/repository/ -run TestTransactionRepo`
Expected: FAIL — compile error, `TxnFilter`/`TxnSummary` undefined and `ListByAccount` signature mismatch.

- [ ] **Step 4: Implement TxnFilter, TxnSummary, whereClause, and ListByAccount**

In `server/internal/repository/transaction_repo.go`, replace the existing `ListByAccount` method (lines 20-64) with the following. Keep imports; add `"strings"` and `"strconv"` to the import block.

```go
// TxnFilter holds the optional filters for listing an account's transactions.
type TxnFilter struct {
	Search     string // ILIKE across payee and memo
	FromDate   string // "YYYY-MM-DD" inclusive
	ToDate     string // "YYYY-MM-DD" inclusive
	CategoryID string // UUID, "none" (uncategorized), or "" (all)
	Cleared    *bool  // nil = all
	MinAmount  *int64 // centimos, compared against ABS(amount)
	MaxAmount  *int64 // centimos, compared against ABS(amount)
	Sort       string // see sortClause; default date_desc
	Page       int    // 1-based, default 1
	PerPage    int    // default 50, max 200
}

// TxnSummary aggregates the full filtered set (not just one page), in centimos.
type TxnSummary struct {
	TotalInflow      int64 `json:"total_inflow"`
	TotalOutflow     int64 `json:"total_outflow"` // positive magnitude
	ClearedBalance   int64 `json:"cleared_balance"`
	UnclearedBalance int64 `json:"uncleared_balance"`
}

// whereClause builds the shared WHERE predicate. accountID is always $1; further
// args start at $2. Returns the SQL fragment (without the "WHERE" keyword) and the
// arg slice including accountID at index 0.
func (f TxnFilter) whereClause(accountID string) (string, []any) {
	conds := []string{"t.account_id = $1"}
	args := []any{accountID}
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, strings.Replace(cond, "?", "$"+strconv.Itoa(len(args)), 1))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		n := "$" + strconv.Itoa(len(args))
		conds = append(conds, "(t.payee ILIKE "+n+" OR t.memo ILIKE "+n+")")
	}
	if f.FromDate != "" {
		add("t.date >= ?::date", f.FromDate)
	}
	if f.ToDate != "" {
		add("t.date <= ?::date", f.ToDate)
	}
	if f.CategoryID == "none" {
		conds = append(conds, "t.category_id IS NULL")
	} else if f.CategoryID != "" {
		add("t.category_id = ?::uuid", f.CategoryID)
	}
	if f.Cleared != nil {
		add("t.cleared = ?", *f.Cleared)
	}
	if f.MinAmount != nil {
		add("ABS(t.amount) >= ?", *f.MinAmount)
	}
	if f.MaxAmount != nil {
		add("ABS(t.amount) <= ?", *f.MaxAmount)
	}
	return strings.Join(conds, " AND "), args
}

// sortClause whitelists ORDER BY expressions so no raw input reaches SQL.
func sortClause(sort string) string {
	switch sort {
	case "date_asc":
		return "t.date ASC, t.created_at ASC"
	case "amount_asc":
		return "t.amount ASC"
	case "amount_desc":
		return "t.amount DESC"
	case "payee_asc":
		return "t.payee ASC"
	case "payee_desc":
		return "t.payee DESC"
	case "category_asc":
		return "c.name ASC NULLS LAST"
	case "category_desc":
		return "c.name DESC NULLS LAST"
	case "memo_asc":
		return "t.memo ASC NULLS LAST"
	case "memo_desc":
		return "t.memo DESC NULLS LAST"
	case "cleared_asc":
		return "t.cleared ASC"
	case "cleared_desc":
		return "t.cleared DESC"
	default: // date_desc
		return "t.date DESC, t.created_at DESC"
	}
}

func (r *TransactionRepo) ListByAccount(ctx context.Context, accountID string, f TxnFilter) ([]model.Transaction, int64, TxnSummary, error) {
	page := f.Page
	if page < 1 {
		page = 1
	}
	perPage := f.PerPage
	if perPage < 1 || perPage > 200 {
		perPage = 50
	}
	offset := (page - 1) * perPage

	where, args := f.whereClause(accountID)
	var summary TxnSummary

	var total int64
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions t WHERE `+where, args...,
	).Scan(&total); err != nil {
		return nil, 0, summary, fmt.Errorf("count transactions: %w", err)
	}

	if err := r.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN t.cleared THEN t.amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN NOT t.cleared THEN t.amount ELSE 0 END), 0)
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE `+where, args...,
	).Scan(&summary.TotalInflow, &summary.TotalOutflow, &summary.ClearedBalance, &summary.UnclearedBalance); err != nil {
		return nil, 0, summary, fmt.Errorf("summary transactions: %w", err)
	}

	pageArgs := append(append([]any{}, args...), perPage, offset)
	limPlace := "$" + strconv.Itoa(len(pageArgs)-1)
	offPlace := "$" + strconv.Itoa(len(pageArgs))
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE `+where+`
		ORDER BY `+sortClause(f.Sort)+`
		LIMIT `+limPlace+` OFFSET `+offPlace, pageArgs...)
	if err != nil {
		return nil, 0, summary, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	var txns []model.Transaction
	for rows.Next() {
		var t model.Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate); err != nil {
			return nil, 0, summary, fmt.Errorf("scan transaction: %w", err)
		}
		txns = append(txns, t)
	}
	return txns, total, summary, rows.Err()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && go test ./internal/repository/ -run TestTransactionRepo -v`
Expected: PASS (all 5 tests). If no test DB is available the tests SKIP — that is acceptable; note it and continue.

- [ ] **Step 6: Commit**

```bash
git add server/internal/testutil/helpers.go server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: server-side transaction filter/sort/summary in repo"
```

---

## Task 2: Handler — parse query params and new response shape

**Files:**
- Modify: `server/internal/handler/transactions.go:46-76` (replace `ListByAccount`)

- [ ] **Step 1: Rewrite the ListByAccount handler**

Replace the existing `ListByAccount` method (lines 46-76) in `server/internal/handler/transactions.go` with:

```go
func parseAmountParam(s string) *int64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func (h *TransactionHandler) ListByAccount(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	perPage, _ := strconv.Atoi(q.Get("per_page"))

	f := repository.TxnFilter{
		Search:     q.Get("search"),
		FromDate:   q.Get("from_date"),
		ToDate:     q.Get("to_date"),
		CategoryID: q.Get("category_id"),
		Sort:       q.Get("sort"),
		MinAmount:  parseAmountParam(q.Get("min_amount")),
		MaxAmount:  parseAmountParam(q.Get("max_amount")),
		Page:       page,
		PerPage:    perPage,
	}
	if c := q.Get("cleared"); c == "true" || c == "false" {
		b := c == "true"
		f.Cleared = &b
	}

	txns, total, summary, err := h.repo.ListByAccount(r.Context(), accountID, f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	resp := make([]map[string]any, len(txns))
	for i, t := range txns {
		resp[i] = h.toResponse(t)
	}

	pp := f.PerPage
	if pp < 1 || pp > 200 {
		pp = 50
	}
	p := f.Page
	if p < 1 {
		p = 1
	}
	totalPages := int((total + int64(pp) - 1) / int64(pp))

	writeJSON(w, http.StatusOK, map[string]any{
		"transactions": resp,
		"pagination": map[string]any{
			"page":        p,
			"per_page":    pp,
			"total":       total,
			"total_pages": totalPages,
		},
		"summary": summary,
	})
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd server && go build ./...`
Expected: success, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/transactions.go
git commit -m "feat: transaction list endpoint accepts search/filter/sort + summary"
```

---

## Task 3: Repo — BatchUpdate

**Files:**
- Modify: `server/internal/repository/transaction_repo.go` (add `BatchUpdate` after `Delete`)
- Test: `server/internal/repository/transaction_repo_test.go` (append)

- [ ] **Step 1: Write the failing batch tests**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_BatchCategorize(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-01", -1000, "A", "", false)
	id2 := testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	n, err := repo.BatchUpdate(ctx, []string{id1, id2}, "categorize", cat)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("want 2 affected got %d", n)
	}
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{CategoryID: cat})
	if total != 2 {
		t.Errorf("want 2 in category got %d", total)
	}
}

func TestTransactionRepo_BatchClear(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	if _, err := repo.BatchUpdate(ctx, []string{id1}, "clear", ""); err != nil {
		t.Fatal(err)
	}
	cleared := true
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{Cleared: &cleared})
	if total != 1 {
		t.Errorf("want 1 cleared got %d", total)
	}
}

func TestTransactionRepo_BatchDeleteReversesBalance(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool) // balance starts at 0
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	id2 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	n, err := repo.BatchUpdate(ctx, []string{id1, id2}, "delete", "")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("want 2 deleted got %d", n)
	}
	// rows gone
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{})
	if total != 0 {
		t.Errorf("want 0 remaining got %d", total)
	}
	// balance reversed: 0 - (-3000) = 3000
	var bal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, acc).Scan(&bal)
	if bal != 3000 {
		t.Errorf("want balance 3000 after reversal got %d", bal)
	}
}

func TestTransactionRepo_BatchUnknownAction(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)

	repo := repository.NewTransactionRepo(pool)
	if _, err := repo.BatchUpdate(context.Background(), []string{id1}, "bogus", ""); err == nil {
		t.Error("want error for unknown action, got nil")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./internal/repository/ -run TestTransactionRepo_Batch`
Expected: FAIL — `BatchUpdate` undefined (compile error).

- [ ] **Step 3: Implement BatchUpdate**

Add to `server/internal/repository/transaction_repo.go` (after the `Delete` method, before `SpendingByGroupRow`):

```go
// BatchUpdate applies an action to many transactions in one DB transaction.
// action: "categorize" (categoryID="" uncategorizes), "clear", "unclear", "delete".
// Returns the number of affected rows.
func (r *TransactionRepo) BatchUpdate(ctx context.Context, ids []string, action, categoryID string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var affected int64
	switch action {
	case "categorize":
		tag, err := tx.Exec(ctx,
			`UPDATE transactions SET category_id = NULLIF($1,'')::uuid, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
			categoryID, ids)
		if err != nil {
			return 0, fmt.Errorf("batch categorize: %w", err)
		}
		affected = tag.RowsAffected()
	case "clear", "unclear":
		tag, err := tx.Exec(ctx,
			`UPDATE transactions SET cleared = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
			action == "clear", ids)
		if err != nil {
			return 0, fmt.Errorf("batch clear: %w", err)
		}
		affected = tag.RowsAffected()
	case "delete":
		rows, err := tx.Query(ctx,
			`SELECT account_id::text, COALESCE(SUM(amount),0)::bigint
			 FROM transactions WHERE id = ANY($1::uuid[]) GROUP BY account_id`, ids)
		if err != nil {
			return 0, fmt.Errorf("batch delete sums: %w", err)
		}
		type acctSum struct {
			id  string
			sum int64
		}
		var sums []acctSum
		for rows.Next() {
			var a acctSum
			if err := rows.Scan(&a.id, &a.sum); err != nil {
				rows.Close()
				return 0, fmt.Errorf("scan delete sum: %w", err)
			}
			sums = append(sums, a)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return 0, err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return 0, fmt.Errorf("batch delete: %w", err)
		}
		affected = tag.RowsAffected()
		for _, a := range sums {
			if _, err := tx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
				a.sum, a.id); err != nil {
				return 0, fmt.Errorf("reverse balance: %w", err)
			}
		}
	default:
		return 0, fmt.Errorf("unknown batch action: %s", action)
	}

	return affected, tx.Commit(ctx)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/repository/ -run TestTransactionRepo_Batch -v`
Expected: PASS (4 tests). SKIP is acceptable if no test DB.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: batch transaction operations in repo"
```

---

## Task 4: Handler + route — PATCH /api/transactions/batch

**Files:**
- Modify: `server/internal/handler/transactions.go` (add `Batch` method)
- Modify: `server/main.go:108` (add route)

- [ ] **Step 1: Add the Batch handler**

Append to `server/internal/handler/transactions.go` (after `Delete`):

```go
type batchReq struct {
	TransactionIDs []string `json:"transaction_ids"`
	Action         string   `json:"action"`
	CategoryID     string   `json:"category_id"`
}

func (h *TransactionHandler) Batch(w http.ResponseWriter, r *http.Request) {
	var req batchReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.TransactionIDs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "transaction_ids is required")
		return
	}
	switch req.Action {
	case "categorize", "clear", "unclear", "delete":
	default:
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "unknown action")
		return
	}

	affected, err := h.repo.BatchUpdate(r.Context(), req.TransactionIDs, req.Action, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}
```

- [ ] **Step 2: Register the route**

In `server/main.go`, add after line 108 (`mux.HandleFunc("DELETE /api/transactions/{id}", txns.Delete)`):

```go
	mux.HandleFunc("PATCH /api/transactions/batch", txns.Batch)
```

- [ ] **Step 3: Build and run the full backend test suite**

Run: `cd server && go build ./... && go test ./...`
Expected: build succeeds; tests pass or SKIP (no test DB).

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/transactions.go server/main.go
git commit -m "feat: PATCH /api/transactions/batch endpoint"
```

---

## Task 5: Frontend api.ts — paged fetch, batch, updated helpers

**Files:**
- Modify: `frontend/src/api.ts:58-102` (Transactions section)

- [ ] **Step 1: Add types and replace the transactions section**

In `frontend/src/api.ts`, replace the `// ─── Transactions ───` section (lines 58-102, through `deleteTransaction`) with:

```ts
// ─── Transactions ──────────────────────────────────────────────────────────────

export interface TxnPage {
  transactions: Transaction[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
  summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
}

export interface TxnFilterParams {
  search?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;   // UUID, "none", or omitted
  cleared?: boolean;
  sort?: string;          // date_desc | date_asc | amount_asc | amount_desc | payee_asc | ...
  page?: number;
  per_page?: number;
}

function mapApiTxn(t: { id: string; date: string; payee: string; category: string | null; memo: string; cleared: boolean; account: string; currency: string; amount: number; exchange_rate?: number | null }): Transaction {
  const major = t.amount / 100;
  return {
    id: t.id, date: t.date, payee: t.payee, category: t.category,
    memo: t.memo, cleared: t.cleared, account: t.account,
    currency: t.currency, exchange_rate: t.exchange_rate,
    outflow: major < 0 ? -major : 0,
    inflow: major > 0 ? major : 0,
  } as Transaction;
}

export async function fetchTransactionsPage(
  accountId: string,
  filter: TxnFilterParams = {},
): Promise<TxnPage> {
  const params = new URLSearchParams();
  if (filter.search) params.set('search', filter.search);
  if (filter.from_date) params.set('from_date', filter.from_date);
  if (filter.to_date) params.set('to_date', filter.to_date);
  if (filter.category_id) params.set('category_id', filter.category_id);
  if (filter.cleared !== undefined) params.set('cleared', String(filter.cleared));
  if (filter.sort) params.set('sort', filter.sort);
  params.set('page', String(filter.page ?? 1));
  params.set('per_page', String(filter.per_page ?? 50));

  type ApiTxn = Parameters<typeof mapApiTxn>[0];
  const data = await apiFetch<{
    transactions: ApiTxn[];
    pagination: TxnPage['pagination'];
    summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
  }>(`/accounts/${accountId}/transactions?${params}`);

  return {
    transactions: (data.transactions ?? []).map(mapApiTxn),
    pagination: data.pagination,
    summary: {
      total_inflow: data.summary.total_inflow / 100,
      total_outflow: data.summary.total_outflow / 100,
      cleared_balance: data.summary.cleared_balance / 100,
      uncleared_balance: data.summary.uncleared_balance / 100,
    },
  };
}

// Backwards-compatible helper used by fetchRecentTransactions / Dashboard.
export async function fetchAccountTransactions(
  accountId: string,
  page = 1,
  perPage = 200,
): Promise<Transaction[]> {
  const data = await fetchTransactionsPage(accountId, { page, per_page: perPage });
  return data.transactions;
}

export async function createTransaction(
  accountId: string,
  body: { date: string; payee: string; category_id?: string; amount: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  return apiFetch(`/accounts/${accountId}/transactions`, {
    method: 'POST',
    body: JSON.stringify({ ...body, amount: Math.round(body.amount * 100) }),
  });
}

export async function updateTransaction(
  id: string,
  body: { date?: string; payee?: string; category_id?: string; amount?: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  const payload = body.amount === undefined ? body : { ...body, amount: Math.round(body.amount * 100) };
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteTransaction(id: string): Promise<void> {
  return apiFetch(`/transactions/${id}`, { method: 'DELETE' });
}

export async function batchTransactions(
  ids: string[],
  action: 'categorize' | 'clear' | 'unclear' | 'delete',
  categoryId?: string,
): Promise<{ affected: number }> {
  return apiFetch('/transactions/batch', {
    method: 'PATCH',
    body: JSON.stringify({ transaction_ids: ids, action, category_id: categoryId ?? '' }),
  });
}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (Accounts.tsx still uses `fetchAccountTransactions` which still exists, so it compiles.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: paged transaction fetch + batch API client"
```

---

## Task 6: Frontend — Toast system

**Files:**
- Create: `frontend/src/components/Toast.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create the Toast module**

Create `frontend/src/components/Toast.tsx`:

```tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { T } from '../theme';

type Severity = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; severity: Severity; }
interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => setItems(xs => xs.filter(x => x.id !== id)), []);
  const push = useCallback((message: string, severity: Severity) => {
    const id = nextId++;
    setItems(xs => [...xs, { id, message, severity }]);
    setTimeout(() => remove(id), 4000);
  }, [remove]);

  const api: ToastApi = {
    success: m => push(m, 'success'),
    error: m => push(m, 'error'),
    info: m => push(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div style={ts.container}>
        {items.map(item => (
          <div key={item.id} style={{ ...ts.toast, ...ts.bySeverity[item.severity] }}>
            <span style={{ flex: 1 }}>{item.message}</span>
            <button onClick={() => remove(item.id)} style={ts.close}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ts = {
  container: { position: 'fixed' as const, bottom: 22, left: 22, display: 'flex', flexDirection: 'column' as const, gap: 8, zIndex: 10000 },
  toast: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 240, maxWidth: 380, padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.text, background: T.surface2, border: `1px solid ${T.borderHi}`, boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', animation: 'fadeUp 0.22s cubic-bezier(0.22, 1, 0.36, 1)' },
  bySeverity: {
    success: { borderColor: 'var(--accent)', boxShadow: `0 0 0 1px var(--accent), 0 16px 40px -12px rgba(0,0,0,0.7)` },
    error: { borderColor: T.neg, color: T.neg },
    info: {},
  } as Record<Severity, React.CSSProperties>,
  close: { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 12, padding: 2 },
};
```

- [ ] **Step 2: Wrap the App tree in ToastProvider**

In `frontend/src/App.tsx`:

Add the import after line 13 (`import { Reports } from './components/Reports';`):
```tsx
import { ToastProvider } from './components/Toast';
```

Wrap the returned JSX. Change the opening of the `return` in `App()` from:
```tsx
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, backgroundImage: T.bgGrad, position: 'relative' }}>
```
to:
```tsx
  return (
    <ToastProvider>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, backgroundImage: T.bgGrad, position: 'relative' }}>
```
and change the matching close of that `<div>` (the last `</div>` before `);` at the end of `App`, currently line 174) from:
```tsx
    </div>
  );
```
to:
```tsx
    </div>
    </ToastProvider>
  );
```

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Toast.tsx frontend/src/App.tsx
git commit -m "feat: toast notification provider"
```

---

## Task 7: Accounts.tsx — server-driven data flow + pagination + summary

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

This task replaces the client-side filtering/sorting/data fetch with server calls. Bulk actions, confirmations, and toasts come in Task 8.

- [ ] **Step 1: Update imports**

In `frontend/src/components/Accounts.tsx`, replace line 2:
```tsx
import { updateTransaction, deleteTransaction, createTransaction, fetchAccountTransactions } from '../api';
```
with:
```tsx
import { updateTransaction, deleteTransaction, createTransaction, fetchTransactionsPage, batchTransactions, type TxnPage, type TxnFilterParams } from '../api';
import { useToast } from './Toast';
```

- [ ] **Step 2: Replace data-flow state and effects**

Replace the block from line 103 (`const [txns, setTxns] = useState<Transaction[]>([]);`) through the end of the `filtered`/`totals` memos (line 223) with the following. This removes client-side `filtered`/`totals`/sort-in-memo and introduces server params. Keep the `addForm`/`showAddTxn`/`addSaving` state and the `handleAddTxn` function (they are inside this range — re-add them as shown).

```tsx
  const toast = useToast();

  // categoryId lookup for the filter dropdown (name -> id), reverse of categoryIdByName
  const catNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [name, id] of Object.entries(categoryIdByName)) m[id] = name;
    return m;
  }, [categoryIdByName]);

  const [page, setPage] = useState<TxnPage | null>(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [addForm, setAddForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false,
  });
  const [addSaving, setAddSaving] = useState(false);

  const [selected, setSelected] = useState(new Set<string>());
  const [sort, setSort] = useState('date_desc');
  // UI filter inputs (category holds a category NAME for the existing dropdown)
  const [filter, setFilter] = useState({ payee: '', category: '', from: '', to: '' });
  const [pageNum, setPageNum] = useState(1);
  const [rules, setRules] = useState<PayeeRule[]>([...AppData.payeeRules]);
  const [modal, setModal] = useState<null | 'reconcile' | 'rules' | { split: Transaction }>(null);
  const [dismissedSched, setDismissedSched] = useState(new Set<string>());

  const txns = page?.transactions ?? [];

  // Build server filter params from UI state.
  const buildParams = useCallback((): TxnFilterParams => {
    const categoryId =
      filter.category === '' ? undefined :
      filter.category === '__uncategorized__' ? 'none' :
      (categoryIdByName[filter.category] ?? undefined);
    return {
      search: filter.payee || undefined,
      from_date: filter.from || undefined,
      to_date: filter.to || undefined,
      category_id: categoryId,
      sort,
      page: pageNum,
      per_page: 50,
    };
  }, [filter, sort, pageNum, categoryIdByName]);

  const reload = useCallback(() => {
    setLoadingTxns(true);
    setLoadError(null);
    return fetchTransactionsPage(accountId, buildParams())
      .then(setPage)
      .catch(err => { console.error('fetch transactions:', err); setLoadError(err.message ?? 'Failed to load'); })
      .finally(() => setLoadingTxns(false));
  }, [accountId, buildParams]);

  // Debounce only the search field; other changes fire immediately.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { reload(); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [reload]);

  // Reset to page 1 when account changes.
  useEffect(() => { setPageNum(1); setSelected(new Set()); setFilter({ payee: '', category: '', from: '', to: '' }); }, [accountId]);

  const upcoming = AppData.scheduled.filter(s => s.account === account.id && !dismissedSched.has(s.id));

  const enterScheduled = (s: typeof AppData.scheduled[0]) => {
    setDismissedSched(d => new Set(d).add(s.id));
    toast.info('Scheduled entry handling is not yet wired to the API');
  };
  const skipScheduled = (id: string) => setDismissedSched(d => new Set(d).add(id));

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const handleSort = (col: string) => {
    // map UI column -> server sort key
    const key = col === 'outflow' || col === 'inflow' ? 'amount' : col;
    setSort(prev => {
      const asc = key + '_asc', desc = key + '_desc';
      return prev === desc ? asc : desc;
    });
    setPageNum(1);
  };
  // current sort column/dir for the SortIcon
  const sortCol = (() => { const k = sort.replace(/_(asc|desc)$/, ''); return k === 'amount' ? 'outflow' : k; })();
  const sortDir = sort.endsWith('_asc') ? 'asc' : 'desc';

  const handleSave = (updated: Transaction) => {
    const amount = updated.inflow > 0 ? updated.inflow : -updated.outflow;
    const category_id = updated.category ? (categoryIdByName[updated.category] ?? undefined) : undefined;
    updateTransaction(updated.id, {
      date: updated.date, payee: updated.payee, category_id, amount,
      memo: updated.memo, cleared: updated.cleared,
    })
      .then(() => { toast.success('Transaction updated'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('save transaction failed:', err); toast.error('Save failed: ' + err.message); reload(); });
  };

  const handleAddTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddSaving(true);
    const amount = parseFloat(addForm.inflow) > 0 ? parseFloat(addForm.inflow) : -(parseFloat(addForm.outflow) || 0);
    const category_id = addForm.category ? (categoryIdByName[addForm.category] ?? undefined) : undefined;
    try {
      await createTransaction(accountId, {
        date: addForm.date, payee: addForm.payee, category_id, amount,
        memo: addForm.memo, cleared: addForm.cleared,
      });
      setShowAddTxn(false);
      setAddForm({ date: new Date().toISOString().slice(0, 10), payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false });
      toast.success('Transaction added');
      onAccountsChanged();
      reload();
    } catch (err) {
      console.error('create transaction failed:', err);
      toast.error('Add failed: ' + (err as Error).message);
    } finally {
      setAddSaving(false);
    }
  };
```

- [ ] **Step 3: Add the React import for useRef/useCallback**

Change line 1 from:
```tsx
import { useState, useMemo, useEffect } from 'react';
```
to:
```tsx
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
```

- [ ] **Step 4: Update the cleared toggle to persist**

Find the `EditableRow` usage and the old local `toggleCleared` (deleted in Step 2). Add a persisting version near `handleSave`:

```tsx
  const toggleCleared = (t: Transaction) => {
    const amount = t.inflow > 0 ? t.inflow : -t.outflow;
    const category_id = t.category ? (categoryIdByName[t.category] ?? undefined) : undefined;
    // optimistic
    setPage(p => p ? { ...p, transactions: p.transactions.map(x => x.id === t.id ? { ...x, cleared: !x.cleared } : x) } : p);
    updateTransaction(t.id, { date: t.date, payee: t.payee, category_id, amount, memo: t.memo, cleared: !t.cleared })
      .then(() => { onAccountsChanged(); reload(); })
      .catch(err => { console.error('toggle cleared failed:', err); toast.error('Could not update cleared status'); reload(); });
  };
```

In the `EditableRow` props interface, change `onToggleCleared: (id: string) => void;` to `onToggleCleared: (t: Transaction) => void;`, and inside `EditableRow` change the cleared-dot `onClick` from `onToggleCleared(t.id)` to `onToggleCleared(t)`.

- [ ] **Step 5: Remove now-dead saveSplit/reconcile local mutations and rewire**

The old `saveSplit` and `reconcile` mutated local `setTxns` which no longer exists. Replace both with toast-and-reload stubs (split/reconcile persistence is out of scope for this plan):

```tsx
  const saveSplit = () => { setModal(null); toast.info('Split persistence is not yet wired to the API'); };
  const reconcile = () => { setModal(null); toast.info('Reconcile persistence is not yet wired to the API'); };
```

Update the `SplitModal` `onSave` prop usage at the modal render to `onSave={saveSplit}` (it will ignore args) and `ReconcileModal` `onReconcile={reconcile}`.

- [ ] **Step 6: Replace the stat strip, filter bar, table body, and add pagination**

Replace the `totals`-based stat strip (currently lines ~268-272) with a summary-based one:

```tsx
      <div style={st.statRow}>
        <div style={st.stat}><span style={st.statNum}>{page?.pagination.total ?? 0}</span><span style={st.statLbl}>transactions</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.textMid }}>−{fmt(page?.summary.total_outflow ?? 0)}</span><span style={st.statLbl}>outflow</span></div>
        <div style={st.stat}><span style={{ ...st.statNum, color: T.pos }}>+{fmt(page?.summary.total_inflow ?? 0)}</span><span style={st.statLbl}>inflow</span></div>
      </div>
```

In the filter bar, update the search input and category select handlers to reset the page:
- search input `onChange`: `e => { setFilter(f => ({ ...f, payee: e.target.value })); setPageNum(1); }`
- category select `onChange`: `e => { setFilter(f => ({ ...f, category: e.target.value })); setPageNum(1); }`
- from input `onChange`: `e => { setFilter(f => ({ ...f, from: e.target.value })); setPageNum(1); }`
- to input `onChange`: `e => { setFilter(f => ({ ...f, to: e.target.value })); setPageNum(1); }`
- Clear button `onClick`: `() => { setFilter({ payee: '', category: '', from: '', to: '' }); setPageNum(1); }`

Add an "Uncategorized" option to the category `<select>` right after the "All categories" option:
```tsx
          <option value="__uncategorized__">Uncategorized</option>
```

Replace the table body rows reference: the table currently maps over `filtered`. Change the empty-state row's `colSpan` checks and the map to use `txns` directly (server already filtered/sorted):
```tsx
            {!loadingTxns && txns.length === 0 && <tr><td colSpan={9} style={{ padding: 40, textAlign: 'center', color: T.textDim, fontSize: 13 }}>{hasFilter ? 'No transactions match your filters' : 'No transactions yet'}</td></tr>}
            {txns.map(t => <EditableRow key={t.id} t={t} categories={categories} catColor={catColor} onSave={handleSave} onToggleSelect={toggleSelect} selected={selected.has(t.id)} fmt={fmt} rowPad={rowPad} onSplit={tx => setModal({ split: tx })} onToggleCleared={toggleCleared} />)}
```

Update `toggleAll` and the header checkbox to use `txns` instead of `filtered`:
```tsx
  const toggleAll = () => setSelected(s => s.size === txns.length ? new Set() : new Set(txns.map(t => t.id)));
```
and the header checkbox `checked={selected.size === txns.length && txns.length > 0}`.

Add pagination controls immediately after the closing `</div>` of `st.tableWrap`:
```tsx
      {page && page.pagination.total_pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 12.5, color: T.textDim }}>
          <span>Showing page {page.pagination.page} of {page.pagination.total_pages} · {page.pagination.total} total</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={pageNum <= 1} onClick={() => setPageNum(n => Math.max(1, n - 1))} style={{ ...st.clearBtn, opacity: pageNum <= 1 ? 0.4 : 1 }}>◀ Prev</button>
            <button disabled={pageNum >= page.pagination.total_pages} onClick={() => setPageNum(n => n + 1)} style={{ ...st.clearBtn, opacity: pageNum >= page.pagination.total_pages ? 0.4 : 1 }}>Next ▶</button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors ONLY about the still-present old bulk-delete button referencing `setTxns` (fixed in Task 8) — if so, proceed; otherwise must be clean. To keep this task self-contained, temporarily leave the existing bulk-delete button as-is; it is replaced in Task 8.

> If `tsc` reports `setTxns` / `filtered` not defined from the leftover bulk-delete button, that is expected and resolved in Task 8. Do not commit a broken build — proceed directly to Task 8 before committing, OR comment out the old bulk-delete `<button>` block (lines ~291-308) now and commit. Prefer commenting it out:

Replace the old `{selected.size > 0 && (<button ...>Delete {selected.size}</button>)}` block in the filter bar with nothing for now (the bulk bar in Task 8 replaces it).

- [ ] **Step 8: Type-check again, then commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: server-driven Accounts data flow with pagination + summary"
```

---

## Task 8: Accounts.tsx — bulk action bar, confirmations, single-delete, states

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add bulk action handlers**

Add near `handleSave` in `Accounts.tsx`:

```tsx
  const [bulkCat, setBulkCat] = useState('');
  const runBatch = (action: 'categorize' | 'clear' | 'unclear' | 'delete', categoryName?: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const categoryId = action === 'categorize'
      ? (categoryName ? (categoryIdByName[categoryName] ?? '') : '')
      : undefined;
    batchTransactions(ids, action, categoryId)
      .then(r => {
        setSelected(new Set());
        toast.success(`${r.affected} transaction${r.affected === 1 ? '' : 's'} updated`);
        onAccountsChanged();
        reload();
      })
      .catch(err => { console.error('batch failed:', err); toast.error('Bulk action failed: ' + err.message); });
  };
  const confirmBulkDelete = () => {
    if (window.confirm(`Delete ${selected.size} transaction(s)? This cannot be undone.`)) runBatch('delete');
  };

  const handleSingleDelete = (id: string) => {
    if (!window.confirm('Delete this transaction? This cannot be undone.')) return;
    deleteTransaction(id)
      .then(() => { toast.success('Transaction deleted'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('delete failed:', err); toast.error('Delete failed: ' + err.message); });
  };
```

- [ ] **Step 2: Render the bulk action bar**

Add immediately after the filter bar `</div>` (before the `{loadingTxns && (...)}` block):

```tsx
      {selected.size > 0 && (
        <div style={st.bulkBar}>
          <span style={{ fontWeight: 700, color: T.text }}>{selected.size} selected</span>
          <select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={st.filterSelect}>
            <option value="">Set category…</option>
            <option value="__uncategorized__">— Uncategorized —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => runBatch('categorize', bulkCat === '__uncategorized__' ? '' : (bulkCat || undefined))}
            disabled={bulkCat === ''}
            style={{ ...st.headerBtn, opacity: bulkCat === '' ? 0.4 : 1 }}
          >Apply</button>
          <button onClick={() => runBatch('clear')} style={st.headerBtn}>Clear</button>
          <button onClick={() => runBatch('unclear')} style={st.headerBtn}>Unclear</button>
          <button onClick={confirmBulkDelete} style={{ ...st.clearBtn, color: T.neg, borderColor: T.negDim, background: T.negDim, marginLeft: 'auto' }}>Delete {selected.size}</button>
        </div>
      )}
```

Note: `runBatch('categorize', '')` with the uncategorized choice sends `category_id=''`, which uncategorizes server-side.

- [ ] **Step 3: Wire single-row delete into the row actions**

In `EditableRow`, the last `<td>` currently holds only the split button. Add a delete button beside it. First add `onDelete: (id: string) => void;` to `EditableRowProps`, then in the non-editing row's last action `<td>`:

```tsx
      <td style={{ ...st.td, padding: rowPad + ' 8px', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
        <button onClick={() => onSplit(t)} style={st.splitBtn} title="Split">⑂</button>
        <button onClick={() => onDelete(t.id)} style={{ ...st.splitBtn, marginLeft: 5, color: T.neg }} title="Delete">✕</button>
      </td>
```

Pass `onDelete={handleSingleDelete}` where `<EditableRow ... />` is rendered.

- [ ] **Step 4: Add the loading/error states and bulk bar style**

Replace the existing `{loadingTxns && (...)}` block with both loading and error handling:

```tsx
      {loadingTxns && (
        <div style={{ padding: '20px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading transactions…</div>
      )}
      {loadError && !loadingTxns && (
        <div style={{ padding: '16px 20px', textAlign: 'center', color: T.neg, fontSize: 13, background: T.negDim, border: `1px solid ${T.negDim}`, borderRadius: T.radius, marginBottom: 12 }}>
          {loadError} · <button onClick={() => reload()} style={{ ...st.clearBtn, color: T.neg, marginLeft: 6 }}>Retry</button>
        </div>
      )}
```

Add to the `st` style object (before the closing `};`):
```tsx
  bulkBar:         { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', marginBottom: 12, background: T.accentDim, border: `1px solid var(--accent)`, borderRadius: T.radius },
```

- [ ] **Step 5: Type-check and build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: bulk actions, confirmations, toasts, loading/error states in Accounts"
```

---

## Task 9: Full verification

- [ ] **Step 1: Backend build + tests**

Run: `cd server && go build ./... && go vet ./... && go test ./...`
Expected: build + vet clean; tests pass or SKIP (no test DB).

- [ ] **Step 2: Frontend type-check + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean type-check; production build succeeds.

- [ ] **Step 3: Manual smoke (optional, if a dev environment is running)**

With the stack running, open the Accounts page and verify: search filters by payee+memo; category dropdown (incl. Uncategorized) filters; date range filters; column-header sort toggles; pagination prev/next works; selecting rows shows the bulk bar; categorize/clear/unclear/delete apply with toasts; the cleared dot persists after reload; single-row delete confirms then removes; the stat strip totals reflect the whole filtered set.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git status
```
Expected: clean working tree.

---

## Self-Review Notes

**Spec coverage:**
- §1 list endpoint upgrade → Tasks 1, 2 ✓
- §2 batch endpoint → Tasks 3, 4 ✓
- §3 backend tests → Tasks 1, 3 ✓
- §4 api.ts additions → Task 5 ✓
- §5 ToastProvider → Task 6 ✓
- §6 Accounts.tsx rewrite (data flow, filter bar, stat strip, pagination, bulk bar, cleared toggle, single delete, states) → Tasks 7, 8 ✓

**Out of scope (Plan 2), intentionally stubbed with toasts:** split persistence, reconcile persistence, scheduled-entry creation. These previously mutated local-only state that no longer exists after the server-driven refactor; rather than silently drop them, they now show an informational toast. This keeps the UI honest until Plan 2 wires them.

**Type consistency:** `TxnFilter` (Go) ↔ `TxnFilterParams` (TS); `TxnSummary` JSON tags (`total_inflow` etc.) match the TS `TxnPage.summary` keys and the handler response. `ListByAccount` new signature `(ctx, accountID, TxnFilter) -> ([]Transaction, int64, TxnSummary, error)` is used consistently in handler + tests. `batchTransactions` action union matches the Go handler's allowed actions.
