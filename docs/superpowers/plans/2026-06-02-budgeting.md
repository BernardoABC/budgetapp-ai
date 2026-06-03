# Budgeting Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing Budget UI to a real backend by building the budget/target storage engine, rollover algorithm, Age of Money computation, and replacing all hardcoded `AppData` references with live API calls.

**Architecture:** Approach B — server computes `carry_in` (recursive rollover), `activity` (from real transactions), `rta`, and `age_of_money` per month; the frontend engine computes `available = carry_in + assigned + activity` locally for optimistic updates. Budget data is keyed by category name on the frontend (existing pattern), with ID↔name translation at the API boundary.

**Tech Stack:** Go 1.26 / pgx v5 / PostgreSQL 18.3 backend; React 19 + TypeScript frontend. All tests run with `go test ./...` (backend) and `npm run build` (frontend type-check).

---

## File Map

**Create:**
- `server/internal/database/migrations/003_category_targets.sql`
- `server/internal/model/budget.go`
- `server/internal/repository/budget_repo.go`
- `server/internal/repository/budget_repo_test.go`
- `server/internal/repository/target_repo.go`
- `server/internal/repository/target_repo_test.go`
- `server/internal/service/budget_service.go`
- `server/internal/service/budget_service_test.go`
- `server/internal/handler/budget.go`

**Modify:**
- `server/main.go` — wire budget repo/service/handler, register routes
- `frontend/src/api.ts` — 6 new budget API functions + types
- `frontend/src/engine.ts` — remove multi-month loop, accept `openingCarryover`
- `frontend/src/components/Budget.tsx` — fetch from API, wire saves, remove AppData
- `frontend/src/data.ts` — remove `AppData.budget`, `AppData.ageOfMoney`, `AppData.targets`
- `frontend/src/App.tsx` — stop passing hardcoded `budget` prop to `<Budget>`

---

## Task 1: Database Migration

**Files:**
- Create: `server/internal/database/migrations/003_category_targets.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- server/internal/database/migrations/003_category_targets.sql
CREATE TABLE IF NOT EXISTS category_targets (
    category_id  UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    type         VARCHAR(20)  NOT NULL CHECK (type IN ('monthly', 'refill', 'savings')),
    amount       BIGINT       NOT NULL CHECK (amount >= 0),
    deadline     DATE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Restart the server and verify migration runs**

```bash
cd server && go run . 2>&1 | head -5
```

Expected output includes:
```
migration applied file=003_category_targets.sql
```

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/003_category_targets.sql
git commit -m "feat: add category_targets migration"
```

---

## Task 2: Budget Models

**Files:**
- Create: `server/internal/model/budget.go`

- [ ] **Step 1: Write the model file**

```go
// server/internal/model/budget.go
package model

type Target struct {
	Type     string  // "monthly" | "refill" | "savings"
	Amount   int64   // CRC centimos
	Deadline *string // YYYY-MM-DD (first of deadline month); nil unless type == "savings"
}

type CategoryBudget struct {
	ID          string
	Name        string
	Assigned    int64
	Activity    int64
	CarryIn     int64
	Available   int64  // CarryIn + Assigned + Activity
	Target      *Target
	Underfunded int64
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
	AgeOfMoney       *int // days; nil if no outflow data
	TotalUnderfunded int64
	CategoryGroups   []CategoryGroupBudget
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add server/internal/model/budget.go
git commit -m "feat: add budget model structs"
```

---

## Task 3: BudgetRepo

**Files:**
- Create: `server/internal/repository/budget_repo.go`
- Create: `server/internal/repository/budget_repo_test.go`

- [ ] **Step 1: Write the failing tests**

```go
// server/internal/repository/budget_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestBudgetRepo_UpsertAndGetAssigned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	if err := repo.UpsertAssigned(ctx, catID, "2026-04-01", 120000); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllAssignedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	if all[catID]["2026-04-01"] != 120000 {
		t.Errorf("want 120000 got %d", all[catID]["2026-04-01"])
	}
}

func TestBudgetRepo_GetAllActivityUpToMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	accID := testutil.SeedOnBudgetAccount(t, pool)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-10", -45000)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-15", -30000)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-05-01", -10000) // outside range

	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-04-30")
	if err != nil {
		t.Fatal(err)
	}
	if activity[catID]["2026-04-01"] != -75000 {
		t.Errorf("want -75000 got %d", activity[catID]["2026-04-01"])
	}
	if activity[catID]["2026-05-01"] != 0 {
		t.Errorf("may txn should be excluded, got %d", activity[catID]["2026-05-01"])
	}
}

func TestBudgetRepo_BulkUpsertAssigned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID1 := testutil.SeedCategory(t, pool)
	catID2 := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	entries := []repository.BudgetAssignedEntry{
		{CategoryID: catID1, Month: "2026-04-01", Assigned: 50000},
		{CategoryID: catID2, Month: "2026-04-01", Assigned: 80000},
	}
	if err := repo.BulkUpsertAssigned(ctx, entries); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllAssignedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	if all[catID1]["2026-04-01"] != 50000 || all[catID2]["2026-04-01"] != 80000 {
		t.Errorf("bulk upsert failed: got %v", all)
	}
}
```

- [ ] **Step 2: Create testutil helpers** (if they don't already exist)

Check if `server/internal/testutil/` exists:

```bash
ls server/internal/testutil/ 2>/dev/null || echo "missing"
```

If missing, create `server/internal/testutil/helpers.go`:

```go
// server/internal/testutil/helpers.go
package testutil

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("no test DB available: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

// SeedGroup inserts a category group and returns its ID.
func SeedGroup(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO category_groups (name, sort_order) VALUES ($1, 0) RETURNING id::text`,
		fmt.Sprintf("TestGroup-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedGroup: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM category_groups WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedCategory inserts a category in a new group and returns the category ID.
func SeedCategory(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	groupID := SeedGroup(t, pool)
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid, $2, 0) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategory: %v", err)
	}
	return id
}

// SeedOnBudgetAccount inserts an on-budget account and returns its ID.
func SeedOnBudgetAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO accounts (name, type, currency, balance, on_budget) VALUES ($1, 'checking', 'CRC', 0, true) RETURNING id::text`,
		fmt.Sprintf("TestAcc-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedOnBudgetAccount: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM accounts WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedTransaction inserts a transaction and returns its ID.
func SeedTransaction(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, category_id, date, amount, currency)
		 VALUES ($1::uuid, $2::uuid, $3::date, $4, 'CRC') RETURNING id::text`,
		accountID, categoryID, date, amount,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransaction: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}

var idCounter int64

func randomID() int64 {
	idCounter++
	return idCounter
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server && go test ./internal/repository/... -run TestBudgetRepo -v 2>&1 | head -20
```

Expected: FAIL with "cannot find package" or "undefined: NewBudgetRepo".

- [ ] **Step 4: Implement BudgetRepo**

```go
// server/internal/repository/budget_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type BudgetRepo struct{ pool *pgxpool.Pool }

func NewBudgetRepo(pool *pgxpool.Pool) *BudgetRepo { return &BudgetRepo{pool: pool} }

type BudgetAssignedEntry struct {
	CategoryID string
	Month      string // YYYY-MM-DD (first of month)
	Assigned   int64
}

// GetAllAssignedUpToMonth returns all budget rows up to and including the given month.
// Result: map[categoryID][YYYY-MM-01] = assigned.
func (r *BudgetRepo) GetAllAssignedUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category_id::text, month::text, assigned
		FROM budgets
		WHERE month <= $1::date
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get assigned up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]int64)
	for rows.Next() {
		var catID, m string
		var assigned int64
		if err := rows.Scan(&catID, &m, &assigned); err != nil {
			return nil, fmt.Errorf("scan assigned: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]int64)
		}
		out[catID][m] = assigned
	}
	return out, rows.Err()
}

// UpsertAssigned creates or updates the assigned amount for a category in a month.
func (r *BudgetRepo) UpsertAssigned(ctx context.Context, categoryID, month string, assigned int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO budgets (category_id, month, assigned)
		VALUES ($1::uuid, $2::date, $3)
		ON CONFLICT (category_id, month) DO UPDATE
		SET assigned   = EXCLUDED.assigned,
		    updated_at = NOW()
	`, categoryID, month, assigned)
	if err != nil {
		return fmt.Errorf("upsert assigned %s/%s: %w", categoryID, month, err)
	}
	return nil
}

// BulkUpsertAssigned upserts multiple budget rows in one call.
// Uses INSERT ... ON CONFLICT DO NOTHING — skips rows that already exist.
func (r *BudgetRepo) BulkUpsertAssigned(ctx context.Context, entries []BudgetAssignedEntry) error {
	for _, e := range entries {
		_, err := r.pool.Exec(ctx, `
			INSERT INTO budgets (category_id, month, assigned)
			VALUES ($1::uuid, $2::date, $3)
			ON CONFLICT (category_id, month) DO NOTHING
		`, e.CategoryID, e.Month, e.Assigned)
		if err != nil {
			return fmt.Errorf("bulk upsert %s/%s: %w", e.CategoryID, e.Month, err)
		}
	}
	return nil
}

// GetAllActivityUpToMonth returns SUM(amount) grouped by (category_id, YYYY-MM-01)
// for all on-budget transactions up to the last day of the given month.
// Result: map[categoryID][YYYY-MM-01] = sum.
func (r *BudgetRepo) GetAllActivityUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       date_trunc('month', t.date)::date::text AS m,
		       SUM(t.amount) AS activity
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
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

// GetOnBudgetBalance returns the sum of balances of all open on-budget accounts.
func (r *BudgetRepo) GetOnBudgetBalance(ctx context.Context) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE on_budget = true AND closed = false`,
	).Scan(&total)
	return total, err
}

// GetOutflow30Days returns the sum of absolute values of negative transactions
// on on-budget accounts within the past 30 days.
func (r *BudgetRepo) GetOutflow30Days(ctx context.Context) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(t.amount)), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		WHERE a.on_budget = true
		  AND t.amount < 0
		  AND t.date >= CURRENT_DATE - INTERVAL '30 days'
	`).Scan(&total)
	return total, err
}

// AtomicMove adjusts assigned for two categories in the same month atomically.
// from's assigned decreases by amount; to's assigned increases by amount.
func (r *BudgetRepo) AtomicMove(ctx context.Context, fromCatID, toCatID, month string, amount int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin move tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, q := range []struct {
		catID string
		delta int64
	}{
		{fromCatID, -amount},
		{toCatID, +amount},
	} {
		_, err := tx.Exec(ctx, `
			INSERT INTO budgets (category_id, month, assigned)
			VALUES ($1::uuid, $2::date, $3)
			ON CONFLICT (category_id, month) DO UPDATE
			SET assigned   = budgets.assigned + EXCLUDED.assigned,
			    updated_at = NOW()
		`, q.catID, month, q.delta)
		if err != nil {
			return fmt.Errorf("move delta for %s: %w", q.catID, err)
		}
	}
	return tx.Commit(ctx)
}
```

- [ ] **Step 5: Run tests**

```bash
cd server && go test ./internal/repository/... -run TestBudgetRepo -v
```

Expected: all 3 tests PASS. If the test DB is unavailable, they'll be skipped — that's OK.

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/budget_repo.go server/internal/repository/budget_repo_test.go server/internal/testutil/
git commit -m "feat: add BudgetRepo with assigned/activity queries"
```

---

## Task 4: TargetRepo

**Files:**
- Create: `server/internal/repository/target_repo.go`
- Create: `server/internal/repository/target_repo_test.go`

- [ ] **Step 1: Write the failing tests**

```go
// server/internal/repository/target_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestTargetRepo_UpsertAndGetAll(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	target := model.Target{Type: "monthly", Amount: 120000}
	if err := repo.Upsert(ctx, catID, target); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := all[catID]
	if !ok {
		t.Fatal("target not found")
	}
	if got.Type != "monthly" || got.Amount != 120000 {
		t.Errorf("got %+v", got)
	}
}

func TestTargetRepo_Delete(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	if err := repo.Upsert(ctx, catID, model.Target{Type: "refill", Amount: 50000}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, catID); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := all[catID]; ok {
		t.Error("target should have been deleted")
	}
}

func TestTargetRepo_UpsertUpdates(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	if err := repo.Upsert(ctx, catID, model.Target{Type: "monthly", Amount: 50000}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Upsert(ctx, catID, model.Target{Type: "refill", Amount: 200000}); err != nil {
		t.Fatal(err)
	}

	all, _ := repo.GetAll(ctx)
	if all[catID].Type != "refill" || all[catID].Amount != 200000 {
		t.Errorf("upsert should overwrite: got %+v", all[catID])
	}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server && go test ./internal/repository/... -run TestTargetRepo -v 2>&1 | head -10
```

Expected: FAIL with "undefined: NewTargetRepo".

- [ ] **Step 3: Implement TargetRepo**

```go
// server/internal/repository/target_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type TargetRepo struct{ pool *pgxpool.Pool }

func NewTargetRepo(pool *pgxpool.Pool) *TargetRepo { return &TargetRepo{pool: pool} }

// GetAll returns all category targets keyed by category_id.
func (r *TargetRepo) GetAll(ctx context.Context) (map[string]*model.Target, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT category_id::text, type, amount, deadline::text FROM category_targets`,
	)
	if err != nil {
		return nil, fmt.Errorf("list targets: %w", err)
	}
	defer rows.Close()
	out := make(map[string]*model.Target)
	for rows.Next() {
		var catID string
		var t model.Target
		if err := rows.Scan(&catID, &t.Type, &t.Amount, &t.Deadline); err != nil {
			return nil, fmt.Errorf("scan target: %w", err)
		}
		cp := t
		out[catID] = &cp
	}
	return out, rows.Err()
}

// Upsert creates or replaces the target for a category.
func (r *TargetRepo) Upsert(ctx context.Context, categoryID string, t model.Target) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO category_targets (category_id, type, amount, deadline)
		VALUES ($1::uuid, $2, $3, $4::date)
		ON CONFLICT (category_id) DO UPDATE
		SET type       = EXCLUDED.type,
		    amount     = EXCLUDED.amount,
		    deadline   = EXCLUDED.deadline,
		    updated_at = NOW()
	`, categoryID, t.Type, t.Amount, t.Deadline)
	if err != nil {
		return fmt.Errorf("upsert target %s: %w", categoryID, err)
	}
	return nil
}

// Delete removes a target for a category. No-op if no target exists.
func (r *TargetRepo) Delete(ctx context.Context, categoryID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM category_targets WHERE category_id = $1::uuid`, categoryID,
	)
	if err != nil {
		return fmt.Errorf("delete target %s: %w", categoryID, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./internal/repository/... -run TestTargetRepo -v
```

Expected: all 3 tests PASS (or SKIP if no test DB).

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/target_repo.go server/internal/repository/target_repo_test.go
git commit -m "feat: add TargetRepo (upsert/delete/getAll)"
```

---

## Task 5: BudgetService

**Files:**
- Create: `server/internal/service/budget_service.go`
- Create: `server/internal/service/budget_service_test.go`

- [ ] **Step 1: Write the failing tests**

```go
// server/internal/service/budget_service_test.go
package service_test

import (
	"context"
	"testing"
	"time"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
	"budgetapp/internal/testutil"
)

func TestBudgetService_GetMonth_Empty(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewTargetRepo(pool),
		repository.NewCategoryRepo(pool),
	)
	ctx := context.Background()

	bm, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatal(err)
	}
	if bm.Month != "2026-04" {
		t.Errorf("month: want 2026-04, got %s", bm.Month)
	}
	// no categories seeded, groups should be empty or have zero totals
	_ = bm.ReadyToAssign // just ensure no panic
}

func TestBudgetService_GetMonth_Rollover(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	catID := testutil.SeedCategory(t, pool)

	// March: assigned 100, activity -60 → available 40 → carries into April
	if err := budgetRepo.UpsertAssigned(ctx, catID, "2026-03-01", 100000); err != nil {
		t.Fatal(err)
	}
	accID := testutil.SeedOnBudgetAccount(t, pool)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-03-15", -60000)

	// April: assigned 50
	if err := budgetRepo.UpsertAssigned(ctx, catID, "2026-04-01", 50000); err != nil {
		t.Fatal(err)
	}

	svc := service.NewBudgetService(budgetRepo, repository.NewTargetRepo(pool), catRepo)
	bm, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatal(err)
	}

	// Find our category
	var found *model.CategoryBudget
	for i := range bm.CategoryGroups {
		for j := range bm.CategoryGroups[i].Categories {
			if bm.CategoryGroups[i].Categories[j].ID == catID {
				found = &bm.CategoryGroups[i].Categories[j]
			}
		}
	}
	if found == nil {
		t.Fatal("category not found in response")
	}

	if found.CarryIn != 40000 {
		t.Errorf("carry_in: want 40000, got %d", found.CarryIn)
	}
	if found.Assigned != 50000 {
		t.Errorf("assigned: want 50000, got %d", found.Assigned)
	}
	if found.Available != 90000 {
		t.Errorf("available: want 90000 (40000 carry + 50000 assigned + 0 activity), got %d", found.Available)
	}
}

func TestBudgetService_AgeOfMoney(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	accID := testutil.SeedOnBudgetAccount(t, pool)
	// Seed outflow today
	today := time.Now().Format("2006-01-02")
	testutil.SeedTransaction(t, pool, accID, "", today, -30000) // no category

	svc := service.NewBudgetService(budgetRepo, repository.NewTargetRepo(pool), repository.NewCategoryRepo(pool))
	// Manually set account balance via DB
	pool.Exec(context.Background(), `UPDATE accounts SET balance = 900000 WHERE id = $1::uuid`, accID)

	thisMonth := time.Now().Format("2006-01")
	bm, err := svc.GetMonth(context.Background(), thisMonth)
	if err != nil {
		t.Fatal(err)
	}
	if bm.AgeOfMoney == nil {
		t.Error("expected non-nil AgeOfMoney")
	}
}
```

Note: `testutil.SeedTransaction` with empty categoryID needs a small change — pass `nil` for category. Update the helper:

In `server/internal/testutil/helpers.go`, add this variant:
```go
// SeedTransactionNoCategory inserts a transaction without a category.
func SeedTransactionNoCategory(t *testing.T, pool *pgxpool.Pool, accountID, date string, amount int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accountID, date, amount,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransactionNoCategory: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}
```

Update `TestBudgetService_AgeOfMoney` to use `testutil.SeedTransactionNoCategory(t, pool, accID, today, -30000)`.

- [ ] **Step 2: Run tests to verify failure**

```bash
cd server && go test ./internal/service/... -run TestBudgetService -v 2>&1 | head -15
```

Expected: FAIL with "undefined: NewBudgetService".

- [ ] **Step 3: Implement BudgetService**

```go
// server/internal/service/budget_service.go
package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type BudgetService struct {
	budgetRepo *repository.BudgetRepo
	targetRepo *repository.TargetRepo
	catRepo    *repository.CategoryRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	targetRepo *repository.TargetRepo,
	catRepo *repository.CategoryRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, targetRepo: targetRepo, catRepo: catRepo}
}

// GetMonth returns the full budget snapshot for a month in "2026-04" format.
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

	// Collect all category IDs
	var allCatIDs []string
	for _, g := range groups {
		for _, c := range g.Categories {
			allCatIDs = append(allCatIDs, c.ID)
		}
	}

	// Determine earliest month across all data
	earliest := firstOfMonth
	for _, mMap := range assigned {
		for m := range mMap {
			if m < earliest {
				earliest = m
			}
		}
	}
	for _, mMap := range activity {
		for m := range mMap {
			if m < earliest {
				earliest = m
			}
		}
	}

	// Build sorted month list from earliest to firstOfMonth
	months := monthRange(earliest, firstOfMonth)

	// Compute rollover
	carry := make(map[string]int64) // catID → carry_in for current iteration
	carryInForTarget := make(map[string]int64) // carry_in entering the requested month

	for i, m := range months {
		isTarget := (m == firstOfMonth)
		nextCarry := make(map[string]int64, len(allCatIDs))

		for _, catID := range allCatIDs {
			a := assigned[catID][m]
			act := activity[catID][m]
			ci := carry[catID]
			avail := ci + a + act
			if isTarget {
				carryInForTarget[catID] = ci
			}
			if avail > 0 {
				nextCarry[catID] = avail
			} else {
				nextCarry[catID] = 0
			}
		}
		_ = i
		carry = nextCarry
	}

	// On-budget balance for RTA and AoM
	balance, err := s.budgetRepo.GetOnBudgetBalance(ctx)
	if err != nil {
		slog.Warn("get on-budget balance", "err", err)
	}

	outflow30d, err := s.budgetRepo.GetOutflow30Days(ctx)
	if err != nil {
		slog.Warn("get 30-day outflow", "err", err)
	}

	// Build response
	var availableSum int64
	var totalUnderfunded int64
	now := time.Now()
	nowMonth := now.Format("2006-01") + "-01"

	groupBudgets := make([]model.CategoryGroupBudget, 0, len(groups))
	for _, g := range groups {
		gb := model.CategoryGroupBudget{ID: g.ID, Name: g.Name}
		for _, c := range g.Categories {
			ci := carryInForTarget[c.ID]
			a := assigned[c.ID][firstOfMonth]
			act := activity[c.ID][firstOfMonth]
			avail := ci + a + act
			availableSum += avail

			t := targets[c.ID]
			underfunded := computeUnderfunded(t, a, avail, month, nowMonth)
			totalUnderfunded += underfunded

			cb := model.CategoryBudget{
				ID:          c.ID,
				Name:        c.Name,
				Assigned:    a,
				Activity:    act,
				CarryIn:     ci,
				Available:   avail,
				Target:      t,
				Underfunded: underfunded,
			}
			gb.Categories = append(gb.Categories, cb)
			gb.Assigned += a
			gb.Activity += act
			gb.Available += avail
		}
		groupBudgets = append(groupBudgets, gb)
	}

	rta := balance - availableSum

	var aom *int
	if outflow30d > 0 {
		days := int(float64(balance) / (float64(outflow30d) / 30.0))
		if days < 0 {
			days = 0
		}
		aom = &days
	}

	return &model.BudgetMonth{
		Month:            month,
		ReadyToAssign:    rta,
		AgeOfMoney:       aom,
		TotalUnderfunded: totalUnderfunded,
		CategoryGroups:   groupBudgets,
	}, nil
}

// SetAssigned creates or updates the assigned amount for a category in a month.
func (s *BudgetService) SetAssigned(ctx context.Context, categoryID, month string, assigned int64) error {
	return s.budgetRepo.UpsertAssigned(ctx, categoryID, month+"-01", assigned)
}

// CopyPrevious copies assigned values from the previous month into the current month.
// Uses INSERT ... ON CONFLICT DO NOTHING — existing rows are untouched.
func (s *BudgetService) CopyPrevious(ctx context.Context, month string) error {
	prevMonth := prevMonthStr(month)
	firstPrev := prevMonth + "-01"
	firstCur := month + "-01"

	prevAssigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, firstPrev)
	if err != nil {
		return err
	}

	var entries []repository.BudgetAssignedEntry
	for catID, mMap := range prevAssigned {
		if v, ok := mMap[firstPrev]; ok && v > 0 {
			entries = append(entries, repository.BudgetAssignedEntry{
				CategoryID: catID,
				Month:      firstCur,
				Assigned:   v,
			})
		}
	}
	return s.budgetRepo.BulkUpsertAssigned(ctx, entries)
}

// Move transfers amount from one category's assigned to another within a month.
func (s *BudgetService) Move(ctx context.Context, month, fromCatID, toCatID string, amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	return s.budgetRepo.AtomicMove(ctx, fromCatID, toCatID, month+"-01", amount)
}

// UpsertTarget creates or replaces a target for a category.
func (s *BudgetService) UpsertTarget(ctx context.Context, categoryID string, t model.Target) error {
	return s.targetRepo.Upsert(ctx, categoryID, t)
}

// DeleteTarget removes the target for a category.
func (s *BudgetService) DeleteTarget(ctx context.Context, categoryID string) error {
	return s.targetRepo.Delete(ctx, categoryID)
}

// computeUnderfunded returns how much is still needed to meet the target.
func computeUnderfunded(t *model.Target, assigned, available int64, currentMonth, nowMonth string) int64 {
	if t == nil {
		return 0
	}
	switch t.Type {
	case "monthly":
		if assigned >= t.Amount {
			return 0
		}
		return t.Amount - assigned
	case "refill":
		if available >= t.Amount {
			return 0
		}
		return t.Amount - available
	case "savings":
		if t.Deadline == nil {
			return 0
		}
		remaining := available
		if remaining >= t.Amount {
			return 0
		}
		mr := monthsUntil(currentMonth+"-01", *t.Deadline)
		if mr <= 0 {
			mr = 1
		}
		need := (t.Amount - remaining + int64(mr) - 1) / int64(mr) // ceiling division
		if need <= assigned {
			return 0
		}
		return need - assigned
	}
	return 0
}

// monthRange returns a sorted list of YYYY-MM-01 strings from start to end inclusive.
func monthRange(start, end string) []string {
	var months []string
	cur := start
	for cur <= end {
		months = append(months, cur)
		cur = nextMonthStr(cur[:7]) + "-01"
	}
	return months
}

func nextMonthStr(ym string) string {
	parts := strings.Split(ym, "-")
	y, m := 0, 0
	fmt.Sscanf(parts[0]+parts[1], "%4d%2d", &y, &m)
	m++
	if m > 12 {
		m = 1
		y++
	}
	return fmt.Sprintf("%04d-%02d", y, m)
}

func prevMonthStr(ym string) string {
	parts := strings.Split(ym, "-")
	y, m := 0, 0
	fmt.Sscanf(parts[0]+parts[1], "%4d%2d", &y, &m)
	m--
	if m < 1 {
		m = 12
		y--
	}
	return fmt.Sprintf("%04d-%02d", y, m)
}

func lastDay(ym string) string {
	y, m := 0, 0
	fmt.Sscanf(ym, "%4d-%2d", &y, &m)
	t := time.Date(y, time.Month(m)+1, 0, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01-02")
}

func monthsUntil(from, to string) int {
	fy, fm := 0, 0
	ty, tm := 0, 0
	fmt.Sscanf(from, "%4d-%2d", &fy, &fm)
	fmt.Sscanf(to, "%4d-%2d", &ty, &tm)
	return (ty-fy)*12 + (tm - fm)
}

func collectMonths(assigned map[string]map[string]int64, activity map[string]map[string]int64) []string {
	seen := make(map[string]bool)
	for _, mMap := range assigned {
		for m := range mMap {
			seen[m] = true
		}
	}
	for _, mMap := range activity {
		for m := range mMap {
			seen[m] = true
		}
	}
	out := make([]string, 0, len(seen))
	for m := range seen {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}
```

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./internal/service/... -run TestBudgetService -v
```

Expected: all tests PASS (or SKIP if no test DB).

- [ ] **Step 5: Verify the whole backend builds**

```bash
cd server && go build ./...
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/budget_service.go server/internal/service/budget_service_test.go server/internal/testutil/helpers.go
git commit -m "feat: add BudgetService with rollover algorithm and AoM"
```

---

## Task 6: BudgetHandler + main.go Routing

**Files:**
- Create: `server/internal/handler/budget.go`
- Modify: `server/main.go`

- [ ] **Step 1: Implement the handler**

```go
// server/internal/handler/budget.go
package handler

import (
	"errors"
	"net/http"
	"regexp"

	"budgetapp/internal/model"
	"budgetapp/internal/service"
)

var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

type BudgetHandler struct {
	svc *service.BudgetService
}

func NewBudgetHandler(svc *service.BudgetService) *BudgetHandler {
	return &BudgetHandler{svc: svc}
}

func (h *BudgetHandler) GetMonth(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	bm, err := h.svc.GetMonth(r.Context(), month)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, budgetMonthToJSON(bm))
}

func (h *BudgetHandler) SetAssigned(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	catID := r.PathValue("categoryId")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		Assigned int64 `json:"assigned"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetAssigned(r.Context(), catID, month, body.Assigned); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assigned": body.Assigned})
}

func (h *BudgetHandler) CopyPrevious(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	if err := h.svc.CopyPrevious(r.Context(), month); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *BudgetHandler) Move(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		FromCategoryID string `json:"from_category_id"`
		ToCategoryID   string `json:"to_category_id"`
		Amount         int64  `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.FromCategoryID == "" || body.ToCategoryID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "from_category_id and to_category_id required")
		return
	}
	if body.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "amount must be positive")
		return
	}
	if err := h.svc.Move(r.Context(), month, body.FromCategoryID, body.ToCategoryID, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *BudgetHandler) UpsertTarget(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	var body struct {
		Type     string  `json:"type"`
		Amount   int64   `json:"amount"`
		Deadline *string `json:"deadline"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.Type != "monthly" && body.Type != "refill" && body.Type != "savings" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "type must be monthly, refill, or savings")
		return
	}
	if body.Amount < 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "amount must be non-negative")
		return
	}
	if body.Type == "savings" && body.Deadline == nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "savings target requires deadline (YYYY-MM-DD)")
		return
	}
	t := model.Target{Type: body.Type, Amount: body.Amount, Deadline: body.Deadline}
	if err := h.svc.UpsertTarget(r.Context(), catID, t); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"type": t.Type, "amount": t.Amount, "deadline": t.Deadline,
	})
}

func (h *BudgetHandler) DeleteTarget(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if err := h.svc.DeleteTarget(r.Context(), catID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

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
			cats[j] = map[string]any{
				"id":          c.ID,
				"name":        c.Name,
				"assigned":    c.Assigned,
				"activity":    c.Activity,
				"carry_in":    c.CarryIn,
				"available":   c.Available,
				"underfunded": c.Underfunded,
				"target":      tJSON,
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
		"age_of_money":      bm.AgeOfMoney,
		"total_underfunded": bm.TotalUnderfunded,
		"category_groups":   groups,
	}
}

// budgetHandlerErrors is kept to suppress the unused import of errors if needed.
var _ = errors.New
```

- [ ] **Step 2: Wire into main.go**

Add after the `catRepo` line in the repos block:
```go
budgetRepo  := repository.NewBudgetRepo(pool)
targetRepo  := repository.NewTargetRepo(pool)
```

Add after the `importSvc` line in the services block:
```go
budgetSvc   := service.NewBudgetService(budgetRepo, targetRepo, catRepo)
```

Add after the `rates` handler line:
```go
budgets     := handler.NewBudgetHandler(budgetSvc)
```

Add to the mux registrations (after exchange rates block):
```go
// Budgets
mux.HandleFunc("GET /api/budgets/{month}", budgets.GetMonth)
mux.HandleFunc("PUT /api/budgets/{month}/categories/{categoryId}", budgets.SetAssigned)
mux.HandleFunc("POST /api/budgets/{month}/copy-previous", budgets.CopyPrevious)
mux.HandleFunc("POST /api/budgets/{month}/move", budgets.Move)

// Targets (on category routes)
mux.HandleFunc("PUT /api/categories/{id}/target", budgets.UpsertTarget)
mux.HandleFunc("DELETE /api/categories/{id}/target", budgets.DeleteTarget)
```

- [ ] **Step 3: Build and smoke-test**

```bash
cd server && go build ./...
```

Expected: no output.

Start the server and hit the endpoint:
```bash
curl -s http://localhost:8080/api/budgets/2026-06 | python3 -m json.tool | head -20
```

Expected: JSON with `month`, `ready_to_assign`, `category_groups` array.

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/budget.go server/main.go
git commit -m "feat: add budget handler and routes"
```

---

## Task 7: Frontend API Functions

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add the BudgetMonth types and API functions**

At the top of `frontend/src/api.ts`, add these interfaces after the existing ones:

```ts
export interface BudgetCategoryAPI {
  id: string;
  name: string;
  assigned: number;     // major units (÷100)
  activity: number;
  carry_in: number;
  available: number;
  underfunded: number;
  target: { type: string; amount: number; deadline: string | null } | null;
}

export interface BudgetGroupAPI {
  id: string;
  name: string;
  assigned: number;
  activity: number;
  available: number;
  categories: BudgetCategoryAPI[];
}

export interface BudgetMonthAPI {
  month: string;
  ready_to_assign: number;
  age_of_money: number | null;
  total_underfunded: number;
  category_groups: BudgetGroupAPI[];
}
```

Add these functions at the bottom of `frontend/src/api.ts`:

```ts
// ── Budget ───────────────────────────────────────────────────────────────────

function fromMinor(n: number): number { return n / 100; }

export async function fetchBudget(month: string): Promise<BudgetMonthAPI> {
  const res = await fetch(`${BASE}/budgets/${month}`);
  if (!res.ok) throw new Error(`fetchBudget ${month}: ${res.status}`);
  const data = await res.json();
  // Convert minor units → major units throughout
  data.ready_to_assign = fromMinor(data.ready_to_assign);
  data.total_underfunded = fromMinor(data.total_underfunded);
  for (const g of data.category_groups) {
    g.assigned = fromMinor(g.assigned);
    g.activity = fromMinor(g.activity);
    g.available = fromMinor(g.available);
    for (const c of g.categories) {
      c.assigned = fromMinor(c.assigned);
      c.activity = fromMinor(c.activity);
      c.carry_in = fromMinor(c.carry_in);
      c.available = fromMinor(c.available);
      c.underfunded = fromMinor(c.underfunded);
      if (c.target) c.target.amount = fromMinor(c.target.amount);
    }
  }
  return data;
}

export async function setAssigned(month: string, categoryId: string, amount: number): Promise<void> {
  const res = await fetch(`${BASE}/budgets/${month}/categories/${categoryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assigned: Math.round(amount * 100) }),
  });
  if (!res.ok) throw new Error(`setAssigned: ${res.status}`);
}

export async function copyPreviousBudget(month: string): Promise<void> {
  const res = await fetch(`${BASE}/budgets/${month}/copy-previous`, { method: 'POST' });
  if (!res.ok) throw new Error(`copyPrevious: ${res.status}`);
}

export async function moveBudgetMoney(month: string, fromId: string, toId: string, amount: number): Promise<void> {
  const res = await fetch(`${BASE}/budgets/${month}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_category_id: fromId,
      to_category_id: toId,
      amount: Math.round(amount * 100),
    }),
  });
  if (!res.ok) throw new Error(`moveBudgetMoney: ${res.status}`);
}

export async function upsertCategoryTarget(categoryId: string, target: { type: string; amount: number; deadline: string | null }): Promise<void> {
  const res = await fetch(`${BASE}/categories/${categoryId}/target`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: target.type, amount: Math.round(target.amount * 100), deadline: target.deadline }),
  });
  if (!res.ok) throw new Error(`upsertTarget: ${res.status}`);
}

export async function deleteCategoryTarget(categoryId: string): Promise<void> {
  const res = await fetch(`${BASE}/categories/${categoryId}/target`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteTarget: ${res.status}`);
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: clean build (or only pre-existing errors, none new).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add budget API functions to api.ts"
```

---

## Task 8: Budget.tsx + engine.ts Wiring

**Files:**
- Modify: `frontend/src/components/Budget.tsx`
- Modify: `frontend/src/engine.ts`

### 8a: Simplify engine.ts

The engine's `compute()` currently iterates all months to build rollover. With server-provided `carry_in`, we only need one iteration. We keep the same function signature but change how Budget.tsx calls it.

- [ ] **Step 1: No changes needed to engine.ts itself** — the engine already supports `openingCarryover`. Budget.tsx will pass `months: [currentDisplayMonth]` and `openingCarryover: carryInMap` so the loop runs exactly once. The engine does NOT need to be modified.

Verify this is correct by reading engine.ts lines 44-55 — the loop uses `carry` initialized from `data.openingCarryover ?? {}`. Passing `openingCarryover: { catName: carryIn }` and `months: [thisMonth]` will make it iterate exactly once with the server's carry values.

### 8b: Rewrite Budget.tsx data-loading section

The Budget component needs to:
1. Maintain a `currentMonth` cursor in `YYYY-MM` format
2. Fetch from the API on mount and on month change
3. Feed server data into the existing engine/local-state pattern
4. Wire saves to the API (fire-and-forget)
5. Wire targets to the API

- [ ] **Step 2: Replace the hardcoded constants at the top of Budget.tsx**

Remove these lines at the top of `Budget.tsx`:
```ts
const MONTHS = AppData.months;
const FALLBACK_COLORS = [...];
```

Replace with:
```ts
const FALLBACK_COLORS = ['#5b9dff', '#3ddc97', '#f6c45a', '#c084fc', '#ff7a85', '#38d6e8', '#fb923c', '#a78bfa'];

function toDisplayMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function prevYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function nextYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function futureMonthDisplays(fromYM: string, count = 24): string[] {
  const result: string[] = [];
  let cur = fromYM;
  for (let i = 0; i < count; i++) {
    result.push(toDisplayMonth(cur));
    cur = nextYM(cur);
  }
  return result;
}
```

- [ ] **Step 3: Update the Budget component Props interface**

The `budgetData` and `categoryIdByName` props are needed. Remove the dependency on `AppData` inside the component. The current `Props` interface:

```ts
interface Props {
  categoryGroups: CategoryGroup[];
  budgetData: Record<string, Record<string, { assigned: number; activity: number }>>;
  fmt: (n: number) => string;
  density: string;
  categoryIdByName: Record<string, string>;
  onCategoriesChanged: () => void;
}
```

Change `budgetData` type to be optional since Budget now fetches its own data:

```ts
interface Props {
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  density: string;
  categoryIdByName: Record<string, string>;
  onCategoriesChanged: () => void;
}
```

- [ ] **Step 4: Replace the state declarations and add fetch logic**

In the `Budget` function body, replace:
```ts
const [monthIdx, setMonthIdx] = useState(1);
...
const [localBudget, setLocalBudget] = useState(budgetData);
const [groups, setGroups] = useState(() => categoryGroups.map(g => ({ ...g, categories: [...g.categories] })));
const [targets, setTargets] = useState<Record<string, Target>>(() => ({ ...AppData.targets }));
```

With:
```ts
const [currentYM, setCurrentYM] = useState(() => new Date().toISOString().slice(0, 7));
const currentDisplayMonth = toDisplayMonth(currentYM);
const [localBudget, setLocalBudget] = useState<Record<string, Record<string, { assigned: number; activity: number }>>>({});
const [groups, setGroups] = useState(() => categoryGroups.map(g => ({ ...g, categories: [...g.categories] })));
const [targets, setTargets] = useState<Record<string, Target>>({});
const carryInRef = useRef<Record<string, number>>({});
const serverRtaRef = useRef<number>(0);
const serverAssignedTotalRef = useRef<number>(0);
const [aom, setAom] = useState<number | null>(null);
const [loading, setLoading] = useState(true);
```

Add `useRef` to the imports at the top of the component:
```ts
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
```

- [ ] **Step 5: Add the fetch effect**

Add this `useEffect` after the state declarations (before any `useMemo` calls):

```ts
useEffect(() => {
  setLoading(true);
  fetchBudget(currentYM).then(data => {
    const nameById: Record<string, string> = Object.fromEntries(
      Object.entries(categoryIdByName).map(([name, id]) => [id, name])
    );

    const newCarryIn: Record<string, number> = {};
    const newBudgetMonth: Record<string, { assigned: number; activity: number }> = {};
    const newTargets: Record<string, Target> = {};

    for (const g of data.category_groups) {
      for (const c of g.categories) {
        const name = nameById[c.id] ?? c.name;
        newCarryIn[name] = c.carry_in;
        newBudgetMonth[name] = { assigned: c.assigned, activity: c.activity };
        if (c.target) {
          // Convert deadline "YYYY-MM-DD" to display month "May 2026"
          let by: string | undefined;
          if (c.target.deadline) {
            const [y, m] = c.target.deadline.split('-').map(Number);
            by = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          }
          newTargets[name] = { type: c.target.type as Target['type'], amount: c.target.amount, ...(by ? { by } : {}) };
        }
      }
    }

    carryInRef.current = newCarryIn;
    serverRtaRef.current = data.ready_to_assign;
    setAom(data.age_of_money);
    setLocalBudget({ [currentDisplayMonth]: newBudgetMonth });
    setTargets(newTargets);
  }).catch(err => {
    console.error('fetchBudget failed', err);
  }).finally(() => setLoading(false));
}, [currentYM, categoryIdByName]);
```

Add `fetchBudget` to the imports from api.ts:
```ts
import { fetchBudget, setAssigned, copyPreviousBudget, moveBudgetMoney, upsertCategoryTarget, deleteCategoryTarget, createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory } from '../api';
```

- [ ] **Step 6: Update compute() call to use openingCarryover**

Find the `dataT` useMemo:
```ts
const dataT = useMemo(() => ({ ...AppData, targets, categoryGroups: groups }), [targets, groups]);
const state = useMemo(() => compute(dataT, localBudget, month, groups), [dataT, localBudget, month, groups]);
const prevState = useMemo<MonthState | null>(() => monthIdx > 0 ? compute(dataT, localBudget, MONTHS[monthIdx - 1], groups) : null, [dataT, localBudget, monthIdx, groups]);
```

Replace with:
```ts
const dataT = useMemo(() => ({
  months: [currentDisplayMonth],
  budget: {},
  openingCarryover: carryInRef.current,
  targets,
  categoryGroups: groups,
}), [currentDisplayMonth, targets, groups]);

const state = useMemo(
  () => compute(dataT, localBudget, currentDisplayMonth, groups),
  [dataT, localBudget, currentDisplayMonth, groups]
);

// Optimistic RTA: adjust for local assigned changes vs what server returned
const rta = useMemo(() => {
  const localTotal = Object.values(state.cats).reduce((s, c) => s + c.assigned, 0);
  return serverRtaRef.current - (localTotal - serverAssignedTotalRef.current);
}, [state.cats]);
```

Update the `serverAssignedTotalRef` when data loads — add to the fetch effect:
```ts
serverAssignedTotalRef.current = Object.values(newBudgetMonth).reduce((s, e) => s + e.assigned, 0);
```

- [ ] **Step 7: Update month navigation**

Replace:
```ts
const month = MONTHS[monthIdx];
const rowPad = density === 'compact' ? '6px' : '11px';
```

With:
```ts
const month = currentDisplayMonth;
const rowPad = density === 'compact' ? '6px' : '11px';
```

Replace the month navigation buttons:
```ts
<button onClick={() => setMonthIdx(i => Math.max(0, i - 1))} disabled={monthIdx === 0} ...>‹</button>
<div style={st.monthCenter}><span style={st.curMonth}>{month}</span></div>
<button onClick={() => setMonthIdx(i => Math.min(MONTHS.length - 1, i + 1))} disabled={monthIdx === MONTHS.length - 1} ...>›</button>
```

With:
```ts
<button onClick={() => setCurrentYM(prevYM)} style={st.monthBtn}>‹</button>
<div style={st.monthCenter}><span style={st.curMonth}>{month}</span></div>
<button onClick={() => setCurrentYM(nextYM)} style={st.monthBtn}>›</button>
```

Note: `prevYM` and `nextYM` are the helper functions defined earlier (they take a `ym` string). Call them as:
```ts
<button onClick={() => setCurrentYM(ym => prevYM(ym))} style={st.monthBtn}>‹</button>
<button onClick={() => setCurrentYM(ym => nextYM(ym))} style={st.monthBtn}>›</button>
```

- [ ] **Step 8: Update the RTA card to use local `rta` and `aom`**

Replace:
```ts
const rta = state.rta;
const aom = (AppData.ageOfMoney.find(a => a.month === monthAbbr(month)) ?? AppData.ageOfMoney[AppData.ageOfMoney.length - 1]).days;
```

With (the `rta` is already computed in the useMemo above; remove this line):
```ts
// rta is computed above as useMemo; aom comes from state
```

In the JSX RTA card, replace `{aom} <span ...>days</span>` with:
```ts
{aom != null ? <>{aom} <span style={{ fontSize: 11, color: T.textDim }}>days</span></> : <span style={{ color: T.textDim }}>—</span>}
```

- [ ] **Step 9: Wire handleSaveAssigned to the API**

Find `handleSaveAssigned`:
```ts
const handleSaveAssigned = useCallback((cat: string, value: number) => {
  setLocalBudget(prev => ({ ...prev, [month]: { ...prev[month], [cat]: { ...(prev[month]?.[cat] ?? {}), assigned: value } } }));
}, [month]);
```

Replace with:
```ts
const handleSaveAssigned = useCallback((cat: string, value: number) => {
  setLocalBudget(prev => ({
    ...prev,
    [currentDisplayMonth]: {
      ...prev[currentDisplayMonth],
      [cat]: { ...(prev[currentDisplayMonth]?.[cat] ?? {}), assigned: value },
    },
  }));
  const catId = categoryIdByName[cat];
  if (catId) {
    setAssigned(currentYM, catId, value).catch(err =>
      console.error('setAssigned failed', err)
    );
  }
}, [currentDisplayMonth, currentYM, categoryIdByName]);
```

- [ ] **Step 10: Wire handleMove to the API**

Find `handleMove`:
```ts
const handleMove = useCallback((fromCat: string, toCat: string, amount: number) => {
  setLocalBudget(prev => {
    const m = { ...(prev[month] ?? {}) };
    ...
  });
}, [month]);
```

Add API call after the local state update:
```ts
const handleMove = useCallback((fromCat: string, toCat: string, amount: number) => {
  const prev_snapshot = /* capture for rollback */ null;
  setLocalBudget(prev => {
    const m = { ...(prev[currentDisplayMonth] ?? {}) };
    m[fromCat] = { ...(m[fromCat] ?? {}), assigned: ((m[fromCat] ?? {}).assigned ?? 0) - amount };
    m[toCat]   = { ...(m[toCat]   ?? {}), assigned: ((m[toCat]   ?? {}).assigned ?? 0) + amount };
    return { ...prev, [currentDisplayMonth]: m };
  });
  const fromId = categoryIdByName[fromCat];
  const toId   = categoryIdByName[toCat];
  if (fromId && toId) {
    moveBudgetMoney(currentYM, fromId, toId, amount).catch(err => {
      console.error('moveBudgetMoney failed, reverting', err);
      setLocalBudget(prev => {
        const m = { ...(prev[currentDisplayMonth] ?? {}) };
        m[fromCat] = { ...(m[fromCat] ?? {}), assigned: ((m[fromCat] ?? {}).assigned ?? 0) + amount };
        m[toCat]   = { ...(m[toCat]   ?? {}), assigned: ((m[toCat]   ?? {}).assigned ?? 0) - amount };
        return { ...prev, [currentDisplayMonth]: m };
      });
    });
  }
}, [currentDisplayMonth, currentYM, categoryIdByName]);
```

- [ ] **Step 11: Wire setTarget to the API**

Find `setTarget`:
```ts
const setTarget = (cat: string, target: Target | null) => setTargets(t => { const nt = { ...t }; if (target) nt[cat] = target; else delete nt[cat]; return nt; });
```

Replace with:
```ts
const setTarget = (cat: string, target: Target | null) => {
  setTargets(t => { const nt = { ...t }; if (target) nt[cat] = target; else delete nt[cat]; return nt; });
  const catId = categoryIdByName[cat];
  if (!catId) return;
  if (target === null) {
    deleteCategoryTarget(catId).catch(err => console.error('deleteTarget failed', err));
  } else {
    // Convert display month "May 2026" → "YYYY-MM-DD"
    let deadline: string | null = null;
    if (target.type === 'savings' && target.by) {
      const d = new Date(target.by + ' 1');
      if (!isNaN(d.getTime())) {
        deadline = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      }
    }
    upsertCategoryTarget(catId, { type: target.type, amount: target.amount, deadline }).catch(err =>
      console.error('upsertTarget failed', err)
    );
  }
};
```

- [ ] **Step 12: Wire doQuickAssign for copy-previous**

The current `doQuickAssign('lastMonth')` does a local computation. Add a handler that also calls the API for the "Last month" button:

Find:
```ts
const doQuickAssign = (strategy: 'underfunded' | 'reset' | 'lastMonth') =>
  mergeAssigned(engineQuickAssign(strategy, dataT, state, prevState));
```

Replace with:
```ts
const doQuickAssign = (strategy: 'underfunded' | 'reset' | 'lastMonth') => {
  if (strategy === 'lastMonth') {
    copyPreviousBudget(currentYM)
      .then(() => {
        // Refetch to get the actual copied values from server
        setCurrentYM(ym => ym); // triggers re-fetch via useEffect dependency trick
      })
      .catch(err => console.error('copyPrevious failed', err));
    return;
  }
  mergeAssigned(engineQuickAssign(strategy, dataT, state, null));
};
```

Note: "Refetch via dependency trick" — since `setCurrentYM(ym => ym)` doesn't change the value, the useEffect won't fire. Instead, add a `fetchCounter` state:

```ts
const [fetchCounter, setFetchCounter] = useState(0);
```

Add `fetchCounter` to the useEffect dependency array and call `setFetchCounter(c => c + 1)` after copyPrevious resolves.

Update the useEffect dependency:
```ts
}, [currentYM, categoryIdByName, fetchCounter]);
```

And in the `doQuickAssign` handler:
```ts
.then(() => setFetchCounter(c => c + 1))
```

- [ ] **Step 13: Update CategoryInspector months prop**

The CategoryInspector receives `months` and `monthIdx` for the savings deadline dropdown. Replace:
```ts
months={MONTHS} monthIdx={monthIdx}
```
With:
```ts
months={futureMonthDisplays(currentYM)} monthIdx={0}
```

- [ ] **Step 14: Add loading state**

In the JSX, wrap the table section with a loading guard:
```ts
{loading ? (
  <div style={{ padding: 40, textAlign: 'center', color: T.textDim }}>Loading budget…</div>
) : (
  <div style={{ padding: '20px 28px', maxWidth: 1180, margin: '0 auto' }}>
    {/* existing table and edit bar JSX */}
  </div>
)}
```

- [ ] **Step 15: Verify frontend builds**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 16: Commit**

```bash
git add frontend/src/components/Budget.tsx frontend/src/engine.ts
git commit -m "feat: wire Budget.tsx to real API (assigned, activity, rollover, targets, AoM)"
```

---

## Task 9: data.ts and App.tsx Cleanup

**Files:**
- Modify: `frontend/src/data.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Remove AppData.budget and AppData.ageOfMoney from data.ts**

In `frontend/src/data.ts`:

1. Delete the `AppData.budget` field (the entire block from `budget: {` to the closing `} as Record<string, Record<string, BudgetEntry>>,`)

2. Delete the `AppData.ageOfMoney` field (the block from `ageOfMoney: [` to its closing `],`)

3. Delete the `AppData.targets` field (the block from `targets: {` to its closing `} as Record<string, Target>,`)

4. The `BudgetEntry` interface can stay (it's used by the engine); add `carry_in?: number` to it:
```ts
export interface BudgetEntry {
  assigned: number;
  activity: number;
  carry_in?: number;
}
```

- [ ] **Step 2: Update App.tsx to remove budget prop from Budget**

In `frontend/src/App.tsx`:

Find line:
```ts
const { budget, monthlySpending } = AppData;
```

Replace with:
```ts
const { monthlySpending } = AppData;
```

Find the Budget usage:
```ts
{page === 'budget' && <Budget categoryGroups={categoryGroups} budgetData={budget} fmt={fmtBound} density={tweaks.density} categoryIdByName={categoryIdByName} onCategoriesChanged={reloadCategories} />}
```

Replace with:
```ts
{page === 'budget' && <Budget categoryGroups={categoryGroups} fmt={fmtBound} density={tweaks.density} categoryIdByName={categoryIdByName} onCategoriesChanged={reloadCategories} />}
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: clean build, no errors about `budget` or `AppData.ageOfMoney`.

- [ ] **Step 4: Run all backend tests**

```bash
cd server && go test ./... 2>&1 | tail -10
```

Expected: all pass (or all skip if no test DB).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data.ts frontend/src/App.tsx
git commit -m "chore: remove AppData.budget/ageOfMoney/targets, wire Budget to real API"
```

---

## Final Smoke Test

- [ ] Start both server and frontend dev server
- [ ] Navigate to the Budget page — should load real data from API
- [ ] Change an assigned value — should persist (visible after page refresh)
- [ ] Navigate to next/previous month — should fetch new data, show correct rollover
- [ ] Open Category Inspector, set a monthly target, close — chip appears on row
- [ ] Click Copy Previous — previous month's values appear
- [ ] Open Move Money modal, move funds between two categories — both available values update

```bash
cd server && go run . &
cd frontend && npm run dev
```

Open http://localhost:5173, go to Budget page, verify above behaviors.
