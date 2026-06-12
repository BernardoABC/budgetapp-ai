# Spending Plan Transformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace YNAB zero-based envelope budgeting with a Monarch-style spending plan: expected-income-minus-planned forecast, opt-in per-category rollover, flex budgeting (fixed/flexible/non-monthly), and a Cash Flow page.

**Architecture:** Backend (Go) — new migration `010`, two new repos (`monthly_plans`, `app_settings`), `BudgetRepo` extended for rollover-only carry and income/spending actuals, `budget_service.go` rewritten as a plan service, targets + move-money removed, new `/api/plan/*` and `/api/settings/*` routes, reports extended with a savings-rate series. Frontend (React, no test runner — verified via `tsc -b` build + eslint) — `engine.ts` rewritten for month-scoped plan math + rollover accumulation, `Budget.tsx` redesigned into a Spending Plan page with a Category/Flex mode toggle, new `CashFlow.tsx`, Dashboard cards swapped.

**Tech Stack:** Go 1.x (net/http stdlib mux, pgx/v5), PostgreSQL, React 19 + TypeScript (Vite, inline-style components).

**Conventions:** Money is `int64` centimos everywhere in Go; frontend divides by 100 only at the API boundary. SQL lives only in `internal/repository/`. Handlers stay thin. Run backend tests with `make test-run T=<TestName>` (test DB auto-skips if absent). Build frontend with `cd frontend && npm run build`. Commit after each task.

**Spec:** `docs/superpowers/specs/2026-06-11-spending-plan-design.md`

---

## File Structure

**Backend — create:**
- `server/internal/database/migrations/010_spending_plan.sql` — schema migration + clean slate
- `server/internal/repository/monthly_plan_repo.go` — `monthly_plans` CRUD
- `server/internal/repository/monthly_plan_repo_test.go`
- `server/internal/repository/settings_repo.go` — `app_settings` KV
- `server/internal/repository/settings_repo_test.go`

**Backend — rewrite:**
- `server/internal/model/budget.go` → plan models (`PlanCategory`, `PlanGroup`, `PlanMonth`)
- `server/internal/service/budget_service.go` → plan service
- `server/internal/service/budget_service_test.go` → plan service tests
- `server/internal/handler/budget.go` → plan handler (drop targets/move)
- `server/internal/repository/budget_repo.go` → add rollover-carry + actuals queries, drop `AtomicMove`
- `server/internal/repository/category_repo.go` → `rollover` + `flexibility` on update/list
- `server/internal/model/category.go` → add fields to `Category`, `UpdateCategoryReq`, `CreateCategoryReq`
- `server/internal/handler/reports.go` → add savings-rate endpoint
- `server/main.go` → repo/service/handler wiring + routes

**Backend — delete:**
- `server/internal/repository/target_repo.go`
- `server/internal/repository/target_repo_test.go`

**Frontend — create:**
- `frontend/src/components/CashFlow.tsx`

**Frontend — rewrite:**
- `frontend/src/engine.ts`
- `frontend/src/components/Budget.tsx`
- `frontend/src/components/BudgetSummaryPane.tsx`
- `frontend/src/components/BudgetModals.tsx` (drop MoveMoney + target UI; keep category-edit inspector, add rollover/flexibility controls)
- `frontend/src/components/Dashboard.tsx`
- `frontend/src/api.ts` (budget section → plan section)
- `frontend/src/App.tsx` + `frontend/src/components/Layout.tsx` (add Cash Flow nav)

**Docs — update:** `docs/prd/00,04,06,07,08`, `README.md`, `AGENTS.md`.

---

# Phase 1 — Backend

## Task 1: Migration 010 (schema + clean slate)

**Files:**
- Create: `server/internal/database/migrations/010_spending_plan.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 010_spending_plan.sql — transform to spending-plan model.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed','flexible','non_monthly'));

CREATE TABLE IF NOT EXISTS monthly_plans (
  month           DATE PRIMARY KEY,           -- always first of month
  expected_income BIGINT NOT NULL DEFAULT 0,  -- CRC centimos
  flex_budget     BIGINT NOT NULL DEFAULT 0,  -- CRC centimos
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM budgets;                   -- clean slate (user-approved data wipe)
DROP TABLE IF EXISTS category_targets;

UPDATE categories SET name = 'Income'
WHERE is_system = true AND name = 'Inflow: Ready to Assign';
```

- [ ] **Step 2: Apply by booting the server against the dev DB**

Run: `cd server && go build ./... && DATABASE_URL="postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" timeout 8 go run . ; echo "exit:$?"`
Expected: migration log line for `010_spending_plan`, server starts (timeout kill is fine). If Postgres isn't running locally, skip and rely on Task 3+ tests to exercise the schema.

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/010_spending_plan.sql
git commit -m "feat(db): migration 010 — spending plan schema + clean slate"
```

---

## Task 2: Category model fields

**Files:**
- Modify: `server/internal/model/category.go`

- [ ] **Step 1: Add fields to the three structs**

In `Category` add after `IsSystem`:
```go
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
```
In `CreateCategoryReq` add after `SortOrder`:
```go
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
```
In `UpdateCategoryReq` add after `SortOrder`:
```go
	Rollover    bool   `json:"rollover"`
	Flexibility string `json:"flexibility"`
```

- [ ] **Step 2: Verify it compiles**

Run: `cd server && go build ./internal/model/`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add server/internal/model/category.go
git commit -m "feat: add rollover and flexibility to category model"
```

---

## Task 3: monthly_plans repository

**Files:**
- Create: `server/internal/repository/monthly_plan_repo.go`
- Test: `server/internal/repository/monthly_plan_repo_test.go`

- [ ] **Step 1: Write the failing test**

```go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestMonthlyPlanRepo_UpsertAndGet(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewMonthlyPlanRepo(pool)
	ctx := context.Background()

	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM monthly_plans WHERE month = '2026-05-01'`) })

	// Missing row → zero values, no error.
	p, err := repo.Get(ctx, "2026-05-01")
	if err != nil {
		t.Fatalf("Get missing: %v", err)
	}
	if p.ExpectedIncome != 0 || p.FlexBudget != 0 {
		t.Fatalf("expected zero plan, got %+v", p)
	}

	if err := repo.SetExpectedIncome(ctx, "2026-05-01", 1500000); err != nil {
		t.Fatalf("SetExpectedIncome: %v", err)
	}
	if err := repo.SetFlexBudget(ctx, "2026-05-01", 400000); err != nil {
		t.Fatalf("SetFlexBudget: %v", err)
	}

	p, err = repo.Get(ctx, "2026-05-01")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if p.ExpectedIncome != 1500000 {
		t.Errorf("ExpectedIncome = %d, want 1500000", p.ExpectedIncome)
	}
	if p.FlexBudget != 400000 {
		t.Errorf("FlexBudget = %d, want 400000", p.FlexBudget)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test-run T=TestMonthlyPlanRepo_UpsertAndGet`
Expected: FAIL — `undefined: repository.NewMonthlyPlanRepo`.

- [ ] **Step 3: Implement the repo**

```go
package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MonthlyPlanRepo struct{ pool *pgxpool.Pool }

func NewMonthlyPlanRepo(pool *pgxpool.Pool) *MonthlyPlanRepo { return &MonthlyPlanRepo{pool: pool} }

type MonthlyPlan struct {
	Month          string
	ExpectedIncome int64
	FlexBudget     int64
}

// Get returns the plan for a month (YYYY-MM-DD, first of month). Missing → zero values.
func (r *MonthlyPlanRepo) Get(ctx context.Context, month string) (MonthlyPlan, error) {
	var p MonthlyPlan
	p.Month = month
	err := r.pool.QueryRow(ctx,
		`SELECT expected_income, flex_budget FROM monthly_plans WHERE month = $1::date`, month,
	).Scan(&p.ExpectedIncome, &p.FlexBudget)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, fmt.Errorf("get monthly plan %s: %w", month, err)
	}
	return p, nil
}

// GetAllUpToMonth returns plans keyed by YYYY-MM-DD for all months <= the given month.
func (r *MonthlyPlanRepo) GetAllUpToMonth(ctx context.Context, month string) (map[string]MonthlyPlan, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT month::text, expected_income, flex_budget FROM monthly_plans WHERE month <= $1::date`, month)
	if err != nil {
		return nil, fmt.Errorf("get all monthly plans up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]MonthlyPlan)
	for rows.Next() {
		var p MonthlyPlan
		if err := rows.Scan(&p.Month, &p.ExpectedIncome, &p.FlexBudget); err != nil {
			return nil, fmt.Errorf("scan monthly plan: %w", err)
		}
		out[p.Month] = p
	}
	return out, rows.Err()
}

func (r *MonthlyPlanRepo) SetExpectedIncome(ctx context.Context, month string, amount int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO monthly_plans (month, expected_income) VALUES ($1::date, $2)
		ON CONFLICT (month) DO UPDATE SET expected_income = EXCLUDED.expected_income, updated_at = NOW()
	`, month, amount)
	if err != nil {
		return fmt.Errorf("set expected income %s: %w", month, err)
	}
	return nil
}

func (r *MonthlyPlanRepo) SetFlexBudget(ctx context.Context, month string, amount int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO monthly_plans (month, flex_budget) VALUES ($1::date, $2)
		ON CONFLICT (month) DO UPDATE SET flex_budget = EXCLUDED.flex_budget, updated_at = NOW()
	`, month, amount)
	if err != nil {
		return fmt.Errorf("set flex budget %s: %w", month, err)
	}
	return nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `make test-run T=TestMonthlyPlanRepo_UpsertAndGet`
Expected: PASS (or SKIP if no test DB — then run `make test` once a DB is available before merging).

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/monthly_plan_repo.go server/internal/repository/monthly_plan_repo_test.go
git commit -m "feat: monthly_plans repository"
```

---

## Task 4: app_settings repository

**Files:**
- Create: `server/internal/repository/settings_repo.go`
- Test: `server/internal/repository/settings_repo_test.go`

- [ ] **Step 1: Write the failing test**

```go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestSettingsRepo_GetWithDefaultAndSet(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewSettingsRepo(pool)
	ctx := context.Background()
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM app_settings WHERE key = 'budget_mode'`) })

	// Missing key → default.
	v, err := repo.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		t.Fatalf("GetWithDefault: %v", err)
	}
	if v != "category" {
		t.Errorf("default = %q, want category", v)
	}

	if err := repo.Set(ctx, "budget_mode", "flex"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	v, err = repo.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		t.Fatalf("GetWithDefault 2: %v", err)
	}
	if v != "flex" {
		t.Errorf("after set = %q, want flex", v)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test-run T=TestSettingsRepo_GetWithDefaultAndSet`
Expected: FAIL — `undefined: repository.NewSettingsRepo`.

- [ ] **Step 3: Implement the repo**

```go
package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SettingsRepo struct{ pool *pgxpool.Pool }

func NewSettingsRepo(pool *pgxpool.Pool) *SettingsRepo { return &SettingsRepo{pool: pool} }

func (r *SettingsRepo) GetWithDefault(ctx context.Context, key, def string) (string, error) {
	var v string
	err := r.pool.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = $1`, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return def, nil
	}
	if err != nil {
		return def, fmt.Errorf("get setting %s: %w", key, err)
	}
	return v, nil
}

func (r *SettingsRepo) Set(ctx context.Context, key, value string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO app_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, key, value)
	if err != nil {
		return fmt.Errorf("set setting %s: %w", key, err)
	}
	return nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `make test-run T=TestSettingsRepo_GetWithDefaultAndSet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/settings_repo.go server/internal/repository/settings_repo_test.go
git commit -m "feat: app_settings repository"
```

---

## Task 5: Category repo — rollover & flexibility

**Files:**
- Modify: `server/internal/repository/category_repo.go`
- Modify: `server/internal/repository/category_repo_test.go`

- [ ] **Step 1: Write the failing test**

Append to `category_repo_test.go`:
```go
func TestCategoryRepo_UpdateRolloverAndFlexibility(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	groupID := testutil.SeedGroup(t, pool)
	var catID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid,'FlexTest',1) RETURNING id::text`,
		groupID).Scan(&catID); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM categories WHERE id=$1::uuid`, catID) })

	_, err := repo.UpdateCategory(ctx, catID, model.UpdateCategoryReq{
		Name: "FlexTest", SortOrder: 1, Currency: "CRC",
		Rollover: true, Flexibility: "non_monthly",
	})
	if err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	var found *model.Category
	for _, g := range groups {
		for i := range g.Categories {
			if g.Categories[i].ID == catID {
				found = &g.Categories[i]
			}
		}
	}
	if found == nil {
		t.Fatal("category not found")
	}
	if !found.Rollover {
		t.Error("Rollover not persisted")
	}
	if found.Flexibility != "non_monthly" {
		t.Errorf("Flexibility = %q, want non_monthly", found.Flexibility)
	}
}
```
Ensure the test file imports `"budgetapp/internal/model"` (add if absent).

- [ ] **Step 2: Run it to verify it fails**

Run: `make test-run T=TestCategoryRepo_UpdateRolloverAndFlexibility`
Expected: FAIL — `unknown field Rollover` (compile error).

- [ ] **Step 3: Update `ListGroups` SELECT and scan**

In `ListGroups`, change the SELECT to add the two columns:
```go
		SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system,
		       c.id::text, c.name, c.hidden, c.sort_order, c.is_system, c.currency,
		       c.rollover, c.flexibility
```
Add scan targets after `cCurrency`:
```go
		var cRollover *bool
		var cFlexibility *string
```
Update the `rows.Scan(...)` to append `&cRollover, &cFlexibility`. After the `cur := "CRC"` block, before constructing the category, add:
```go
			roll := false
			if cRollover != nil {
				roll = *cRollover
			}
			flex := "flexible"
			if cFlexibility != nil {
				flex = *cFlexibility
			}
```
Add to the `model.Category{...}` literal: `Rollover: roll, Flexibility: flex,`.

- [ ] **Step 4: Update `UpdateCategory`**

Replace the UPDATE statement and scan so rollover/flexibility persist and return:
```go
	flexibility := req.Flexibility
	if flexibility == "" {
		flexibility = "flexible"
	}
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		UPDATE categories
		SET name=$1, hidden=$2, sort_order=$3, currency=$4, rollover=$5, flexibility=$6, updated_at=NOW()
		WHERE id=$7
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency, rollover, flexibility
	`, req.Name, req.Hidden, req.SortOrder, currency, req.Rollover, flexibility, id).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency, &c.Rollover, &c.Flexibility,
	)
```
(The `currency` resolution block above this stays unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `make test-run T=TestCategoryRepo_UpdateRolloverAndFlexibility`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/category_repo.go server/internal/repository/category_repo_test.go
git commit -m "feat: persist rollover and flexibility on categories"
```

---

## Task 6: Category handler — accept rollover & flexibility

**Files:**
- Modify: `server/internal/handler/categories.go`

- [ ] **Step 1: Validate flexibility in `UpdateCategory` and `CreateCategory`**

In `UpdateCategory`, after the currency validation block add:
```go
	if req.Flexibility != "" && req.Flexibility != "fixed" && req.Flexibility != "flexible" && req.Flexibility != "non_monthly" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "flexibility must be fixed, flexible, or non_monthly")
		return
	}
```
Add the identical block to `CreateCategory` after its currency validation. (`CreateCategory` persistence can keep defaults for now; rollover/flexibility are set via update. No further change needed there unless `CreateCategory` repo is extended — out of scope.)

- [ ] **Step 2: Verify build**

Run: `cd server && go build ./internal/handler/`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/categories.go
git commit -m "feat: validate flexibility on category endpoints"
```

---

## Task 7: BudgetRepo — actuals + rollover-aware carry; drop AtomicMove

**Files:**
- Modify: `server/internal/repository/budget_repo.go`
- Test: `server/internal/repository/budget_repo_test.go`

The existing `GetAllAssignedUpToMonth`, `GetAllActivityUpToMonth`, `GetActivityBreakdownForMonth`, `ClearAllAssigned`, `UpsertAssigned`, `BulkInsertAssignedIfAbsent` stay. We add two actuals queries and delete `AtomicMove`, `GetOnBudgetBalance`, `GetOnBudgetBalanceByCurrency`, `GetOutflow30Days` (RTA/AoM only).

- [ ] **Step 1: Write the failing test**

Append to `budget_repo_test.go`:
```go
func TestBudgetRepo_ActualIncomeAndSpending(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// Income system category.
	var incomeCat string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM categories WHERE is_system=true AND name='Income' LIMIT 1`).Scan(&incomeCat); err != nil {
		t.Skipf("Income system category not seeded: %v", err)
	}

	accID := testutil.SeedOnBudgetAccount(t, pool)
	spendCat := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	testutil.SeedTransaction(t, pool, accID, incomeCat, "2026-05-10", 1200000) // income
	testutil.SeedTransaction(t, pool, accID, spendCat, "2026-05-12", -300000)  // spending

	income, err := repo.GetActualIncomeForMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetActualIncomeForMonth: %v", err)
	}
	if income != 1200000 {
		t.Errorf("income = %d, want 1200000", income)
	}

	spending, err := repo.GetActualSpendingForMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetActualSpendingForMonth: %v", err)
	}
	if spending != 300000 {
		t.Errorf("spending = %d, want 300000 (positive)", spending)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test-run T=TestBudgetRepo_ActualIncomeAndSpending`
Expected: FAIL — `undefined: ... GetActualIncomeForMonth`.

- [ ] **Step 3: Add the two queries (in CRC)**

Add to `budget_repo.go`. Both convert any USD account amounts to CRC via the existing nearest-rate fallback pattern (mirrors `currencyConversionExpr`, but target currency is always CRC here):
```go
// crcConvExpr converts a transaction amount to CRC centimos using the stamped
// rate, nearest available rate, or fallback 500. Used for cross-category CRC rollups.
const crcConvExpr = `CASE
  WHEN a.currency = 'CRC' THEN t.amount
  ELSE ROUND(t.amount::numeric * COALESCE(
    t.exchange_rate,
    (SELECT er.usd_to_crc FROM exchange_rates er WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
    500))::bigint
END`

// GetActualIncomeForMonth returns total inflow (CRC) booked to the Income system
// category in the given YYYY-MM month, on on-budget accounts.
func (r *BudgetRepo) GetActualIncomeForMonth(ctx context.Context, month string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(`+crcConvExpr+`), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND cat.is_system = true AND cat.name = 'Income'
		  AND date_trunc('month', t.date) = ($1 || '-01')::date
	`, month).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("actual income %s: %w", month, err)
	}
	return total, nil
}

// GetActualSpendingForMonth returns total outflow (CRC, positive) in non-system
// categories for the given YYYY-MM month, on on-budget accounts.
func (r *BudgetRepo) GetActualSpendingForMonth(ctx context.Context, month string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(-SUM(`+crcConvExpr+`), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND cat.is_system = false
		  AND t.amount < 0
		  AND date_trunc('month', t.date) = ($1 || '-01')::date
	`, month).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("actual spending %s: %w", month, err)
	}
	return total, nil
}
```

- [ ] **Step 4: Delete the now-dead RTA/AoM/move methods**

Remove `AtomicMove`, `GetOnBudgetBalance`, `GetOnBudgetBalanceByCurrency`, `GetOutflow30Days`, and the `CurrencyBalance` type from `budget_repo.go`.

- [ ] **Step 5: Run the new test + full repo package**

Run: `make test-run T=TestBudgetRepo_ActualIncomeAndSpending`
Expected: PASS.
Run: `cd server && go build ./internal/repository/`
Expected: success (no references to deleted methods inside the package).

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/budget_repo.go server/internal/repository/budget_repo_test.go
git commit -m "feat: actual income/spending queries; drop RTA/move repo methods"
```

---

## Task 8: Delete target repo

**Files:**
- Delete: `server/internal/repository/target_repo.go`, `server/internal/repository/target_repo_test.go`

- [ ] **Step 1: Delete the files**

```bash
git rm server/internal/repository/target_repo.go server/internal/repository/target_repo_test.go
```

- [ ] **Step 2: Commit (build will fail until service rewrite — that's expected; commit the deletion now)**

```bash
git commit -m "chore: remove category targets repository"
```

---

## Task 9: Plan models

**Files:**
- Modify: `server/internal/model/budget.go`

- [ ] **Step 1: Replace the file contents**

```go
// server/internal/model/budget.go
package model

type ActivityEntry struct {
	Currency        string `json:"currency"`
	Amount          int64  `json:"amount"`
	ConvertedAmount int64  `json:"converted_amount"`
}

type PlanCategory struct {
	ID                string
	Name              string
	Currency          string
	Flexibility       string // fixed | flexible | non_monthly
	Rollover          bool
	Planned           int64 // native currency
	Activity          int64 // native currency (negative = spending)
	Remaining         int64 // month-scoped: Planned + Activity
	RolloverBalance   int64 // accumulated Planned+Activity across months (rollover cats)
	ActivityBreakdown []ActivityEntry
}

type PlanGroup struct {
	ID         string
	Name       string
	Planned    int64 // CRC
	Activity   int64 // CRC
	Remaining  int64 // CRC
	Categories []PlanCategory
}

type PlanMonth struct {
	Month          string
	Mode           string // category | flex
	ExpectedIncome int64  // CRC
	FlexBudget     int64  // CRC
	PlannedTotal   int64  // CRC (converted)
	LeftToBudget   int64  // ExpectedIncome - PlannedTotal
	ActualIncome   int64  // CRC
	ActualSpending int64  // CRC (positive)
	ActualSavings  int64  // ActualIncome - ActualSpending

	FixedPlanned      int64 // CRC
	FixedActual       int64 // CRC (positive)
	FlexibleActual    int64 // CRC (positive), vs FlexBudget
	NonMonthlyPlanned int64 // CRC
	NonMonthlyActual  int64 // CRC (positive)

	CategoryGroups []PlanGroup
}
```

- [ ] **Step 2: Verify model package builds**

Run: `cd server && go build ./internal/model/`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add server/internal/model/budget.go
git commit -m "feat: plan models replacing budget month/target models"
```

---

## Task 10: Plan service

**Files:**
- Rewrite: `server/internal/service/budget_service.go`
- Rewrite: `server/internal/service/budget_service_test.go`

**Interface the service exposes** (consumed by the handler in Task 11):
`GetMonth(ctx, month) (*model.PlanMonth, error)`, `SetPlanned(ctx, catID, month, planned)`, `SetExpectedIncome(ctx, month, amount)`, `SetFlexBudget(ctx, month, amount)`, `CopyPrevious(ctx, month)`, `ChangeCategoryBudgetCurrency(ctx, catID, newCurrency)`.

- [ ] **Step 1: Write the failing tests**

Replace `budget_service_test.go` entirely:
```go
package service_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/service"
	"budgetapp/internal/testutil"
)

func TestPlanService_LeftToBudget(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	catID := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
		pool.Exec(ctx, `DELETE FROM monthly_plans WHERE month='2026-05-01'`)
	})

	if err := svc.SetExpectedIncome(ctx, "2026-05", 1000000); err != nil {
		t.Fatalf("SetExpectedIncome: %v", err)
	}
	if err := svc.SetPlanned(ctx, catID, "2026-05", 300000); err != nil {
		t.Fatalf("SetPlanned: %v", err)
	}

	pm, err := svc.GetMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	if pm.ExpectedIncome != 1000000 {
		t.Errorf("ExpectedIncome = %d, want 1000000", pm.ExpectedIncome)
	}
	if pm.PlannedTotal != 300000 {
		t.Errorf("PlannedTotal = %d, want 300000", pm.PlannedTotal)
	}
	if pm.LeftToBudget != 700000 {
		t.Errorf("LeftToBudget = %d, want 700000", pm.LeftToBudget)
	}
}

func TestPlanService_RolloverAccumulatesWithNegativeCarry(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	accID := testutil.SeedOnBudgetAccount(t, pool)
	catID := testutil.SeedCategory(t, pool)
	// Mark the category as rollover.
	if _, err := pool.Exec(ctx, `UPDATE categories SET rollover=true WHERE id=$1::uuid`, catID); err != nil {
		t.Fatalf("set rollover: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	// April: planned 100000, spent 150000 → month remaining -50000, carries.
	if err := svc.SetPlanned(ctx, catID, "2026-04", 100000); err != nil {
		t.Fatal(err)
	}
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-15", -150000)
	// May: planned 100000, no spend → balance = -50000 + 100000 = 50000.
	if err := svc.SetPlanned(ctx, catID, "2026-05", 100000); err != nil {
		t.Fatal(err)
	}

	pm, err := svc.GetMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	var found *struct{ Remaining, RolloverBalance int64 }
	for _, g := range pm.CategoryGroups {
		for _, c := range g.Categories {
			if c.ID == catID {
				found = &struct{ Remaining, RolloverBalance int64 }{c.Remaining, c.RolloverBalance}
			}
		}
	}
	if found == nil {
		t.Fatal("category not found")
	}
	if found.Remaining != 100000 {
		t.Errorf("month Remaining = %d, want 100000", found.Remaining)
	}
	if found.RolloverBalance != 50000 {
		t.Errorf("RolloverBalance = %d, want 50000", found.RolloverBalance)
	}
}

func TestPlanService_GetMonth_Empty(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	pm, err := svc.GetMonth(context.Background(), "2026-04")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	if pm.Month != "2026-04" {
		t.Errorf("Month = %q", pm.Month)
	}
	if pm.Mode != "category" && pm.Mode != "flex" {
		t.Errorf("Mode = %q, want category|flex", pm.Mode)
	}
}
```
Delete the placeholder `newPlanSvc` function before finishing the task (it's only here to flag the import shape); it is removed in Step 3's final file.

- [ ] **Step 2: Run to verify failure**

Run: `make test-run T=TestPlanService_LeftToBudget`
Expected: FAIL — signature mismatch / undefined (the old `NewBudgetService` took a `targetRepo`).

- [ ] **Step 3: Rewrite the service**

Replace `budget_service.go` with (keep the `lastDay`, `prevMonthStr`, `monthRange` helpers; drop `monthsUntil`, `computeUnderfunded`):
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
	planRepo   *repository.MonthlyPlanRepo
	catRepo    *repository.CategoryRepo
	rateRepo   *repository.ExchangeRateRepo
	settings   *repository.SettingsRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	planRepo *repository.MonthlyPlanRepo,
	catRepo *repository.CategoryRepo,
	rateRepo *repository.ExchangeRateRepo,
	settings *repository.SettingsRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, planRepo: planRepo, catRepo: catRepo, rateRepo: rateRepo, settings: settings}
}

func (s *BudgetService) GetMonth(ctx context.Context, month string) (*model.PlanMonth, error) {
	firstOfMonth := month + "-01"
	lastOfMonth := lastDay(month)

	groups, err := s.catRepo.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
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
	breakdownByCat := make(map[string][]repository.ActivityBreakdownRow)
	for _, row := range breakdown {
		breakdownByCat[row.CategoryID] = append(breakdownByCat[row.CategoryID], row)
	}

	plan, err := s.planRepo.Get(ctx, firstOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}
	mode, err := s.settings.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		return nil, fmt.Errorf("get budget mode: %w", err)
	}

	today := time.Now().Format("2006-01-02")
	var rate float64 = 500
	if r, err := s.rateRepo.GetNearest(ctx, today); err == nil {
		rate = r.USDToCRC
	}
	toCRC := func(amount int64, currency string) int64 {
		if currency == "USD" {
			return int64(math.Round(float64(amount) * rate))
		}
		return amount
	}

	// Rollover balance: accumulate Planned+Activity across all months for rollover cats.
	rollBalance := s.computeRolloverBalances(groups, assigned, activity, firstOfMonth)

	pm := &model.PlanMonth{
		Month:          month,
		Mode:           mode,
		ExpectedIncome: plan.ExpectedIncome,
		FlexBudget:     plan.FlexBudget,
	}

	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		pg := model.PlanGroup{ID: g.ID, Name: g.Name}
		for _, c := range g.Categories {
			planned := assigned[c.ID][firstOfMonth]
			act := activity[c.ID][firstOfMonth]
			remaining := planned + act

			var bd []model.ActivityEntry
			for _, row := range breakdownByCat[c.ID] {
				bd = append(bd, model.ActivityEntry{Currency: row.TxnCurrency, Amount: row.Amount, ConvertedAmount: row.ConvertedAmount})
			}

			pc := model.PlanCategory{
				ID: c.ID, Name: c.Name, Currency: c.Currency,
				Flexibility: c.Flexibility, Rollover: c.Rollover,
				Planned: planned, Activity: act, Remaining: remaining,
				RolloverBalance: rollBalance[c.ID], ActivityBreakdown: bd,
			}

			plannedCRC := toCRC(planned, c.Currency)
			actCRC := toCRC(act, c.Currency)
			pm.PlannedTotal += plannedCRC
			pg.Planned += plannedCRC
			pg.Activity += actCRC
			pg.Remaining += toCRC(remaining, c.Currency)

			spendingCRC := int64(0)
			if actCRC < 0 {
				spendingCRC = -actCRC
			}
			switch c.Flexibility {
			case "fixed":
				pm.FixedPlanned += plannedCRC
				pm.FixedActual += spendingCRC
			case "non_monthly":
				pm.NonMonthlyPlanned += plannedCRC
				pm.NonMonthlyActual += spendingCRC
			default: // flexible
				pm.FlexibleActual += spendingCRC
			}

			pg.Categories = append(pg.Categories, pc)
		}
		pm.CategoryGroups = append(pm.CategoryGroups, pg)
	}

	pm.LeftToBudget = pm.ExpectedIncome - pm.PlannedTotal

	income, err := s.budgetRepo.GetActualIncomeForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("actual income: %w", err)
	}
	spending, err := s.budgetRepo.GetActualSpendingForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("actual spending: %w", err)
	}
	pm.ActualIncome = income
	pm.ActualSpending = spending
	pm.ActualSavings = income - spending

	return pm, nil
}

// computeRolloverBalances sums Planned+Activity over every month up to firstOfMonth
// for rollover categories. Negative balances carry as-is (no clamp).
func (s *BudgetService) computeRolloverBalances(
	groups []model.CategoryGroup,
	assigned, activity map[string]map[string]int64,
	firstOfMonth string,
) map[string]int64 {
	rollover := map[string]bool{}
	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		for _, c := range g.Categories {
			if c.Rollover {
				rollover[c.ID] = true
			}
		}
	}

	earliest := firstOfMonth
	for _, mm := range assigned {
		for m := range mm {
			if m < earliest {
				earliest = m
			}
		}
	}
	for _, mm := range activity {
		for m := range mm {
			if m < earliest {
				earliest = m
			}
		}
	}
	months := monthRange(earliest, firstOfMonth)

	bal := map[string]int64{}
	for catID := range rollover {
		var acc int64
		for _, m := range months {
			acc += assigned[catID][m] + activity[catID][m]
		}
		bal[catID] = acc
	}
	return bal
}

func (s *BudgetService) SetPlanned(ctx context.Context, catID, month string, planned int64) error {
	return s.budgetRepo.UpsertAssigned(ctx, catID, month+"-01", planned)
}

func (s *BudgetService) SetExpectedIncome(ctx context.Context, month string, amount int64) error {
	return s.planRepo.SetExpectedIncome(ctx, month+"-01", amount)
}

func (s *BudgetService) SetFlexBudget(ctx context.Context, month string, amount int64) error {
	return s.planRepo.SetFlexBudget(ctx, month+"-01", amount)
}

// CopyPrevious copies planned amounts from the previous month (only for categories
// with a positive planned value and no current-month row) and seeds expected income
// from the previous month when the current month has none.
func (s *BudgetService) CopyPrevious(ctx context.Context, month string) error {
	prev := prevMonthStr(month)
	prevAssigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, prev+"-01")
	if err != nil {
		return fmt.Errorf("get prev assigned: %w", err)
	}
	prevKey := prev + "-01"
	var entries []repository.BudgetAssignedEntry
	for catID, mm := range prevAssigned {
		if v, ok := mm[prevKey]; ok && v > 0 {
			entries = append(entries, repository.BudgetAssignedEntry{CategoryID: catID, Month: month + "-01", Assigned: v})
		}
	}
	if err := s.budgetRepo.BulkInsertAssignedIfAbsent(ctx, entries); err != nil {
		return err
	}

	cur, err := s.planRepo.Get(ctx, month+"-01")
	if err != nil {
		return err
	}
	if cur.ExpectedIncome == 0 {
		prevPlan, err := s.planRepo.Get(ctx, prevKey)
		if err != nil {
			return err
		}
		if prevPlan.ExpectedIncome > 0 {
			if err := s.planRepo.SetExpectedIncome(ctx, month+"-01", prevPlan.ExpectedIncome); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *BudgetService) ChangeCategoryBudgetCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	if err := s.catRepo.UpdateCategoryCurrency(ctx, catID, newCurrency); err != nil {
		return fmt.Errorf("update category currency: %w", err)
	}
	return s.budgetRepo.ClearAllAssigned(ctx, catID)
}

func lastDay(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month+1), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return t.Format("2006-01-02")
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
```
Now remove the placeholder `newPlanSvc` stub from the test file.

- [ ] **Step 4: Run the plan service tests**

Run: `make test-run T=TestPlanService`
Expected: PASS for `TestPlanService_LeftToBudget`, `TestPlanService_RolloverAccumulatesWithNegativeCarry`, `TestPlanService_GetMonth_Empty`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/budget_service.go server/internal/service/budget_service_test.go
git commit -m "feat: plan service replacing zero-sum budget service"
```

---

## Task 11: Plan handler + routes

**Files:**
- Rewrite: `server/internal/handler/budget.go`
- Modify: `server/main.go`

- [ ] **Step 1: Rewrite `budget.go`**

```go
package handler

import (
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
	pm, err := h.svc.GetMonth(r.Context(), month)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, planMonthToJSON(pm))
}

func (h *BudgetHandler) SetPlanned(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	catID := r.PathValue("categoryId")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "categoryId required")
		return
	}
	var body struct {
		Planned int64 `json:"planned"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetPlanned(r.Context(), catID, month, body.Planned); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"planned": body.Planned})
}

func (h *BudgetHandler) SetIncome(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		Amount int64 `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetExpectedIncome(r.Context(), month, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"amount": body.Amount})
}

func (h *BudgetHandler) SetFlexBudget(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		Amount int64 `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetFlexBudget(r.Context(), month, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"amount": body.Amount})
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

// ChangeCategoryCurrency handles PUT /api/categories/{id}/currency.
func (h *BudgetHandler) ChangeCategoryCurrency(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id required")
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

func planMonthToJSON(pm *model.PlanMonth) map[string]any {
	groups := make([]map[string]any, 0, len(pm.CategoryGroups))
	for _, g := range pm.CategoryGroups {
		cats := make([]map[string]any, 0, len(g.Categories))
		for _, c := range g.Categories {
			bd := make([]map[string]any, 0, len(c.ActivityBreakdown))
			for _, e := range c.ActivityBreakdown {
				bd = append(bd, map[string]any{"currency": e.Currency, "amount": e.Amount, "converted_amount": e.ConvertedAmount})
			}
			cats = append(cats, map[string]any{
				"id": c.ID, "name": c.Name, "currency": c.Currency,
				"flexibility": c.Flexibility, "rollover": c.Rollover,
				"planned": c.Planned, "activity": c.Activity, "remaining": c.Remaining,
				"rollover_balance": c.RolloverBalance, "activity_breakdown": bd,
			})
		}
		groups = append(groups, map[string]any{
			"id": g.ID, "name": g.Name,
			"planned": g.Planned, "activity": g.Activity, "remaining": g.Remaining,
			"categories": cats,
		})
	}
	return map[string]any{
		"month": pm.Month, "mode": pm.Mode,
		"expected_income": pm.ExpectedIncome, "flex_budget": pm.FlexBudget,
		"planned_total": pm.PlannedTotal, "left_to_budget": pm.LeftToBudget,
		"actual_income": pm.ActualIncome, "actual_spending": pm.ActualSpending, "actual_savings": pm.ActualSavings,
		"fixed_planned": pm.FixedPlanned, "fixed_actual": pm.FixedActual,
		"flexible_actual": pm.FlexibleActual,
		"non_monthly_planned": pm.NonMonthlyPlanned, "non_monthly_actual": pm.NonMonthlyActual,
		"category_groups": groups,
	}
}
```

- [ ] **Step 2: Add a settings handler**

Create `server/internal/handler/settings.go`:
```go
package handler

import (
	"net/http"

	"budgetapp/internal/repository"
)

type SettingsHandler struct {
	repo *repository.SettingsRepo
}

func NewSettingsHandler(repo *repository.SettingsRepo) *SettingsHandler {
	return &SettingsHandler{repo: repo}
}

func (h *SettingsHandler) GetBudgetMode(w http.ResponseWriter, r *http.Request) {
	mode, err := h.repo.GetWithDefault(r.Context(), "budget_mode", "category")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": mode})
}

func (h *SettingsHandler) SetBudgetMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.Mode != "category" && body.Mode != "flex" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "mode must be category or flex")
		return
	}
	if err := h.repo.Set(r.Context(), "budget_mode", body.Mode); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": body.Mode})
}
```

- [ ] **Step 3: Wire `main.go`**

In the Repos block, add after `budgetRepo`:
```go
	planRepo     := repository.NewMonthlyPlanRepo(pool)
	settingsRepo := repository.NewSettingsRepo(pool)
```
Remove `targetRepo := repository.NewTargetRepo(pool)`.
Change the service constructor:
```go
	budgetSvc  := service.NewBudgetService(budgetRepo, planRepo, catRepo, rateRepo, settingsRepo)
```
In the Handlers block add:
```go
	settings := handler.NewSettingsHandler(settingsRepo)
```
Replace the budget/target/move routes (lines registering `GET /api/budgets/{month}`, `PUT /api/budgets/{month}/categories/{categoryId}`, `POST /api/budgets/{month}/copy-previous`, `POST /api/budgets/{month}/move`, `PUT /api/categories/{id}/target`, `DELETE /api/categories/{id}/target`) with:
```go
	mux.HandleFunc("GET /api/plan/{month}", budgets.GetMonth)
	mux.HandleFunc("PUT /api/plan/{month}/categories/{categoryId}", budgets.SetPlanned)
	mux.HandleFunc("POST /api/plan/{month}/copy-previous", budgets.CopyPrevious)
	mux.HandleFunc("PUT /api/plan/{month}/income", budgets.SetIncome)
	mux.HandleFunc("PUT /api/plan/{month}/flex-budget", budgets.SetFlexBudget)
	mux.HandleFunc("GET /api/settings/budget-mode", settings.GetBudgetMode)
	mux.HandleFunc("PUT /api/settings/budget-mode", settings.SetBudgetMode)
```
Keep `PUT /api/categories/{id}/currency` → `budgets.ChangeCategoryCurrency`.

- [ ] **Step 4: Build the whole server**

Run: `cd server && go build ./...`
Expected: success. Fix any lingering references to removed symbols (`model.Target`, `UpsertTarget`, etc.) that surface here.

- [ ] **Step 5: Run the full backend test suite**

Run: `make test`
Expected: PASS (DB-dependent tests pass or skip). No references to deleted target/move tests.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler/budget.go server/internal/handler/settings.go server/main.go
git commit -m "feat: plan + settings handlers and routes; drop budget/target/move routes"
```

---

## Task 12: Reports — savings-rate series

**Files:**
- Modify: `server/internal/handler/reports.go`
- Modify: `server/main.go`

The existing `IncomeExpenseByMonth` already yields income + expense per month; savings = income − expense. We expose a dedicated endpoint so the Cash Flow page gets savings + rate without recomputing.

- [ ] **Step 1: Add the handler method**

Add to `reports.go`:
```go
// SavingsRate handles GET /api/reports/savings?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) SavingsRate(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}
	rows, err := h.txnRepo.IncomeExpenseByMonth(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	type row struct {
		Month   string  `json:"month"`
		Income  int64   `json:"income"`
		Expense int64   `json:"expense"`
		Savings int64   `json:"savings"`
		Rate    float64 `json:"rate"` // savings / income, 0 when income == 0
	}
	result := make([]row, 0, len(rows))
	for _, rr := range rows {
		savings := rr.Income - rr.Expense
		var rate float64
		if rr.Income > 0 {
			rate = float64(savings) / float64(rr.Income)
		}
		result = append(result, row{Month: rr.Month, Income: rr.Income, Expense: rr.Expense, Savings: savings, Rate: rate})
	}
	writeJSON(w, http.StatusOK, result)
}
```

- [ ] **Step 2: Register the route in `main.go`** (next to the other `/api/reports/*` routes):
```go
	mux.HandleFunc("GET /api/reports/savings", reports.SavingsRate)
```

- [ ] **Step 3: Build**

Run: `cd server && go build ./...`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/reports.go server/main.go
git commit -m "feat: savings-rate reports endpoint"
```

---

# Phase 2 — Frontend Spending Plan

## Task 13: API client — plan section

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Replace the Budget types and functions**

Remove `Target`, `BudgetCategoryAPI`, `BudgetGroupAPI`, `BudgetMonthAPI`, `fetchBudget`, `setAssigned`, `copyPreviousBudget`, `moveBudgetMoney`, `upsertCategoryTarget`, `deleteCategoryTarget`. Add:
```ts
export interface PlanCategoryAPI {
  id: string;
  name: string;
  currency: string;
  flexibility: 'fixed' | 'flexible' | 'non_monthly';
  rollover: boolean;
  planned: number;
  activity: number;
  remaining: number;
  rollover_balance: number;
  activity_breakdown: ActivityBreakdownEntry[];
}

export interface PlanGroupAPI {
  id: string;
  name: string;
  planned: number;
  activity: number;
  remaining: number;
  categories: PlanCategoryAPI[];
}

export interface PlanMonthAPI {
  month: string;
  mode: 'category' | 'flex';
  expected_income: number;
  flex_budget: number;
  planned_total: number;
  left_to_budget: number;
  actual_income: number;
  actual_spending: number;
  actual_savings: number;
  fixed_planned: number;
  fixed_actual: number;
  flexible_actual: number;
  non_monthly_planned: number;
  non_monthly_actual: number;
  category_groups: PlanGroupAPI[];
}

export async function fetchPlan(month: string): Promise<PlanMonthAPI> {
  const data = await apiFetch<any>(`/plan/${month}`);
  const m = (n: number) => n / 100;
  data.expected_income = m(data.expected_income);
  data.flex_budget = m(data.flex_budget);
  data.planned_total = m(data.planned_total);
  data.left_to_budget = m(data.left_to_budget);
  data.actual_income = m(data.actual_income);
  data.actual_spending = m(data.actual_spending);
  data.actual_savings = m(data.actual_savings);
  data.fixed_planned = m(data.fixed_planned);
  data.fixed_actual = m(data.fixed_actual);
  data.flexible_actual = m(data.flexible_actual);
  data.non_monthly_planned = m(data.non_monthly_planned);
  data.non_monthly_actual = m(data.non_monthly_actual);
  for (const g of data.category_groups) {
    g.planned = m(g.planned); g.activity = m(g.activity); g.remaining = m(g.remaining);
    for (const c of g.categories) {
      c.planned = m(c.planned); c.activity = m(c.activity);
      c.remaining = m(c.remaining); c.rollover_balance = m(c.rollover_balance);
      for (const e of (c.activity_breakdown ?? [])) {
        e.amount = m(e.amount); e.converted_amount = m(e.converted_amount);
      }
    }
  }
  return data as PlanMonthAPI;
}

export async function setPlanned(month: string, categoryId: string, amount: number): Promise<void> {
  await apiFetch(`/plan/${month}/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify({ planned: Math.round(amount * 100) }),
  });
}

export async function setExpectedIncome(month: string, amount: number): Promise<void> {
  await apiFetch(`/plan/${month}/income`, {
    method: 'PUT',
    body: JSON.stringify({ amount: Math.round(amount * 100) }),
  });
}

export async function setFlexBudget(month: string, amount: number): Promise<void> {
  await apiFetch(`/plan/${month}/flex-budget`, {
    method: 'PUT',
    body: JSON.stringify({ amount: Math.round(amount * 100) }),
  });
}

export async function copyPreviousPlan(month: string): Promise<void> {
  await apiFetch(`/plan/${month}/copy-previous`, { method: 'POST' });
}

export async function fetchBudgetMode(): Promise<'category' | 'flex'> {
  const data = await apiFetch<{ mode: 'category' | 'flex' }>(`/settings/budget-mode`);
  return data.mode;
}

export async function setBudgetMode(mode: 'category' | 'flex'): Promise<void> {
  await apiFetch(`/settings/budget-mode`, { method: 'PUT', body: JSON.stringify({ mode }) });
}

export async function fetchSavings(
  from: string, to: string,
): Promise<{ month: string; income: number; expense: number; savings: number; rate: number }[]> {
  const data = await apiFetch<{ month: string; income: number; expense: number; savings: number; rate: number }[]>(
    `/reports/savings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return data ?? [];
}
```

- [ ] **Step 2: Extend `updateCategory` to send rollover/flexibility**

Find `updateCategory` in `api.ts`. Ensure its body type and payload include `rollover?: boolean` and `flexibility?: 'fixed'|'flexible'|'non_monthly'`, and that `CategoryItemAPI` gains `rollover: boolean; flexibility: 'fixed'|'flexible'|'non_monthly';`. (If `updateCategory` currently spreads a partial body, just widen the type.)

- [ ] **Step 3: Remove `fetchAgeOfMoney`**

Delete `fetchAgeOfMoney` (it called the removed budget endpoint). Verify no remaining import references it (Reports/Dashboard updated in later tasks).

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: errors only in files not yet migrated (`Budget.tsx`, `engine.ts`, `Dashboard.tsx`, `Reports.tsx`). That's acceptable mid-phase — they're fixed in their own tasks. If you want a clean gate, defer this check to Task 19.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(fe): plan/settings/savings API client; drop budget+target client"
```

---

## Task 14: Rewrite engine.ts (plan math)

**Files:**
- Rewrite: `frontend/src/engine.ts`

The engine now computes, for the displayed month only, per-category planned/activity/remaining and rollover balance, plus month totals (planned total, left to budget). It keeps the optimistic-local-edit shape: callers pass server data + a local override map.

- [ ] **Step 1: Replace the file**

```ts
import type { PlanCategoryAPI, PlanGroupAPI } from './api';

export interface PlanCatState {
  cat: string;            // category name (keying matches existing Budget.tsx convention)
  id: string;
  currency: string;
  flexibility: 'fixed' | 'flexible' | 'non_monthly';
  rollover: boolean;
  planned: number;
  activity: number;
  remaining: number;
  rolloverBalance: number;
}

export interface PlanState {
  cats: Record<string, PlanCatState>;
  plannedTotalCRC: number;
  expectedIncome: number;
  leftToBudget: number;
}

interface ComputeInput {
  groups: PlanGroupAPI[];          // server snapshot for the month
  expectedIncome: number;
  rate: number;                    // USD→CRC for cross-currency totals
  // local planned overrides keyed by category name (major units)
  localPlanned: Record<string, number> | null;
  nameById: Record<string, string>;
}

const toCRC = (amount: number, currency: string, rate: number) =>
  currency === 'USD' ? amount * rate : amount;

export function computePlan(input: ComputeInput): PlanState {
  const { groups, expectedIncome, rate, localPlanned, nameById } = input;
  const cats: Record<string, PlanCatState> = {};
  let plannedTotalCRC = 0;

  for (const g of groups) {
    for (const c of g.categories) {
      const name = nameById[c.id] ?? c.name;
      const planned = localPlanned?.[name] ?? c.planned;
      const remaining = planned + c.activity;
      // rollover balance shifts by the delta of any local planned edit
      const rolloverBalance = c.rollover
        ? c.rollover_balance + (planned - c.planned)
        : 0;
      cats[name] = {
        cat: name, id: c.id, currency: c.currency,
        flexibility: c.flexibility, rollover: c.rollover,
        planned, activity: c.activity, remaining, rolloverBalance,
      };
      plannedTotalCRC += toCRC(planned, c.currency, rate);
    }
  }

  return {
    cats,
    plannedTotalCRC,
    expectedIncome,
    leftToBudget: expectedIncome - plannedTotalCRC,
  };
}

// resetAll returns a planned-override map setting every category to 0.
export function resetAllPlanned(state: PlanState): Record<string, number> {
  const out: Record<string, number> = {};
  Object.values(state.cats).forEach(c => { out[c.cat] = 0; });
  return out;
}
```

- [ ] **Step 2: Type-check the engine in isolation**

Run: `cd frontend && npx tsc --noEmit src/engine.ts 2>&1 | head -20`
Expected: no errors originating in `engine.ts` itself (import resolution against `api.ts` types succeeds).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine.ts
git commit -m "feat(fe): rewrite engine for spending-plan math"
```

---

## Task 15: BudgetSummaryPane → plan stats

**Files:**
- Rewrite: `frontend/src/components/BudgetSummaryPane.tsx`

- [ ] **Step 1: Replace the stats shape and cards**

```tsx
import { T } from '../theme';

export interface SummaryStats {
  planned: number;
  actual: number;      // positive spending
  remaining: number;
  rolloverBalance: number | null; // null when selection has no rollover category
}

interface Props {
  stats: SummaryStats;
  selectionLabel: string;
  hasSelection: boolean;
  onClear: () => void;
  fmt: (n: number) => string;
}

export function BudgetSummaryPane({ stats, selectionLabel, hasSelection, onClear, fmt }: Props) {
  return (
    <div style={sp.pane}>
      <div style={sp.labelRow}><span style={sp.label}>SUMMARY</span></div>
      <div style={sp.selLine}>{selectionLabel}</div>

      <StatCard label="Budgeted" value={fmt(stats.planned)} color={T.text} />
      <StatCard label="Actual" value={fmt(stats.actual)} color={stats.actual > 0 ? T.neg : T.textMid} />
      <StatCard label="Remaining" value={fmt(stats.remaining)} color={stats.remaining < 0 ? T.neg : stats.remaining === 0 ? T.textMid : T.pos} />
      {stats.rolloverBalance !== null && (
        <StatCard label="Rollover balance" value={fmt(stats.rolloverBalance)} color={stats.rolloverBalance < 0 ? T.neg : T.pos} />
      )}

      {hasSelection && <button onClick={onClear} style={sp.clearBtn}>✕ Clear selection</button>}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={sp.card}>
      <div style={sp.cardLabel}>{label}</div>
      <div style={{ ...sp.cardValue, color }}>{value}</div>
    </div>
  );
}

const sp = {
  pane:      { width: 220, flexShrink: 0, padding: '16px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10, borderRadius: `0 ${T.radius} ${T.radius} 0` },
  labelRow:  { marginBottom: 2 },
  label:     { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.08em', textTransform: 'uppercase' as const },
  selLine:   { fontSize: 11, color: T.textMid, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 },
  card:      { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' },
  cardLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono, monospace)', letterSpacing: '-.02em' },
  clearBtn:  { background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, fontSize: 11, padding: '6px 10px', cursor: 'pointer', width: '100%', marginTop: 4 },
};
```

- [ ] **Step 2: Commit** (type-checked together with Budget.tsx in Task 16)

```bash
git add frontend/src/components/BudgetSummaryPane.tsx
git commit -m "feat(fe): summary pane shows budgeted/actual/remaining/rollover"
```

---

## Task 16: Redesign Budget.tsx as the Spending Plan page

**Files:**
- Rewrite: `frontend/src/components/Budget.tsx`
- Rewrite: `frontend/src/components/BudgetModals.tsx`

This is the largest task. Keep these existing pieces: `InlineRename`, `BudgetCell` (inline calculator edit), the undo stack wiring (`useUndoStack`, Ctrl-Z handler), month navigation (`toDisplayMonth`/`prevYM`/`nextYM`), group collapse, category add/rename/delete/hide, currency change, the right-hand summary pane, multi-select. Remove: RTA header + breakdown popover, Age of Money, `MoveMoneyModal`, target modals/badges/underfunded, quick-assign "underfunded".

**Reference — current header/data-load region:** `Budget.tsx:354-449` (props, state, fetch effect). The fetch switches from `fetchBudget` to `fetchPlan`; `serverRtaRef`/`aom`/`rtaBreakdown`/`targets` state is removed; add `expectedIncome`, `mode`, `flexBudget`, and `serverPlannedTotalRef`.

- [ ] **Step 1: Update imports and props**

Replace the top imports:
```tsx
import React, { useState, useCallback, useMemo, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { T, GROUP_COLORS } from '../theme';
import { computePlan, resetAllPlanned } from '../engine';
import { CategoryInspector } from './BudgetModals';
import { BudgetSummaryPane } from './BudgetSummaryPane';
import type { SummaryStats } from './BudgetSummaryPane';
import type { CategoryGroup, PlanMonthAPI } from '../api';
import type { PlanState, PlanCatState } from '../engine';
import {
  fetchPlan, setPlanned as apiSetPlanned, copyPreviousPlan, setExpectedIncome as apiSetIncome,
  setFlexBudget as apiSetFlexBudget, fetchBudgetMode, setBudgetMode as apiSetBudgetMode,
  createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory, fetchNearestRate,
} from '../api';
import type { ExchangeRate } from '../api';
import { useToast } from './Toast';
import { useUndoStack } from '../hooks/useUndoStack';
```
Keep `Props` as-is (Task 16 doesn't change the component's external contract).

- [ ] **Step 2: Replace state + fetch effect**

Inside `Budget(...)`:
```tsx
  const [currentYM, setCurrentYM] = useState(() => new Date().toISOString().slice(0, 7));
  const currentDisplayMonth = toDisplayMonth(currentYM);
  const [server, setServer] = useState<PlanMonthAPI | null>(null);
  const [localPlanned, setLocalPlanned] = useState<Record<string, number> | null>(null);
  const [expectedIncome, setExpectedIncome] = useState(0);
  const [mode, setMode] = useState<'category' | 'flex'>('category');
  const [flexBudget, setFlexBudget] = useState(0);
  const [loading, setLoading] = useState(true);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [monthRate, setMonthRate] = useState<ExchangeRate | null>(null);
  const toast = useToast();
  const { push: undoPush, pop: undoPop } = useUndoStack();

  // Ctrl-Z handler — unchanged from previous implementation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      const label = undoPop();
      if (label) toast.success(`Undone: ${label}`);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [undoPop, toast]);

  const nameById = useMemo(
    () => Object.fromEntries(Object.entries(categoryIdByName).map(([n, id]) => [id, n])),
    [categoryIdByName],
  );

  useEffect(() => { fetchBudgetMode().then(setMode).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    fetchPlan(currentYM)
      .then(data => {
        setServer(data);
        setExpectedIncome(data.expected_income);
        setFlexBudget(data.flex_budget);
        setLocalPlanned(null);
        setBudgetError(null);
      })
      .catch(err => setBudgetError(err.message))
      .finally(() => setLoading(false));
    fetchNearestRate(currentYM + '-15').then(setMonthRate).catch(() => {});
  }, [currentYM]);

  const rate = monthRate?.usd_to_crc ?? 500;

  const state: PlanState = useMemo(() => computePlan({
    groups: server?.category_groups ?? [],
    expectedIncome,
    rate,
    localPlanned,
    nameById,
  }), [server, expectedIncome, rate, localPlanned, nameById]);
```

- [ ] **Step 3: Planned edit handler with undo**

```tsx
  const handleSavePlanned = useCallback((catName: string, value: number) => {
    const catId = categoryIdByName[catName];
    const prev = state.cats[catName]?.planned ?? 0;
    setLocalPlanned(p => ({ ...(p ?? {}), [catName]: value }));
    if (catId) apiSetPlanned(currentYM, catId, value).catch(err => toast.error(err.message));
    undoPush(`Budget ${catName}`, () => {
      setLocalPlanned(p => ({ ...(p ?? {}), [catName]: prev }));
      if (catId) apiSetPlanned(currentYM, catId, prev).catch(err => toast.error(err.message));
    });
  }, [state, categoryIdByName, currentYM, toast, undoPush]);

  const handleSaveIncome = useCallback((value: number) => {
    const prev = expectedIncome;
    setExpectedIncome(value);
    apiSetIncome(currentYM, value).catch(err => toast.error(err.message));
    undoPush('Expected income', () => { setExpectedIncome(prev); apiSetIncome(currentYM, prev).catch(() => {}); });
  }, [expectedIncome, currentYM, toast, undoPush]);

  const handleSaveFlexBudget = useCallback((value: number) => {
    const prev = flexBudget;
    setFlexBudget(value);
    apiSetFlexBudget(currentYM, value).catch(err => toast.error(err.message));
    undoPush('Flex budget', () => { setFlexBudget(prev); apiSetFlexBudget(currentYM, prev).catch(() => {}); });
  }, [flexBudget, currentYM, toast, undoPush]);

  const handleModeChange = useCallback((m: 'category' | 'flex') => {
    setMode(m);
    apiSetBudgetMode(m).catch(err => toast.error(err.message));
  }, [toast]);

  const handleCopyPrevious = useCallback(() => {
    copyPreviousPlan(currentYM)
      .then(() => fetchPlan(currentYM))
      .then(data => { setServer(data); setExpectedIncome(data.expected_income); setFlexBudget(data.flex_budget); setLocalPlanned(null); })
      .catch(err => toast.error(err.message));
  }, [currentYM, toast]);

  const handleResetAll = useCallback(() => {
    const updates = resetAllPlanned(state);
    setLocalPlanned(updates);
    Object.entries(updates).forEach(([name, v]) => {
      const id = categoryIdByName[name];
      if (id) apiSetPlanned(currentYM, id, v).catch(() => {});
    });
  }, [state, categoryIdByName, currentYM]);
```

- [ ] **Step 4: Header — income, planned, left-to-budget, planned savings, mode toggle**

Replace the old RTA header block with:
```tsx
  const leftToBudget = state.leftToBudget;
  const plannedSavings = leftToBudget > 0 ? leftToBudget : 0;
```
Render (in the page header, near the month nav):
```tsx
  <div style={st.summaryHeader}>
    <HeaderStat label="Expected income">
      <BudgetCell value={expectedIncome} onSave={handleSaveIncome} fmt={fmt} />
    </HeaderStat>
    <HeaderStat label="Planned"><span>{fmt(state.plannedTotalCRC)}</span></HeaderStat>
    <HeaderStat label="Left to budget">
      <span style={{ color: leftToBudget < 0 ? T.neg : T.pos }}>{fmt(leftToBudget)}</span>
    </HeaderStat>
    <HeaderStat label="Planned savings"><span>{fmt(plannedSavings)}</span></HeaderStat>
    <div style={st.modeToggle}>
      {(['category', 'flex'] as const).map(m => (
        <button key={m} onClick={() => handleModeChange(m)} style={{ ...st.modePill, ...(mode === m ? st.modePillOn : {}) }}>
          {m === 'category' ? 'Category' : 'Flex'}
        </button>
      ))}
    </div>
  </div>
```
Add a small `HeaderStat` helper component and `summaryHeader`/`modeToggle`/`modePill`/`modePillOn` style entries (mirror `BudgetSummaryPane` card styling). `BudgetCell` already supports calculator entry; pass `fmt` as-is (income is CRC, no currency conversion).

- [ ] **Step 5: Category-mode table**

Keep the existing `GroupBlock` table structure but change columns to **Budgeted / Actual / Remaining**. For each category row, read from `state.cats[name]`:
- Budgeted cell → `BudgetCell value={c.planned} onSave={v => handleSavePlanned(name, v)}` (with `toDisplay`/`toRaw` for USD categories exactly as the old assigned cell did).
- Actual → `fmt(-c.activity)` (spending positive) — render red when `c.activity < 0`.
- Remaining → `fmt(c.remaining)`, red when negative.
- Progress bar → `pct = c.planned > 0 ? min((-c.activity)/c.planned, 1) : 0` (reuse existing bar markup).
- Rollover pill → when `c.rollover`, show `fmt(c.rolloverBalance)` as a pill next to the name.
Group subtotal cells use the server group CRC totals (`server.category_groups[i].planned` etc.) or recompute from `state.cats`. Remove the underfunded badge and target label entirely.

- [ ] **Step 6: Flex-mode view**

When `mode === 'flex'`, render three sections instead of the grouped table. Partition `Object.values(state.cats)` by `flexibility`:
```tsx
  const fixedCats = Object.values(state.cats).filter(c => c.flexibility === 'fixed');
  const flexibleCats = Object.values(state.cats).filter(c => c.flexibility === 'flexible');
  const nonMonthlyCats = Object.values(state.cats).filter(c => c.flexibility === 'non_monthly');
```
- **Fixed** section: editable `BudgetCell` per category (same `handleSavePlanned`), section header sums `fmt(server.fixed_planned)` planned vs `fmt(server.fixed_actual)` actual.
- **Flexible** section: a single editable number via `BudgetCell value={flexBudget} onSave={handleSaveFlexBudget}`, a progress bar of `server.flexible_actual / flexBudget`, then `flexibleCats` listed **read-only** (name + `fmt(-c.activity)` actual only).
- **Non-monthly** section: editable `BudgetCell` per category; show each category's `rolloverBalance` as an accumulating-funds figure (`fmt(c.rolloverBalance)`); section header sums `fmt(server.non_monthly_planned)` vs `fmt(server.non_monthly_actual)`.

- [ ] **Step 7: Summary pane wiring**

Compute `SummaryStats` from the current selection (multi-select kept). For a selection, sum planned/actual/remaining across selected categories (convert to CRC for mixed-currency selections using `rate`); set `rolloverBalance` to the sum of rollover balances when **all** selected categories are rollover, else `null`:
```tsx
  const summaryStats: SummaryStats = useMemo(() => {
    const sel = selectedCats.size ? [...selectedCats] : Object.keys(state.cats);
    let planned = 0, actual = 0, remaining = 0, roll = 0; let allRoll = sel.length > 0;
    for (const name of sel) {
      const c = state.cats[name]; if (!c) continue;
      const k = (n: number) => c.currency === 'USD' ? n * rate : n;
      planned += k(c.planned); actual += k(-c.activity); remaining += k(c.remaining);
      if (c.rollover) roll += k(c.rolloverBalance); else allRoll = false;
    }
    return { planned, actual, remaining, rolloverBalance: allRoll ? roll : null };
  }, [selectedCats, state, rate]);
```

- [ ] **Step 8: Toolbar — drop quick-assign-underfunded, keep copy/reset**

Replace the quick-assign menu with two actions: "Copy last month" → `handleCopyPrevious`, "Reset all" → `handleResetAll`.

- [ ] **Step 9: Strip BudgetModals**

In `BudgetModals.tsx`: delete `MoveMoneyModal` and `TARGET_TYPES`/target UI. Keep `CategoryInspector` but change its props — drop `onSetTarget`/`onMoveMoney`; add controls for **rollover** (toggle) and **flexibility** (segmented `fixed|flexible|non_monthly`) that call back into a new `onUpdateCategoryMeta(catId, { rollover, flexibility })` handler. That handler (in `Budget.tsx`) calls `updateCategory(catId, { ...existing, rollover, flexibility })` then `onCategoriesChanged()`.

- [ ] **Step 10: Type-check the whole frontend**

Run: `cd frontend && npx tsc -b`
Expected: success (no errors). Fix references until clean. `Dashboard.tsx`/`Reports.tsx` may still reference removed APIs — if so, either complete Task 19/keep their old `fetchIncomeExpense` calls (still present) and only remove `fetchBudget`/`fetchAgeOfMoney` usage now to keep the build green.

- [ ] **Step 11: Lint**

Run: `cd frontend && npm run lint`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/components/Budget.tsx frontend/src/components/BudgetModals.tsx
git commit -m "feat(fe): redesign Budget into spending-plan page with category/flex modes"
```

---

# Phase 3 — Cash Flow page & Dashboard

## Task 17: Cash Flow page

**Files:**
- Create: `frontend/src/components/CashFlow.tsx`

- [ ] **Step 1: Build the page**

Reuse the SVG idiom from `Reports.tsx`. Data sources: `fetchSavings(from,to)` for the income/spending/savings/rate series, `fetchPlan(currentYM)` for the current-month summary + flexibility-bucket breakdown.

```tsx
import { useState, useEffect } from 'react';
import { T } from '../theme';
import { fetchSavings, fetchPlan } from '../api';
import type { PlanMonthAPI } from '../api';

interface Props { fmt: (n: number) => string; }

function lastNMonths(n: number): { from: string; to: string; months: string[] } {
  const now = new Date();
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return { from: months[0], to: months[months.length - 1], months };
}

export function CashFlow({ fmt }: Props) {
  const currentYM = new Date().toISOString().slice(0, 7);
  const [series, setSeries] = useState<{ month: string; income: number; expense: number; savings: number; rate: number }[]>([]);
  const [plan, setPlan] = useState<PlanMonthAPI | null>(null);

  useEffect(() => {
    const { from, to } = lastNMonths(12);
    fetchSavings(from, to).then(rows => setSeries(rows.map(r => ({
      ...r, income: r.income / 100, expense: r.expense / 100, savings: r.savings / 100,
    })))).catch(() => {});
    fetchPlan(currentYM).then(setPlan).catch(() => {});
  }, [currentYM]);

  const cur = series[series.length - 1];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={st.cardRow}>
        <Stat label="Income · this month" value={fmt(cur?.income ?? 0)} color={T.pos} />
        <Stat label="Spending · this month" value={fmt(cur?.expense ?? 0)} color={T.neg} />
        <Stat label="Savings" value={fmt(cur?.savings ?? 0)} color={(cur?.savings ?? 0) < 0 ? T.neg : T.pos} />
        <Stat label="Savings rate" value={`${Math.round((cur?.rate ?? 0) * 100)}%`} color={T.text} />
      </div>

      <Panel title="Income vs Spending">
        <IncomeSpendingChart data={series} />
      </Panel>

      {plan && (
        <Panel title="By flexibility — this month">
          <BucketBar label="Fixed" planned={plan.fixed_planned} actual={plan.fixed_actual} fmt={fmt} color={T.pos} />
          <BucketBar label="Flexible" planned={plan.flex_budget} actual={plan.flexible_actual} fmt={fmt} color="#f6c45a" />
          <BucketBar label="Non-monthly" planned={plan.non_monthly_planned} actual={plan.non_monthly_actual} fmt={fmt} color="#c084fc" />
        </Panel>
      )}
    </div>
  );
}

function IncomeSpendingChart({ data }: { data: { month: string; income: number; expense: number; savings: number }[] }) {
  const W = 660, H = 240, PL = 64, PR = 16, PT = 16, PB = 34;
  const iW = W - PL - PR, iH = H - PT - PB;
  if (data.length < 2) return <div style={{ padding: 24, color: T.textDim, fontSize: 13 }}>Not enough data</div>;
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense])) * 1.12 || 1;
  const toX = (i: number) => PL + (i / (data.length - 1)) * iW;
  const toY = (v: number) => PT + iH - (v / maxVal) * iH;
  const line = (key: 'income' | 'expense' | 'savings') => data.map((d, i) => `${toX(i)},${toY(d[key])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {data.map((d, i) => <text key={d.month} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="10.5" fill={T.textDim} fontFamily={T.sans}>{d.month.slice(2)}</text>)}
      <polyline points={line('income')} fill="none" stroke={T.pos} strokeWidth="2" />
      <polyline points={line('expense')} fill="none" stroke={T.neg} strokeWidth="2" />
      <polyline points={line('savings')} fill="none" stroke="#5b9dff" strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  );
}

function BucketBar({ label, planned, actual, fmt, color }: { label: string; planned: number; actual: number; fmt: (n: number) => string; color: string }) {
  const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
  const over = actual > planned && planned > 0;
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 13, color: T.textMid, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: T.mono, color: over ? T.neg : T.textMid }}>{fmt(actual)} <span style={{ color: T.textFaint }}>/ {fmt(planned)}</span></span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: over ? T.neg : color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={st.card}>
      <div style={st.cardLabel}>{label}</div>
      <div style={{ ...st.cardValue, color }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={st.panel}>
      <div style={st.panelHeader}>{title}</div>
      <div style={{ padding: '14px 18px' }}>{children}</div>
    </div>
  );
}

const st = {
  cardRow:     { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 },
  card:        { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '18px 20px', boxShadow: T.shadow },
  cardLabel:   { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginBottom: 10 },
  cardValue:   { fontSize: 26, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1 },
  panel:       { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow, marginBottom: 16 },
  panelHeader: { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}` },
};
```
Add `import type React from 'react';` if the lint config requires it for the `React.ReactNode` type.

- [ ] **Step 2: Commit** (wired into nav in Task 18)

```bash
git add frontend/src/components/CashFlow.tsx
git commit -m "feat(fe): cash flow page"
```

---

## Task 18: Nav + routing for Cash Flow

**Files:**
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the nav item**

In `Layout.tsx`, after the budget `NavItem` (line ~74) add:
```tsx
          <NavItem active={currentPage === 'cashflow'} onClick={() => onNavigate('cashflow')} icon={ICONS.reports} label="Cash Flow" />
```
(Reuse `ICONS.reports` or add a dedicated icon to the `ICONS` map if one exists; keep it simple — reuse is fine.)

- [ ] **Step 2: Route it in App.tsx**

Add the import:
```tsx
import { CashFlow } from './components/CashFlow';
```
After the `reports` route line add:
```tsx
          {page === 'cashflow' && <CashFlow fmt={fmtBound} />}
```

- [ ] **Step 3: Type-check + build**

Run: `cd frontend && npm run build`
Expected: success (tsc + vite build).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx frontend/src/App.tsx
git commit -m "feat(fe): add Cash Flow to navigation"
```

---

## Task 19: Dashboard cards

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

Swap RTA + overspent-alerts (which depended on the budget endpoint) for income/spending/savings-rate/left-to-budget sourced from `fetchPlan`.

- [ ] **Step 1: Replace the data load**

Change the import `fetchBudget` → `fetchPlan`. Replace the budget branch in `loadTxns`:
```tsx
      fetchPlan(currentYM).catch(err => { console.warn('fetchPlan failed', err); return null; }),
```
Replace the `if (budget)` block:
```tsx
        if (plan) {
          setThisMonthSpending(plan.actual_spending);
          setExpectedIncomeView(plan.expected_income);
          setLeftToBudget(plan.left_to_budget);
          setSavingsRate(plan.actual_income > 0 ? plan.actual_savings / plan.actual_income : 0);
          const bars = plan.category_groups.map(g => ({
            name: g.name,
            spent: g.activity < 0 ? -g.activity : 0,
            assigned: g.planned,
            color: GROUP_COLORS[g.name],
          }));
          setGroupSpend(bars);
        }
```
Replace the `readyToAssign`/`overspent` state declarations with:
```tsx
  const [expectedIncomeView, setExpectedIncomeView] = useState(0);
  const [leftToBudget, setLeftToBudget] = useState(0);
  const [savingsRate, setSavingsRate] = useState(0);
```
Remove the `overspent` state and the entire Budget-Alerts panel JSX (or repurpose it to show `leftToBudget`). Keep the Spending-by-Category panel (now "Budgeted vs Actual").

- [ ] **Step 2: Replace the stat cards**

```tsx
      <div style={st.cardRow}>
        <StatCard label="Net Worth" value={fmt(netWorth)} accent />
        <StatCard label={`Spent · ${currentMonthLabel}`} value={fmt(thisMonthSpending)} />
        <StatCard label="Savings rate" value={`${Math.round(savingsRate * 100)}%`} sub={`Left to budget ${fmt(leftToBudget)}`} subColor={leftToBudget < 0 ? T.neg : T.textDim} />
      </div>
```
(`expectedIncomeView` can feed a tooltip or a fourth card if desired; keep three cards to match the existing grid.)

- [ ] **Step 3: Build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: success, no errors. This is the clean-build gate for the whole frontend.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Dashboard.tsx
git commit -m "feat(fe): dashboard shows spending/savings-rate/left-to-budget"
```

---

# Phase 4 — Docs

## Task 20: Update PRDs, README, AGENTS.md

**Files:**
- Modify: `docs/prd/04-budgeting.md`, `docs/prd/00-project-overview.md`, `docs/prd/06-accounts-and-dashboard.md`, `docs/prd/07-reports-and-analytics.md`, `docs/prd/08-api-design.md`, `README.md`, `AGENTS.md`

- [ ] **Step 1: Rewrite `docs/prd/04-budgeting.md`**

Replace the zero-based content with the spending-plan model from the spec: expected income per month, planned per category, left-to-budget, opt-in rollover (negative carry allowed), flex budgeting (fixed/flexible/non-monthly + mode toggle), no targets, no RTA. Reference `monthly_plans`, `app_settings`, and the `categories.rollover`/`flexibility` columns. Rename the doc heading from "Zero-Based Budgeting" to "Spending Plan".

- [ ] **Step 2: Update `00-project-overview.md`, `README.md`, `AGENTS.md`**

Replace "zero-based budgeting" / "YNAB clone" positioning with "Monarch-style spending plan with cash flow tracking". In `AGENTS.md`, update the Project Context paragraph and remove "zero-based budgeting" from differentiators; note PRD 04 is now the spending-plan source of truth.

- [ ] **Step 3: Update `06-accounts-and-dashboard.md`**

Document the new dashboard cards (net worth, spending, savings rate, left to budget); remove RTA / Age of Money / budget-alerts references.

- [ ] **Step 4: Update `07-reports-and-analytics.md`**

Add the Cash Flow page (income vs spending, savings rate, flexibility-bucket breakdown) and the `GET /api/reports/savings` endpoint.

- [ ] **Step 5: Update `08-api-design.md`**

Replace `/api/budgets/*`, target, and move endpoints with the `/api/plan/*`, `/api/settings/budget-mode`, and `/api/reports/savings` endpoints, and note the extended `PUT /api/categories/{id}` body (`rollover`, `flexibility`).

- [ ] **Step 6: Commit**

```bash
git add docs/prd/00-project-overview.md docs/prd/04-budgeting.md docs/prd/06-accounts-and-dashboard.md docs/prd/07-reports-and-analytics.md docs/prd/08-api-design.md README.md AGENTS.md
git commit -m "docs: rewrite for spending-plan model"
```

---

# Final verification

- [ ] **Backend:** `make test` — all pass or skip; `cd server && go vet ./...` clean.
- [ ] **Frontend:** `cd frontend && npm run build && npm run lint` — clean.
- [ ] **Smoke (if Postgres available):** boot the stack, open the app: Spending Plan loads in Category mode, edit expected income and a category's budget (left-to-budget updates), toggle to Flex mode (three sections render), mark a category rollover via the inspector (balance pill appears), open Cash Flow (charts + buckets render), Dashboard shows savings rate. Old `/api/budgets/*` returns 404.
- [ ] **Self-review the diff** with `superpowers:requesting-code-review` before merging.
