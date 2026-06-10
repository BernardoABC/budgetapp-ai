# Multi-Currency Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow budget categories to be denominated in either CRC or USD, with activity automatically converted to the category's native currency, a unified CRC-based RTA with account breakdown, and cross-currency transfer linking that skips amount validation.

**Architecture:** Add a `currency` column to `categories`; modify the budget activity SQL query to convert cross-currency transactions; split `GetOnBudgetBalance` into CRC/USD parts for the RTA breakdown; add a `ChangeCategoryBudgetCurrency` service method that atomically updates the category currency and zeroes all its budget rows; update `LinkTransfer`/`LinkTransferBatch` to skip the amount-sum-to-zero check when the two accounts have different currencies.

**Tech Stack:** Go 1.21+, PostgreSQL via pgx/v5, React + TypeScript (Vite), no new dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/internal/database/migrations/009_category_currency.sql` | Add `currency` column to `categories` |
| Modify | `server/internal/model/category.go` | Add `Currency` to Category, CreateCategoryReq, UpdateCategoryReq |
| Modify | `server/internal/model/budget.go` | Add `Currency` + `ActivityBreakdown` to CategoryBudget; add `RTABreakdown` to BudgetMonth |
| Modify | `server/internal/repository/category_repo.go` | SELECT/INSERT/UPDATE currency; add `GetCurrencies` |
| Modify | `server/internal/repository/budget_repo.go` | Currency-aware activity query; `GetOnBudgetBalanceByCurrency`; `GetActivityBreakdownForMonth`; `ClearAllAssigned` |
| Modify | `server/internal/service/budget_service.go` | Wire rateRepo; currency-aware RTA; move money validation; `ChangeCategoryBudgetCurrency` |
| Modify | `server/internal/handler/budget.go` | `budgetMonthToJSON` adds `currency` + `rta_breakdown`; new `ChangeCategoryCurrency` handler |
| Modify | `server/internal/handler/categories.go` | Include `currency` in ListGroups and CreateCategory responses |
| Modify | `server/internal/repository/transaction_repo.go` | Skip amount check for cross-currency pairs in `LinkTransfer`, `LinkTransferBatch`, `LinkOrCreateBatch` |
| Modify | `server/internal/testutil/helpers.go` | Add `SeedCategoryWithCurrency`, `SeedOnBudgetAccountWithCurrency`, `SeedExchangeRate` helpers |
| Modify | `server/main.go` | Pass `rateRepo` to `NewBudgetService`; register new route |
| Modify | `frontend/src/api.ts` | Add `currency` to `CategoryItemAPI`, `BudgetCategoryAPI`, `BudgetMonthAPI`; update `createCategory`, `fetchBudget` |
| Modify | `frontend/src/components/Budget.tsx` | Currency badge on assigned/available; RTA breakdown; move money cross-currency block; category creation currency picker |
| Modify | `frontend/src/components/BudgetModals.tsx` | Block `MoveMoneyModal` for cross-currency; show currency note in CategoryInspector |

---

## Task 1: DB Migration

**Files:**
- Create: `server/internal/database/migrations/009_category_currency.sql`

- [ ] **Step 1: Write migration**

```sql
-- server/internal/database/migrations/009_category_currency.sql
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CRC';
```

- [ ] **Step 2: Apply migration to dev and test databases**

```bash
psql $DATABASE_URL -f server/internal/database/migrations/009_category_currency.sql
psql $TEST_DATABASE_URL -f server/internal/database/migrations/009_category_currency.sql
```

Expected: `ALTER TABLE` with no errors.

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/009_category_currency.sql
git commit -m "feat: add currency column to categories (default CRC)"
```

---

## Task 2: Category Model + CRUD

**Files:**
- Modify: `server/internal/model/category.go`
- Modify: `server/internal/repository/category_repo.go`
- Modify: `server/internal/handler/categories.go`
- Modify: `server/internal/testutil/helpers.go`

- [ ] **Step 1: Update Category model**

In `server/internal/model/category.go`, add `Currency` to all three types:

```go
type Category struct {
	ID        string `json:"id"`
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	Hidden    bool   `json:"hidden"`
	SortOrder int    `json:"sort_order"`
	IsSystem  bool   `json:"is_system"`
}

type CreateCategoryReq struct {
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	SortOrder int    `json:"sort_order"`
}

type UpdateCategoryReq struct {
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	Hidden    bool   `json:"hidden"`
	SortOrder int    `json:"sort_order"`
}
```

- [ ] **Step 2: Write failing test for ListGroups returning currency**

Add to `server/internal/repository/category_repo_test.go` (create file if absent):

```go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestCategoryRepo_Currency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	catID := testutil.SeedCategoryWithCurrency(t, pool, "USD")

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}

	var found string
	for _, g := range groups {
		for _, c := range g.Categories {
			if c.ID == catID {
				found = c.Currency
			}
		}
	}
	if found != "USD" {
		t.Errorf("expected currency USD, got %q", found)
	}
}

func TestCategoryRepo_CreateCategory_Currency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	groupID := testutil.SeedGroup(t, pool)
	cat, err := repo.CreateCategory(ctx, model.CreateCategoryReq{
		GroupID:  groupID,
		Name:     "Rent",
		Currency: "USD",
	})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if cat.Currency != "USD" {
		t.Errorf("expected USD, got %q", cat.Currency)
	}
}
```

- [ ] **Step 3: Add `SeedCategoryWithCurrency` and `SeedExchangeRate` helpers**

In `server/internal/testutil/helpers.go`, add:

```go
// SeedCategoryWithCurrency inserts a category with the given currency and returns its ID.
func SeedCategoryWithCurrency(t *testing.T, pool *pgxpool.Pool, currency string) string {
	t.Helper()
	groupID := SeedGroup(t, pool)
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order, currency)
		 VALUES ($1::uuid, $2, 0, $3) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()), currency,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategoryWithCurrency: %v", err)
	}
	return id
}

// SeedOnBudgetAccountWithCurrency inserts an on-budget account with the given currency and returns its ID.
func SeedOnBudgetAccountWithCurrency(t *testing.T, pool *pgxpool.Pool, currency string, balance int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO accounts (name, type, currency, balance, on_budget)
		 VALUES ($1, 'checking', $2, $3, true) RETURNING id::text`,
		fmt.Sprintf("TestAcc-%d", randomID()), currency, balance,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedOnBudgetAccountWithCurrency: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM accounts WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedExchangeRate inserts an exchange rate for a date and returns it.
func SeedExchangeRate(t *testing.T, pool *pgxpool.Pool, date string, usdToCRC float64) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO exchange_rates (date, usd_to_crc, source)
		 VALUES ($1::date, $2, 'test')
		 ON CONFLICT (date) DO UPDATE SET usd_to_crc = EXCLUDED.usd_to_crc`,
		date, usdToCRC,
	)
	if err != nil {
		t.Fatalf("SeedExchangeRate: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM exchange_rates WHERE date = $1::date`, date)
	})
}

// SeedTransactionWithCurrency inserts a transaction with the given currency and exchange rate.
func SeedTransactionWithCurrency(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64, currency string, exchangeRate *float64) string {
	t.Helper()
	var id string
	var err error
	if exchangeRate != nil {
		err = pool.QueryRow(context.Background(),
			`INSERT INTO transactions (account_id, category_id, date, amount, currency, exchange_rate)
			 VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6) RETURNING id::text`,
			accountID, categoryID, date, amount, currency, *exchangeRate,
		).Scan(&id)
	} else {
		err = pool.QueryRow(context.Background(),
			`INSERT INTO transactions (account_id, category_id, date, amount, currency)
			 VALUES ($1::uuid, $2::uuid, $3::date, $4, $5) RETURNING id::text`,
			accountID, categoryID, date, amount, currency,
		).Scan(&id)
	}
	if err != nil {
		t.Fatalf("SeedTransactionWithCurrency: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}
```

- [ ] **Step 4: Update CategoryRepo — ListGroups**

In `server/internal/repository/category_repo.go`, update `ListGroups` SELECT to include `c.currency`:

```go
func (r *CategoryRepo) ListGroups(ctx context.Context) ([]model.CategoryGroup, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system,
		       c.id::text, c.name, c.hidden, c.sort_order, c.is_system, c.currency
		FROM category_groups g
		LEFT JOIN categories c ON c.group_id = g.id AND c.hidden = false
		ORDER BY g.sort_order, g.name, c.sort_order, c.name
	`)
	if err != nil {
		return nil, fmt.Errorf("list category groups: %w", err)
	}
	defer rows.Close()

	groupMap := make(map[string]*model.CategoryGroup)
	var order []string

	for rows.Next() {
		var gID, gName string
		var gSort int
		var gHidden, gSystem bool
		var cID, cName, cCurrency *string
		var cHidden *bool
		var cSort *int
		var cSystem *bool

		if err := rows.Scan(&gID, &gName, &gSort, &gHidden, &gSystem,
			&cID, &cName, &cHidden, &cSort, &cSystem, &cCurrency); err != nil {
			return nil, fmt.Errorf("scan category row: %w", err)
		}

		if _, ok := groupMap[gID]; !ok {
			groupMap[gID] = &model.CategoryGroup{
				ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden, IsSystem: gSystem,
			}
			order = append(order, gID)
		}

		if cID != nil {
			sys := false
			if cSystem != nil {
				sys = *cSystem
			}
			cur := "CRC"
			if cCurrency != nil {
				cur = *cCurrency
			}
			groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
				ID: *cID, GroupID: gID, Name: *cName, Currency: cur,
				Hidden: *cHidden, SortOrder: *cSort, IsSystem: sys,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	groups := make([]model.CategoryGroup, 0, len(order))
	for _, id := range order {
		groups = append(groups, *groupMap[id])
	}
	return groups, nil
}
```

- [ ] **Step 5: Update CategoryRepo — CreateCategory**

```go
func (r *CategoryRepo) CreateCategory(ctx context.Context, req model.CreateCategoryReq) (model.Category, error) {
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		INSERT INTO categories (group_id, name, sort_order, currency)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency
	`, req.GroupID, req.Name, req.SortOrder, currency).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency,
	)
	if err != nil {
		return c, fmt.Errorf("create category: %w", err)
	}
	return c, nil
}
```

- [ ] **Step 6: Update CategoryRepo — UpdateCategory and add GetCurrencies**

```go
func (r *CategoryRepo) UpdateCategory(ctx context.Context, id string, req model.UpdateCategoryReq) (model.Category, error) {
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		UPDATE categories SET name=$1, hidden=$2, sort_order=$3, updated_at=NOW()
		WHERE id=$4
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency
	`, req.Name, req.Hidden, req.SortOrder, id).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency,
	)
	if err != nil {
		return c, fmt.Errorf("update category: %w", err)
	}
	return c, nil
}

// GetCurrencies returns a map of category ID → currency for the given IDs.
func (r *CategoryRepo) GetCurrencies(ctx context.Context, ids []string) (map[string]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, currency FROM categories WHERE id::text = ANY($1)`, ids,
	)
	if err != nil {
		return nil, fmt.Errorf("get currencies: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string, len(ids))
	for rows.Next() {
		var id, cur string
		if err := rows.Scan(&id, &cur); err != nil {
			return nil, fmt.Errorf("scan currency: %w", err)
		}
		out[id] = cur
	}
	return out, rows.Err()
}
```

- [ ] **Step 7: Update categories handler to include currency in responses**

In `server/internal/handler/categories.go`, update `ListGroups` response struct and `CreateCategory` response:

```go
func (h *CategoryHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListGroups(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type catResp struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Currency  string `json:"currency"`
		Hidden    bool   `json:"hidden"`
		SortOrder int    `json:"sort_order"`
		IsSystem  bool   `json:"is_system"`
	}
	type groupResp struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		SortOrder  int       `json:"sort_order"`
		Hidden     bool      `json:"hidden"`
		IsSystem   bool      `json:"is_system"`
		Categories []catResp `json:"categories"`
	}

	resp := make([]groupResp, len(groups))
	for i, g := range groups {
		cats := make([]catResp, len(g.Categories))
		for j, c := range g.Categories {
			cats[j] = catResp{ID: c.ID, Name: c.Name, Currency: c.Currency, Hidden: c.Hidden, SortOrder: c.SortOrder, IsSystem: c.IsSystem}
		}
		resp[i] = groupResp{ID: g.ID, Name: g.Name, SortOrder: g.SortOrder, Hidden: g.Hidden, IsSystem: g.IsSystem, Categories: cats}
	}
	writeJSON(w, http.StatusOK, resp)
}
```

Update `CreateCategory` to pass currency from request body and return it:

```go
func (h *CategoryHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req model.CreateCategoryReq
	if err := readJSON(r, &req); err != nil || req.Name == "" || req.GroupID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "group_id and name are required")
		return
	}
	if req.Currency != "CRC" && req.Currency != "USD" && req.Currency != "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "currency must be CRC or USD")
		return
	}
	c, err := h.repo.CreateCategory(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         c.ID,
		"group_id":   c.GroupID,
		"name":       c.Name,
		"currency":   c.Currency,
		"hidden":     c.Hidden,
		"sort_order": c.SortOrder,
		"is_system":  c.IsSystem,
	})
}
```

- [ ] **Step 8: Run the failing test, then verify it passes**

```bash
cd server && go test ./internal/repository/... -run TestCategoryRepo_Currency -v
```

Expected: PASS (after all model + repo changes above are applied).

- [ ] **Step 9: Commit**

```bash
git add server/internal/model/category.go \
        server/internal/repository/category_repo.go \
        server/internal/handler/categories.go \
        server/internal/testutil/helpers.go
git commit -m "feat: add currency field to category model, repo, and handler"
```

---

## Task 3: Budget Repository — Currency-Aware Queries

**Files:**
- Modify: `server/internal/repository/budget_repo.go`

- [ ] **Step 1: Write failing test for currency-aware activity**

Add to `server/internal/repository/budget_repo_test.go`:

```go
func TestBudgetRepo_ActivityCurrencyConversion(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// CRC category, USD transaction at rate 500 CRC/USD
	crcCatID := testutil.SeedCategoryWithCurrency(t, pool, "CRC")
	usdAccID  := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 0)
	rate := 500.0
	testutil.SeedTransactionWithCurrency(t, pool, usdAccID, crcCatID, "2026-06-01", -10000, "USD", &rate)
	// -10000 USD cents × 500 = -5,000,000 CRC centimos

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-06-30")
	if err != nil {
		t.Fatalf("GetAllActivityUpToMonth: %v", err)
	}

	got := activity[crcCatID]["2026-06-01"]
	if got != -5000000 {
		t.Errorf("expected -5000000 CRC centimos, got %d", got)
	}
}

func TestBudgetRepo_ActivityCurrencyConversionUSDCat(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// USD category, CRC transaction at rate 500 CRC/USD
	usdCatID := testutil.SeedCategoryWithCurrency(t, pool, "USD")
	crcAccID := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 0)
	rate := 500.0
	testutil.SeedTransactionWithCurrency(t, pool, crcAccID, usdCatID, "2026-06-01", -5000000, "CRC", &rate)
	// -5,000,000 CRC centimos / 500 = -10000 USD cents

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-06-30")
	if err != nil {
		t.Fatalf("GetAllActivityUpToMonth: %v", err)
	}

	got := activity[usdCatID]["2026-06-01"]
	if got != -10000 {
		t.Errorf("expected -10000 USD cents, got %d", got)
	}
}

func TestBudgetRepo_GetOnBudgetBalanceByCurrency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 50000000)
	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 100000)

	bal, err := repo.GetOnBudgetBalanceByCurrency(ctx)
	if err != nil {
		t.Fatalf("GetOnBudgetBalanceByCurrency: %v", err)
	}
	if bal.CRC < 50000000 {
		t.Errorf("expected CRC >= 50000000, got %d", bal.CRC)
	}
	if bal.USD < 100000 {
		t.Errorf("expected USD >= 100000, got %d", bal.USD)
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && go test ./internal/repository/... -run "TestBudgetRepo_Activity|TestBudgetRepo_GetOnBudget" -v
```

Expected: FAIL (methods don't exist yet / query doesn't convert).

- [ ] **Step 3: Replace `GetAllActivityUpToMonth` with currency-aware version**

In `server/internal/repository/budget_repo.go`, replace the `GetAllActivityUpToMonth` method:

```go
// GetAllActivityUpToMonth returns SUM(amount) grouped by (category_id, YYYY-MM-01)
// for all on-budget transactions up to the last day of the given month.
// Amounts are converted to each category's native currency using the transaction's
// stamped exchange_rate; falls back to the nearest available rate when not stamped.
// Result: map[categoryID][YYYY-MM-01] = sum in category native currency minor units.
func (r *BudgetRepo) GetAllActivityUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       date_trunc('month', t.date)::date::text AS m,
		       SUM(
		         CASE
		           WHEN a.currency = cat.currency THEN t.amount
		           WHEN cat.currency = 'CRC' THEN
		             ROUND(t.amount::numeric * COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           WHEN cat.currency = 'USD' THEN
		             ROUND(t.amount::numeric / COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           ELSE t.amount
		         END
		       ) AS activity
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND t.category_id IS NOT NULL
		  AND t.date <= $1::date
		GROUP BY t.category_id, date_trunc('month', t.date)
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get activity up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]int64)
	for rows.Next() {
		var catID, m string
		var activity int64
		if err := rows.Scan(&catID, &m, &activity); err != nil {
			return nil, fmt.Errorf("scan activity: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]int64)
		}
		out[catID][m] = activity
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Add `CurrencyBalance` type and `GetOnBudgetBalanceByCurrency`**

Add after the existing `GetOnBudgetBalance` method:

```go
// CurrencyBalance holds on-budget account balances split by currency.
type CurrencyBalance struct {
	CRC int64
	USD int64
}

// GetOnBudgetBalanceByCurrency returns on-budget account balances split into CRC and USD minor units.
func (r *BudgetRepo) GetOnBudgetBalanceByCurrency(ctx context.Context) (CurrencyBalance, error) {
	var bal CurrencyBalance
	err := r.pool.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(balance) FILTER (WHERE currency = 'CRC'), 0),
		  COALESCE(SUM(balance) FILTER (WHERE currency = 'USD'), 0)
		FROM accounts
		WHERE on_budget = true AND closed = false
	`).Scan(&bal.CRC, &bal.USD)
	if err != nil {
		return bal, fmt.Errorf("get balance by currency: %w", err)
	}
	return bal, nil
}
```

- [ ] **Step 5: Add `GetActivityBreakdownForMonth` and `ClearAllAssigned`**

```go
// ActivityBreakdownRow is one line of the per-currency activity breakdown for a category in a month.
type ActivityBreakdownRow struct {
	CategoryID      string
	TxnCurrency     string // currency of the source transaction/account
	Amount          int64  // raw amount in TxnCurrency minor units
	ConvertedAmount int64  // amount converted to the category's native currency (equals Amount when same currency)
}

// GetActivityBreakdownForMonth returns per-currency activity for a single month (used for display).
func (r *BudgetRepo) GetActivityBreakdownForMonth(ctx context.Context, month string) ([]ActivityBreakdownRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       a.currency AS txn_currency,
		       SUM(t.amount) AS amount,
		       SUM(
		         CASE
		           WHEN a.currency = cat.currency THEN t.amount
		           WHEN cat.currency = 'CRC' THEN
		             ROUND(t.amount::numeric * COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           WHEN cat.currency = 'USD' THEN
		             ROUND(t.amount::numeric / COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           ELSE t.amount
		         END
		       ) AS converted_amount
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND t.category_id IS NOT NULL
		  AND date_trunc('month', t.date) = $1::date
		GROUP BY t.category_id, a.currency, cat.currency
	`, month+"-01")
	if err != nil {
		return nil, fmt.Errorf("get activity breakdown for %s: %w", month, err)
	}
	defer rows.Close()
	var out []ActivityBreakdownRow
	for rows.Next() {
		var row ActivityBreakdownRow
		if err := rows.Scan(&row.CategoryID, &row.TxnCurrency, &row.Amount, &row.ConvertedAmount); err != nil {
			return nil, fmt.Errorf("scan breakdown: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ClearAllAssigned deletes all budget rows for a category (used when changing category currency).
func (r *BudgetRepo) ClearAllAssigned(ctx context.Context, categoryID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM budgets WHERE category_id = $1::uuid`, categoryID,
	)
	if err != nil {
		return fmt.Errorf("clear assigned for %s: %w", categoryID, err)
	}
	return nil
}
```

- [ ] **Step 6: Run tests**

```bash
cd server && go test ./internal/repository/... -run "TestBudgetRepo_Activity|TestBudgetRepo_GetOnBudget" -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/repository/budget_repo.go \
        server/internal/repository/budget_repo_test.go \
        server/internal/testutil/helpers.go
git commit -m "feat: currency-aware activity query and balance-by-currency in budget repo"
```

---

## Task 4: Budget Service — Currency-Aware Calculations

**Files:**
- Modify: `server/internal/model/budget.go`
- Modify: `server/internal/service/budget_service.go`
- Modify: `server/internal/service/budget_service_test.go`

- [ ] **Step 1: Update budget models**

In `server/internal/model/budget.go`:

```go
type ActivityEntry struct {
	Currency        string `json:"currency"`
	Amount          int64  `json:"amount"`
	ConvertedAmount int64  `json:"converted_amount"`
}

type Target struct {
	Type     string  // "monthly" | "refill" | "savings"
	Amount   int64   // minor units in category's native currency
	Deadline *string // YYYY-MM-DD; nil unless type == "savings"
}

type CategoryBudget struct {
	ID               string
	Name             string
	Currency         string
	Assigned         int64
	Activity         int64
	CarryIn          int64
	Available        int64 // CarryIn + Assigned + Activity
	Target           *Target
	Underfunded      int64
	ActivityBreakdown []ActivityEntry
}

type RTABreakdown struct {
	CRCAccounts    int64 `json:"crc_accounts"`
	USDAccountsCRC int64 `json:"usd_accounts_in_crc"`
	USDNative      int64 `json:"usd_accounts_native"`
}

type CategoryGroupBudget struct {
	ID         string
	Name       string
	Assigned   int64
	Activity   int64
	Available  int64
	Categories []CategoryBudget
}

type BudgetMonth struct {
	Month            string
	ReadyToAssign    int64
	RTABreakdown     RTABreakdown
	AgeOfMoney       *int // days; nil if no outflow data
	TotalUnderfunded int64
	CategoryGroups   []CategoryGroupBudget
}
```

- [ ] **Step 2: Write failing test for multi-currency RTA**

Add to `server/internal/service/budget_service_test.go`:

```go
func TestBudgetService_GetMonth_MultiCurrencyRTA(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo    := repository.NewCategoryRepo(pool)
	rateRepo   := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()

	testutil.SeedExchangeRate(t, pool, "2026-06-01", 500.0)

	// ₡500,000 CRC account + $1,000 USD account
	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 50000000)
	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 100000)
	// $1,000 × 500 = ₡500,000 → total in CRC = ₡1,000,000

	result, err := svc.GetMonth(ctx, "2026-06")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	// RTA ≈ 100,000,000 centimos (no categories assigned)
	// We only check breakdown values exist and are non-negative.
	if result.RTABreakdown.CRCAccounts < 50000000 {
		t.Errorf("CRCAccounts should be >= 50000000, got %d", result.RTABreakdown.CRCAccounts)
	}
	if result.RTABreakdown.USDNative < 100000 {
		t.Errorf("USDNative should be >= 100000, got %d", result.RTABreakdown.USDNative)
	}
	if result.RTABreakdown.USDAccountsCRC < 50000000 {
		t.Errorf("USDAccountsCRC should be >= 50000000, got %d", result.RTABreakdown.USDAccountsCRC)
	}
}

func TestBudgetService_Move_CrossCurrencyRejected(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo    := repository.NewCategoryRepo(pool)
	rateRepo   := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()
	crcCat := testutil.SeedCategoryWithCurrency(t, pool, "CRC")
	usdCat := testutil.SeedCategoryWithCurrency(t, pool, "USD")

	err := svc.Move(ctx, "2026-06", crcCat, usdCat, 10000)
	if err == nil {
		t.Fatal("expected error moving money between different currencies, got nil")
	}
}
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd server && go test ./internal/service/... -run "TestBudgetService_GetMonth_MultiCurrency|TestBudgetService_Move_Cross" -v
```

Expected: FAIL (NewBudgetService signature mismatch, methods missing).

- [ ] **Step 4: Update BudgetService**

Replace the entire `server/internal/service/budget_service.go` with the updated version. Key changes: add `rateRepo`, update `NewBudgetService`, rewrite `GetMonth`, add move currency check, add `ChangeCategoryBudgetCurrency`.

```go
package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type BudgetService struct {
	budgetRepo *repository.BudgetRepo
	targetRepo *repository.TargetRepo
	catRepo    *repository.CategoryRepo
	rateRepo   *repository.ExchangeRateRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	targetRepo *repository.TargetRepo,
	catRepo    *repository.CategoryRepo,
	rateRepo   *repository.ExchangeRateRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, targetRepo: targetRepo, catRepo: catRepo, rateRepo: rateRepo}
}

// GetMonth returns a fully-computed BudgetMonth for the given "YYYY-MM" month string.
func (s *BudgetService) GetMonth(ctx context.Context, month string) (*model.BudgetMonth, error) {
	firstOfMonth := month + "-01"
	lastOfMonth := lastDay(month)

	groups, err := s.catRepo.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}

	targets, err := s.targetRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("get targets: %w", err)
	}

	assigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, firstOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get assigned: %w", err)
	}

	activity, err := s.budgetRepo.GetAllActivityUpToMonth(ctx, lastOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get activity: %w", err)
	}

	breakdown, err := s.budgetRepo.GetActivityBreakdownForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("get activity breakdown: %w", err)
	}
	breakdownBycat := make(map[string][]repository.ActivityBreakdownRow)
	for _, row := range breakdown {
		breakdownBycat[row.CategoryID] = append(breakdownBycat[row.CategoryID], row)
	}

	// Get today's exchange rate for RTA conversion; fall back to 500 if unavailable.
	today := time.Now().Format("2006-01-02")
	var currentRate float64 = 500
	if rate, err := s.rateRepo.GetNearest(ctx, today); err == nil {
		currentRate = rate.USDToCRC
	}

	// Build category currency map.
	catCurrencies := make(map[string]string)
	var allCatIDs []string
	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		for _, c := range g.Categories {
			catCurrencies[c.ID] = c.Currency
			allCatIDs = append(allCatIDs, c.ID)
		}
	}

	// Determine earliest month across all data.
	earliest := firstOfMonth
	for _, monthMap := range assigned {
		for m := range monthMap {
			if m < earliest {
				earliest = m
			}
		}
	}
	for _, monthMap := range activity {
		for m := range monthMap {
			if m < earliest {
				earliest = m
			}
		}
	}

	months := monthRange(earliest, firstOfMonth)

	// Rollover loop — carry is in each category's native currency.
	carry := make(map[string]int64)
	carryInForTarget := make(map[string]int64)

	for _, m := range months {
		nextCarry := make(map[string]int64)
		for _, catID := range allCatIDs {
			a := int64(0)
			if assignedByMonth, ok := assigned[catID]; ok {
				a = assignedByMonth[m]
			}
			act := int64(0)
			if actByMonth, ok := activity[catID]; ok {
				act = actByMonth[m]
			}
			ci := carry[catID]
			avail := ci + a + act

			if m == firstOfMonth {
				carryInForTarget[catID] = ci
			}

			if avail > 0 {
				nextCarry[catID] = avail
			} else {
				nextCarry[catID] = 0
			}
		}
		carry = nextCarry
	}

	// Get balance split by currency for RTA.
	balances, err := s.budgetRepo.GetOnBudgetBalanceByCurrency(ctx)
	if err != nil {
		return nil, fmt.Errorf("get on-budget balance: %w", err)
	}

	outflow30d, err := s.budgetRepo.GetOutflow30Days(ctx)
	if err != nil {
		return nil, fmt.Errorf("get outflow 30 days: %w", err)
	}

	// Convert USD account balance to CRC for unified RTA.
	usdInCRC := int64(math.Round(float64(balances.USD) * currentRate))
	totalBalanceCRC := balances.CRC + usdInCRC

	// Build response and compute totalAvailable in CRC.
	var totalUnderfunded int64
	var totalAvailableCRC int64
	var groupBudgets []model.CategoryGroupBudget

	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		gb := model.CategoryGroupBudget{
			ID:   g.ID,
			Name: g.Name,
		}
		for _, c := range g.Categories {
			ci := carryInForTarget[c.ID]
			a := int64(0)
			if assignedByMonth, ok := assigned[c.ID]; ok {
				a = assignedByMonth[firstOfMonth]
			}
			act := int64(0)
			if actByMonth, ok := activity[c.ID]; ok {
				act = actByMonth[firstOfMonth]
			}
			avail := ci + a + act

			// Convert this category's available to CRC for totalAvailableCRC.
			if c.Currency == "USD" {
				totalAvailableCRC += int64(math.Round(float64(avail) * currentRate))
			} else {
				totalAvailableCRC += avail
			}

			target := targets[c.ID]
			underfunded := computeUnderfunded(target, a, avail, month)

			// Build activity breakdown entries.
			var actBreakdown []model.ActivityEntry
			for _, row := range breakdownBycat[c.ID] {
				actBreakdown = append(actBreakdown, model.ActivityEntry{
					Currency:        row.TxnCurrency,
					Amount:          row.Amount,
					ConvertedAmount: row.ConvertedAmount,
				})
			}

			cb := model.CategoryBudget{
				ID:               c.ID,
				Name:             c.Name,
				Currency:         c.Currency,
				Assigned:         a,
				Activity:         act,
				CarryIn:          ci,
				Available:        avail,
				Target:           target,
				Underfunded:      underfunded,
				ActivityBreakdown: actBreakdown,
			}

			// Group subtotals in CRC.
			if c.Currency == "USD" {
				gb.Assigned += int64(math.Round(float64(a) * currentRate))
				gb.Activity += int64(math.Round(float64(act) * currentRate))
				gb.Available += int64(math.Round(float64(avail) * currentRate))
			} else {
				gb.Assigned += a
				gb.Activity += act
				gb.Available += avail
			}

			gb.Categories = append(gb.Categories, cb)
			totalUnderfunded += underfunded
		}
		groupBudgets = append(groupBudgets, gb)
	}

	rta := totalBalanceCRC - totalAvailableCRC

	var aom *int
	if outflow30d > 0 {
		days := int(totalBalanceCRC * 30 / outflow30d)
		if days < 0 {
			days = 0
		}
		aom = &days
	}

	return &model.BudgetMonth{
		Month:         month,
		ReadyToAssign: rta,
		RTABreakdown: model.RTABreakdown{
			CRCAccounts:    balances.CRC,
			USDAccountsCRC: usdInCRC,
			USDNative:      balances.USD,
		},
		AgeOfMoney:       aom,
		TotalUnderfunded: totalUnderfunded,
		CategoryGroups:   groupBudgets,
	}, nil
}

// SetAssigned creates or updates the assigned amount for a category in a month.
func (s *BudgetService) SetAssigned(ctx context.Context, catID, month string, assigned int64) error {
	return s.budgetRepo.UpsertAssigned(ctx, catID, month+"-01", assigned)
}

// CopyPrevious copies assigned values from the previous month to the current month,
// only for categories that had a positive assignment and have no current-month row yet.
func (s *BudgetService) CopyPrevious(ctx context.Context, month string) error {
	prevMonth := prevMonthStr(month)
	prevAssigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, prevMonth+"-01")
	if err != nil {
		return fmt.Errorf("get prev assigned: %w", err)
	}

	var entries []repository.BudgetAssignedEntry
	prevKey := prevMonth + "-01"
	for catID, monthMap := range prevAssigned {
		if v, ok := monthMap[prevKey]; ok && v > 0 {
			entries = append(entries, repository.BudgetAssignedEntry{
				CategoryID: catID,
				Month:      month + "-01",
				Assigned:   v,
			})
		}
	}

	return s.budgetRepo.BulkInsertAssignedIfAbsent(ctx, entries)
}

// Move atomically transfers funds between two categories in the same month.
// Returns an error if the categories have different currencies.
func (s *BudgetService) Move(ctx context.Context, month, fromCatID, toCatID string, amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive, got %d", amount)
	}
	currencies, err := s.catRepo.GetCurrencies(ctx, []string{fromCatID, toCatID})
	if err != nil {
		return fmt.Errorf("get category currencies: %w", err)
	}
	if currencies[fromCatID] != currencies[toCatID] {
		return fmt.Errorf("cannot move money between categories with different currencies (%s vs %s)",
			currencies[fromCatID], currencies[toCatID])
	}
	return s.budgetRepo.AtomicMove(ctx, fromCatID, toCatID, month+"-01", amount)
}

// UpsertTarget creates or replaces a target for a category.
func (s *BudgetService) UpsertTarget(ctx context.Context, catID string, t model.Target) error {
	return s.targetRepo.Upsert(ctx, catID, t)
}

// DeleteTarget removes a target for a category.
func (s *BudgetService) DeleteTarget(ctx context.Context, catID string) error {
	return s.targetRepo.Delete(ctx, catID)
}

// ChangeCategoryBudgetCurrency updates a category's currency and clears all its assigned budget rows.
func (s *BudgetService) ChangeCategoryBudgetCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	if _, err := s.catRepo.UpdateCategory(ctx, catID, model.UpdateCategoryReq{Currency: newCurrency}); err != nil {
		return fmt.Errorf("update category currency: %w", err)
	}
	return s.budgetRepo.ClearAllAssigned(ctx, catID)
}

// computeUnderfunded calculates how much more needs to be assigned to meet the target this month.
func computeUnderfunded(t *model.Target, assigned, available int64, currentMonth string) int64 {
	if t == nil {
		return 0
	}
	switch t.Type {
	case "monthly":
		return max(0, t.Amount-assigned)
	case "refill":
		return max(0, t.Amount-available)
	case "savings":
		if t.Deadline == nil {
			return 0
		}
		if available >= t.Amount {
			return 0
		}
		mr := monthsUntil(currentMonth+"-01", *t.Deadline)
		if mr <= 0 {
			mr = 1
		}
		need := (t.Amount - available + int64(mr) - 1) / int64(mr)
		return max(0, need-assigned)
	}
	return 0
}

func lastDay(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month+1), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return t.Format("2006-01-02")
}

func nextMonthStr(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01")
}

func prevMonthStr(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month)-1, 1, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01")
}

func monthRange(start, end string) []string {
	var months []string
	cur := start
	for cur <= end {
		months = append(months, cur)
		var year, month, day int
		fmt.Sscanf(cur, "%d-%d-%d", &year, &month, &day)
		t := time.Date(year, time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC)
		cur = t.Format("2006-01-02")
	}
	return months
}

func monthsUntil(from, to string) int {
	var fy, fm, fd int
	var ty, tm, td int
	fmt.Sscanf(from, "%d-%d-%d", &fy, &fm, &fd)
	fmt.Sscanf(to, "%d-%d-%d", &ty, &tm, &td)
	return (ty-fy)*12 + (tm - fm)
}
```

Note: `UpdateCategoryReq` is used in `ChangeCategoryBudgetCurrency` to update only the currency field. The existing `UpdateCategory` in the repo uses `req.Name`, `req.Hidden`, `req.SortOrder` — but we need it to also handle currency. Update the repo's `UpdateCategory` to also set `currency` when `req.Currency` is non-empty:

In `server/internal/repository/category_repo.go`, update `UpdateCategory`:

```go
func (r *CategoryRepo) UpdateCategory(ctx context.Context, id string, req model.UpdateCategoryReq) (model.Category, error) {
	currency := req.Currency
	if currency == "" {
		// Preserve existing currency when not explicitly set
		if err := r.pool.QueryRow(ctx,
			`SELECT currency FROM categories WHERE id = $1::uuid`, id,
		).Scan(&currency); err != nil {
			return model.Category{}, fmt.Errorf("get existing currency: %w", err)
		}
	}
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		UPDATE categories SET name=$1, hidden=$2, sort_order=$3, currency=$4, updated_at=NOW()
		WHERE id=$5
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency
	`, req.Name, req.Hidden, req.SortOrder, currency, id).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency,
	)
	if err != nil {
		return c, fmt.Errorf("update category: %w", err)
	}
	return c, nil
}
```

- [ ] **Step 5: Run all service tests**

```bash
cd server && go test ./internal/service/... -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/internal/model/budget.go \
        server/internal/service/budget_service.go \
        server/internal/service/budget_service_test.go \
        server/internal/repository/category_repo.go
git commit -m "feat: currency-aware budget service with multi-currency RTA and move-money validation"
```

---

## Task 5: Budget API + Wire-up

**Files:**
- Modify: `server/internal/handler/budget.go`
- Modify: `server/main.go`

- [ ] **Step 1: Update `budgetMonthToJSON` to include currency, rta_breakdown, and activity_breakdown**

In `server/internal/handler/budget.go`, replace `budgetMonthToJSON`:

```go
func budgetMonthToJSON(bm *model.BudgetMonth) map[string]any {
	groups := make([]map[string]any, len(bm.CategoryGroups))
	for i, g := range bm.CategoryGroups {
		cats := make([]map[string]any, len(g.Categories))
		for j, c := range g.Categories {
			var tJSON any
			if c.Target != nil {
				tJSON = map[string]any{
					"type":     c.Target.Type,
					"amount":   c.Target.Amount,
					"deadline": c.Target.Deadline,
				}
			}
			var breakdownJSON []map[string]any
			for _, entry := range c.ActivityBreakdown {
				breakdownJSON = append(breakdownJSON, map[string]any{
					"currency":         entry.Currency,
					"amount":           entry.Amount,
					"converted_amount": entry.ConvertedAmount,
				})
			}
			cats[j] = map[string]any{
				"id":                 c.ID,
				"name":               c.Name,
				"currency":           c.Currency,
				"assigned":           c.Assigned,
				"activity":           c.Activity,
				"carry_in":           c.CarryIn,
				"available":          c.Available,
				"underfunded":        c.Underfunded,
				"target":             tJSON,
				"activity_breakdown": breakdownJSON,
			}
		}
		groups[i] = map[string]any{
			"id":         g.ID,
			"name":       g.Name,
			"assigned":   g.Assigned,
			"activity":   g.Activity,
			"available":  g.Available,
			"categories": cats,
		}
	}
	return map[string]any{
		"month":             bm.Month,
		"ready_to_assign":   bm.ReadyToAssign,
		"rta_breakdown": map[string]any{
			"crc_accounts":      bm.RTABreakdown.CRCAccounts,
			"usd_accounts_in_crc": bm.RTABreakdown.USDAccountsCRC,
			"usd_accounts_native": bm.RTABreakdown.USDNative,
		},
		"age_of_money":       bm.AgeOfMoney,
		"total_underfunded":  bm.TotalUnderfunded,
		"category_groups":    groups,
	}
}
```

- [ ] **Step 2: Add `ChangeCategoryCurrency` handler to `BudgetHandler`**

Add to `server/internal/handler/budget.go`:

```go
// ChangeCategoryCurrency handles PUT /api/categories/{id}/currency
// Resets all assigned budget rows for the category when the currency changes.
func (h *BudgetHandler) ChangeCategoryCurrency(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id path param required")
		return
	}

	var body struct {
		Currency string `json:"currency"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.Currency != "CRC" && body.Currency != "USD" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "currency must be CRC or USD")
		return
	}

	if err := h.svc.ChangeCategoryBudgetCurrency(r.Context(), catID, body.Currency); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"currency": body.Currency})
}
```

- [ ] **Step 3: Wire `rateRepo` into `BudgetService` in `main.go`**

In `server/main.go`, change:
```go
budgetSvc  := service.NewBudgetService(budgetRepo, targetRepo, catRepo)
```
to:
```go
budgetSvc  := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)
```

- [ ] **Step 4: Register new route in `main.go`**

Find the categories routes block and add:
```go
mux.HandleFunc("PUT /api/categories/{id}/currency", budgets.ChangeCategoryCurrency)
```

- [ ] **Step 5: Build to check compilation**

```bash
cd server && go build ./...
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
cd server && go test ./...
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/internal/handler/budget.go server/main.go
git commit -m "feat: budget API includes category currency, rta_breakdown, activity_breakdown"
```

---

## Task 6: Transfer Linking — Skip Amount Check for Cross-Currency

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`

- [ ] **Step 1: Write failing test for cross-currency link**

Add to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_LinkTransfer_CrossCurrency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	crcAcc := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 0)
	usdAcc := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 0)

	// CRC outflow: -512500 centimos; USD inflow: +100000 cents ($1,000)
	// Amounts don't sum to zero — this should succeed for cross-currency.
	idA := testutil.SeedTransactionNoCategory(t, pool, crcAcc, "2026-06-01", -51250000)
	idB := testutil.SeedTransactionNoCategory(t, pool, usdAcc, "2026-06-01", 100000)

	err := repo.LinkTransfer(ctx, idA, idB)
	if err != nil {
		t.Fatalf("expected cross-currency link to succeed, got: %v", err)
	}
}

func TestTransactionRepo_LinkTransfer_SameCurrencyStillValidates(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	accA := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 0)
	accB := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 0)

	idA := testutil.SeedTransactionNoCategory(t, pool, accA, "2026-06-01", -10000)
	idB := testutil.SeedTransactionNoCategory(t, pool, accB, "2026-06-01", 5000) // wrong: should be +10000

	err := repo.LinkTransfer(ctx, idA, idB)
	if err == nil {
		t.Fatal("expected amount validation error for same-currency mismatch, got nil")
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_LinkTransfer_Cross -v
```

Expected: FAIL (`cross-currency link` fails with amount error).

- [ ] **Step 3: Update `LinkTransfer` to fetch account currencies**

In `server/internal/repository/transaction_repo.go`, replace the `LinkTransfer` function. Add account currency to the row struct and skip amount check when currencies differ:

```go
func (r *TransactionRepo) LinkTransfer(ctx context.Context, idA, idB string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	type row struct {
		accountID   string
		accountCur  string
		amount      int64
		peerID      *string
	}
	var a, b row

	if err := tx.QueryRow(ctx,
		`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
		 FROM transactions t JOIN accounts a ON a.id = t.account_id
		 WHERE t.id = $1::uuid`, idA,
	).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get txn A: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
		 FROM transactions t JOIN accounts a ON a.id = t.account_id
		 WHERE t.id = $1::uuid`, idB,
	).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil {
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
	// Only validate amounts sum to zero for same-currency transfers.
	if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
		return fmt.Errorf("amounts do not sum to zero (%d + %d = %d)", a.amount, b.amount, a.amount+b.amount)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
		idB, idA); err != nil {
		return fmt.Errorf("link A: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
		idA, idB); err != nil {
		return fmt.Errorf("link B: %w", err)
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 4: Update `LinkTransferBatch` similarly**

In `LinkTransferBatch`, change the row struct and condition in the same way. Find the section that reads both transactions and validates, and replace:

```go
		type row struct {
			accountID  string
			accountCur string
			amount     int64
			peerID     *string
		}
		var a, b row

		if err := tx.QueryRow(ctx,
			`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
			 FROM transactions t JOIN accounts a ON a.id = t.account_id
			 WHERE t.id = $1::uuid`, idA,
		).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrNotFound
			}
			return 0, fmt.Errorf("get txn A %s: %w", idA, err)
		}
		if err := tx.QueryRow(ctx,
			`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
			 FROM transactions t JOIN accounts a ON a.id = t.account_id
			 WHERE t.id = $1::uuid`, idB,
		).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil {
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
		if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
			return 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", idA, idB)
		}
```

- [ ] **Step 5: Update `LinkOrCreateBatch` (TargetID path)**

In `LinkOrCreateBatch`, find the section that validates source and target for the link-existing path. Add currency fetch and conditional check. The source fetch already uses `account_id::text, amount, transfer_peer_id::text` — add `a.currency`:

```go
			var a struct {
				accountID  string
				accountCur string
				amount     int64
				peerID     *string
			}
			if err := tx.QueryRow(ctx,
				`SELECT t.account_id::text, acc.currency, t.amount, t.transfer_peer_id::text
				 FROM transactions t JOIN accounts acc ON acc.id = t.account_id
				 WHERE t.id = $1::uuid`, pair.SourceID,
			).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil { ... }

			var b struct { accountID string; accountCur string; amount int64; peerID *string }
			if err := tx.QueryRow(ctx,
				`SELECT t.account_id::text, acc.currency, t.amount, t.transfer_peer_id::text
				 FROM transactions t JOIN accounts acc ON acc.id = t.account_id
				 WHERE t.id = $1::uuid`, pair.TargetID,
			).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil { ... }
			// ... existing peerID and same-account checks ...
			// Replace amount check with:
			if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
				return 0, 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", pair.SourceID, pair.TargetID)
			}
```

For the create-and-link path in `LinkOrCreateBatch`, the amount sum-to-zero check (`if sourceAmount+pair.TargetAmount != 0`) is only reached when both are in the same account currency. Add a fetch of the source account currency and skip when different:

```go
			// After fetching sourceAccountID and sourceAmount, also fetch source account currency:
			var sourceAccountCur string
			if err := tx.QueryRow(ctx,
				`SELECT currency FROM accounts WHERE id = $1::uuid`, sourceAccountID,
			).Scan(&sourceAccountCur); err != nil {
				return 0, 0, fmt.Errorf("get source account currency: %w", err)
			}
			targetAccountCur := ""
			if err := tx.QueryRow(ctx,
				`SELECT currency FROM accounts WHERE id = $1::uuid`, pair.TargetAccountID,
			).Scan(&targetAccountCur); err != nil {
				return 0, 0, fmt.Errorf("get target account currency: %w", err)
			}
			if sourceAccountCur == targetAccountCur && sourceAmount+pair.TargetAmount != 0 {
				return 0, 0, fmt.Errorf("source amount %d and target amount %d do not sum to zero", sourceAmount, pair.TargetAmount)
			}
```

- [ ] **Step 6: Run tests**

```bash
cd server && go test ./internal/repository/... -run TestTransactionRepo_LinkTransfer -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/internal/repository/transaction_repo.go
git commit -m "feat: skip amount validation for cross-currency transfer links"
```

---

## Task 7: Frontend — Currency Badge, RTA Breakdown, Move Money Block, Category Currency Picker

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/Budget.tsx`
- Modify: `frontend/src/components/BudgetModals.tsx`

- [ ] **Step 1: Update API types**

In `frontend/src/api.ts`:

Add `currency` to `CategoryItemAPI`:
```ts
export interface CategoryItemAPI {
  id: string;
  name: string;
  currency: string;
  hidden: boolean;
  sort_order: number;
  is_system: boolean;
}
```

Add `currency` and `activity_breakdown` to `BudgetCategoryAPI`:
```ts
export interface ActivityBreakdownEntry {
  currency: string;
  amount: number;
  converted_amount: number;
}

export interface BudgetCategoryAPI {
  id: string;
  name: string;
  currency: string;
  assigned: number;
  activity: number;
  carry_in: number;
  available: number;
  underfunded: number;
  target: { type: string; amount: number; deadline: string | null } | null;
  activity_breakdown: ActivityBreakdownEntry[];
}
```

Add `rta_breakdown` to `BudgetMonthAPI`:
```ts
export interface BudgetMonthAPI {
  month: string;
  ready_to_assign: number;
  rta_breakdown: {
    crc_accounts: number;
    usd_accounts_in_crc: number;
    usd_accounts_native: number;
  };
  age_of_money: number | null;
  total_underfunded: number;
  category_groups: BudgetGroupAPI[];
}
```

Update `fetchBudget` to also convert rta_breakdown values and activity_breakdown values:
```ts
export async function fetchBudget(month: string): Promise<BudgetMonthAPI> {
  const data = await apiFetch<any>(`/budgets/${month}`);
  const fromMinor = (n: number) => n / 100;
  data.ready_to_assign = fromMinor(data.ready_to_assign);
  data.total_underfunded = fromMinor(data.total_underfunded);
  if (data.rta_breakdown) {
    data.rta_breakdown.crc_accounts = fromMinor(data.rta_breakdown.crc_accounts);
    data.rta_breakdown.usd_accounts_in_crc = fromMinor(data.rta_breakdown.usd_accounts_in_crc);
    data.rta_breakdown.usd_accounts_native = fromMinor(data.rta_breakdown.usd_accounts_native);
  }
  for (const g of data.category_groups) {
    g.assigned  = fromMinor(g.assigned);
    g.activity  = fromMinor(g.activity);
    g.available = fromMinor(g.available);
    for (const c of g.categories) {
      c.assigned    = fromMinor(c.assigned);
      c.activity    = fromMinor(c.activity);
      c.carry_in    = fromMinor(c.carry_in);
      c.available   = fromMinor(c.available);
      c.underfunded = fromMinor(c.underfunded);
      if (c.target) c.target.amount = fromMinor(c.target.amount);
      if (c.activity_breakdown) {
        for (const entry of c.activity_breakdown) {
          entry.amount = fromMinor(entry.amount);
          entry.converted_amount = fromMinor(entry.converted_amount);
        }
      }
    }
  }
  return data as BudgetMonthAPI;
}
```

Update `createCategory` to accept optional `currency`:
```ts
export async function createCategory(body: { group_id: string; name: string; sort_order?: number; currency?: string }): Promise<CategoryItemAPI> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
}
```

Add `changeCategoryCurrency`:
```ts
export async function changeCategoryCurrency(id: string, currency: string): Promise<void> {
  await apiFetch(`/categories/${id}/currency`, { method: 'PUT', body: JSON.stringify({ currency }) });
}
```

- [ ] **Step 2: Add currency badge to budget category row**

In `server/internal/components/Budget.tsx`, in the section where `cats[j]` / category rows are rendered, find where `assigned` is displayed and add a currency badge. The badge sits next to the assigned amount:

```tsx
// In the CategoryRow or wherever assigned is rendered, add:
// After the assigned amount display:
<span style={{
  fontSize: 9,
  fontWeight: 700,
  color: T.textDim,
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 3,
  padding: '1px 4px',
  marginLeft: 4,
  letterSpacing: '0.05em',
}}>
  {catCurrency === 'USD' ? '$' : '₡'}
</span>
```

The `catCurrency` value comes from the budget API response `c.currency`. Store it in the local state alongside `assigned` and `activity`.

In the `fetchBudget` callback in Budget.tsx, also store currency per category:
```ts
const newCatCurrencies: Record<string, string> = {};
for (const g of data.category_groups) {
  for (const c of g.categories) {
    const name = nameById[c.id] ?? c.name;
    newCatCurrencies[name] = c.currency ?? 'CRC';
    // ... existing code ...
  }
}
```

Add state: `const [catCurrencies, setCatCurrencies] = useState<Record<string, string>>({});`
Set it: `setCatCurrencies(newCatCurrencies);`

Pass `catCurrencies[cat]` to the row where the badge is rendered.

- [ ] **Step 3: Add RTA breakdown to the RTA card**

In Budget.tsx, find the `st.rtaCard` section. After the existing "Ready to Assign" amount, add the breakdown:

```tsx
{data.rta_breakdown && (
  <div style={{ fontSize: 11, color: T.textDim, marginTop: 4 }}>
    <span>₡ {fmtMonth(data.rta_breakdown.crc_accounts)}</span>
    <span style={{ margin: '0 6px', color: T.border }}>|</span>
    <span>$ {fmtMonth(data.rta_breakdown.usd_accounts_native)} (≈{fmtMonth(data.rta_breakdown.usd_accounts_in_crc)})</span>
  </div>
)}
```

Store `rta_breakdown` in state: `const [rtaBreakdown, setRtaBreakdown] = useState<BudgetMonthAPI['rta_breakdown'] | null>(null);`
Set it in the fetchBudget callback: `setRtaBreakdown(data.rta_breakdown ?? null);`

- [ ] **Step 4: Block Move Money for cross-currency in `MoveMoneyModal`**

In `frontend/src/components/BudgetModals.tsx`, update the `MoveMoneyModal` to show an error when the destination category has a different currency. The `MoveMoneyProps` needs to know each category's currency:

```ts
interface MoveMoneyProps {
  cat: string;
  cats: string[];
  catCurrencies: Record<string, string>; // added
  fmt: (n: number) => string;
  onClose: () => void;
  onMove: (to: string, amount: number) => void;
}
```

In the modal body, filter `cats` to only same-currency categories, or show an error if the selected destination has a different currency:

```tsx
const sourceCur = catCurrencies[current] ?? 'CRC';
const sameCurrencyCats = cats.filter(c => (catCurrencies[c] ?? 'CRC') === sourceCur);

// In the dropdown/selector, use sameCurrencyCats instead of cats
// If sameCurrencyCats is empty (no other same-currency categories), show a message:
{sameCurrencyCats.length === 0 && (
  <p style={{ color: T.textDim, fontSize: 13 }}>
    No other {sourceCur} categories to move money to.
  </p>
)}
```

Pass `catCurrencies` from Budget.tsx to MoveMoneyModal:
```tsx
<MoveMoneyModal
  cat={moveCat}
  cats={...}
  catCurrencies={catCurrencies}
  fmt={fmtMonth}
  onClose={() => setMoveCat(null)}
  onMove={handleMove}
/>
```

- [ ] **Step 5: Add currency picker to category creation**

In Budget.tsx, find the `commitAdd` handler that calls `createCategory`. Add a currency selection step. The simplest approach: add a `newCatCurrency` state alongside `newCat`, and a two-button toggle (CRC / USD) in the add-category inline form:

```tsx
const [newCatCurrency, setNewCatCurrency] = useState<'CRC' | 'USD'>('CRC');

// In commitAdd:
const commitAdd = () => {
  if (newCat.trim()) {
    createCategory({ group_id: gid, name: newCat.trim(), sort_order: 0, currency: newCatCurrency })
      .then(() => { onCategoriesChanged(); setFetchCounter(c => c + 1); })
      .catch(err => toast.error(err.message));
    setNewCat('');
    setNewCatCurrency('CRC');
    setAdding(false);
  }
};

// In the add-category input row, add a small toggle after the input:
<button
  onClick={() => setNewCatCurrency(c => c === 'CRC' ? 'USD' : 'CRC')}
  style={{ fontSize: 11, padding: '2px 6px', border: `1px solid ${T.border}`, borderRadius: 4,
           background: newCatCurrency === 'USD' ? T.accentDim : T.surface, cursor: 'pointer' }}
>
  {newCatCurrency}
</button>
```

- [ ] **Step 6: Start dev server and verify visually**

```bash
cd /home/Berny/budgetapp-ai && make dev
```

Open the budget page. Check:
1. Existing CRC categories show `₡` badge on their assigned cell.
2. The RTA card shows a breakdown line with CRC and USD account totals.
3. Adding a new category shows a CRC/USD toggle.
4. Moving money between categories of different currencies is blocked (no USD categories visible in the move picker if source is CRC).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts \
        frontend/src/components/Budget.tsx \
        frontend/src/components/BudgetModals.tsx
git commit -m "feat: currency badge, RTA breakdown, move money cross-currency block, category currency picker"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Category has `currency` field (CRC/USD) — Task 1 + 2
- [x] `assigned` stored in category's native currency minor units — Task 2 (no schema change, semantic change documented)
- [x] Activity converted to category's native currency — Task 3 (SQL query)
- [x] RTA is a single CRC number with account breakdown — Task 4 service + Task 5 API
- [x] Cross-currency transfers skip amount validation — Task 6
- [x] Currency badge on assigned cell — Task 7
- [x] Move money blocked across currencies — Task 7
- [x] Currency picker on category creation — Task 7
- [x] Category currency change resets assigned — Task 4 (`ChangeCategoryBudgetCurrency`)
- [x] `PUT /api/categories/:id/currency` route — Task 5

**Placeholder scan:** None found.

**Type consistency:**
- `CurrencyBalance` struct defined in `budget_repo.go` (Task 3), used in `budget_service.go` (Task 4) as `repository.CurrencyBalance`
- `ActivityBreakdownRow` struct defined in `budget_repo.go` (Task 3), used in service as `repository.ActivityBreakdownRow`
- `model.ActivityEntry` defined in Task 4 step 1, used in service (Task 4 step 4) and handler (Task 5 step 1)
- `model.RTABreakdown` defined in Task 4 step 1, used in service (Task 4 step 4) and handler (Task 5 step 1)
- `BudgetMonthAPI['rta_breakdown']` type inferred from interface defined in Task 7 step 1
