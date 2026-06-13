# Income Category Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-visible "Income" category group (Paychecks, Interest, Other Income) to the budget table where planned amounts auto-sum into Expected Income and actual inflows display with income-appropriate math.

**Architecture:** An `is_income` boolean on `category_groups` flows through the full stack — DB → Go model/repo/handler → plan service → JSON response → frontend types → engine → GroupBlock renderer. The plan service accumulates income category planned amounts directly into `ExpectedIncome` (replacing the manual field); the frontend engine does the same locally so edits are reflected immediately.

**Tech Stack:** PostgreSQL, Go 1.22, React 18, TypeScript

---

## File Map

| File | Change |
|---|---|
| `server/internal/database/migrations/013_income_categories.sql` | NEW — schema + seed data |
| `server/internal/model/category.go` | Add `IsIncome bool` to `CategoryGroup` |
| `server/internal/model/budget.go` | Add `IsIncome bool` to `PlanGroup` |
| `server/internal/testutil/helpers.go` | Add `SeedIncomeGroup`, `SeedCategoryInGroup` |
| `server/internal/repository/category_repo.go` | Include `is_income` in `ListGroups` |
| `server/internal/handler/categories.go` | Include `IsIncome` in `groupResp` |
| `server/internal/handler/budget.go` | Add `"is_income"` to `planMonthToJSON`; set `pg.IsIncome` |
| `server/internal/service/plan_service.go` | Income-aware computation; remove `SetExpectedIncome` |
| `server/internal/service/plan_service_test.go` | Update existing test; add income group tests |
| `server/main.go` | Remove `PUT /api/plan/{month}/income` route |
| `frontend/src/api.ts` | Add `is_income` to types; remove `setExpectedIncome` |
| `frontend/src/App.tsx` | Pass `is_income` in group mapping |
| `frontend/src/engine.ts` | Accumulate income planned into `expectedIncome`; skip from `plannedTotalCRC` |
| `frontend/src/components/Budget.tsx` | Remove income state/handler; read-only Expected Income; flip income group display |

---

## Task 1: DB Migration

**Files:**
- Create: `server/internal/database/migrations/013_income_categories.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 013_income_categories.sql
ALTER TABLE category_groups ADD COLUMN IF NOT EXISTS is_income BOOLEAN NOT NULL DEFAULT false;

-- Seed the Income group (sort_order -1 puts it above all expense groups)
INSERT INTO category_groups (name, sort_order, is_income)
VALUES ('Income', -1, true)
ON CONFLICT (name) DO UPDATE SET is_income = true, sort_order = -1;

-- Seed default income categories
INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Paychecks', 0 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;

INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Interest', 1 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;

INSERT INTO categories (group_id, name, sort_order)
SELECT id, 'Other Income', 2 FROM category_groups WHERE name = 'Income'
ON CONFLICT (group_id, name) DO NOTHING;
```

- [ ] **Step 2: Restart the server to apply migration (dev DB)**

```bash
make server
# Expected: server starts, migration runner logs "013_income_categories.sql"
```

- [ ] **Step 3: Verify schema and seed data**

```bash
kubectl exec -n homelab deploy/budgetapp-server -- psql "$DATABASE_URL" \
  -c "\d category_groups" \
  -c "SELECT name, sort_order, is_income FROM category_groups ORDER BY sort_order;" \
  -c "SELECT g.name AS grp, c.name AS cat FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE g.is_income=true;"
```

Expected: `is_income` column present; Income group with Paychecks/Interest/Other Income rows.

- [ ] **Step 4: Reset test DB to pick up new migration**

```bash
make test-db-reset
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/internal/database/migrations/013_income_categories.sql
git commit -m "feat(db): add is_income to category_groups, seed Income group"
```

---

## Task 2: Go Models

**Files:**
- Modify: `server/internal/model/category.go`
- Modify: `server/internal/model/budget.go`

- [ ] **Step 1: Add `IsIncome` to `CategoryGroup`**

In `server/internal/model/category.go`, change the `CategoryGroup` struct:

```go
type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SortOrder  int        `json:"sort_order"`
	Hidden     bool       `json:"hidden"`
	IsSystem   bool       `json:"is_system"`
	IsIncome   bool       `json:"is_income"`
	Categories []Category `json:"categories"`
}
```

- [ ] **Step 2: Add `IsIncome` to `PlanGroup`**

In `server/internal/model/budget.go`, change the `PlanGroup` struct:

```go
type PlanGroup struct {
	ID         string
	Name       string
	IsIncome   bool
	Planned    int64 // CRC
	Activity   int64 // CRC
	Remaining  int64 // CRC
	Categories []PlanCategory
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add server/internal/model/category.go server/internal/model/budget.go
git commit -m "feat(model): add IsIncome to CategoryGroup and PlanGroup"
```

---

## Task 3: Testutil Helpers

**Files:**
- Modify: `server/internal/testutil/helpers.go`

- [ ] **Step 1: Add `SeedIncomeGroup` and `SeedCategoryInGroup`**

Append to `server/internal/testutil/helpers.go`:

```go
// SeedIncomeGroup inserts a category group with is_income=true and returns its ID.
func SeedIncomeGroup(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO category_groups (name, sort_order, is_income) VALUES ($1, -1, true) RETURNING id::text`,
		fmt.Sprintf("TestIncomeGroup-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedIncomeGroup: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM category_groups WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedCategoryInGroup inserts a category into the given group and returns the category ID.
func SeedCategoryInGroup(t *testing.T, pool *pgxpool.Pool, groupID string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid, $2, 0) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategoryInGroup: %v", err)
	}
	return id
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/internal/testutil/helpers.go
git commit -m "test(testutil): add SeedIncomeGroup and SeedCategoryInGroup helpers"
```

---

## Task 4: Repo — ListGroups Includes is_income

**Files:**
- Modify: `server/internal/repository/category_repo.go`

- [ ] **Step 1: Write the failing test**

Add to `server/internal/repository/category_repo_test.go`:

```go
func TestCategoryRepo_ListGroups_IncomeFlag(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := NewCategoryRepo(pool)
	ctx := context.Background()

	gid := testutil.SeedIncomeGroup(t, pool)

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	var found *model.CategoryGroup
	for i := range groups {
		if groups[i].ID == gid {
			found = &groups[i]
		}
	}
	if found == nil {
		t.Fatal("income group not found in ListGroups result")
	}
	if !found.IsIncome {
		t.Errorf("IsIncome = false, want true")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run TestCategoryRepo_ListGroups_IncomeFlag ./internal/repository/
```

Expected: FAIL — `IsIncome = false, want true` (column not yet read).

- [ ] **Step 3: Update `ListGroups` to select and scan `is_income`**

In `server/internal/repository/category_repo.go`, update `ListGroups`:

```go
func (r *CategoryRepo) ListGroups(ctx context.Context) ([]model.CategoryGroup, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system, g.is_income,
		       c.id::text, c.name, c.hidden, c.sort_order, c.is_system, c.currency,
		       c.rollover, c.flexibility
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
		var gHidden, gSystem, gIncome bool
		var cID, cName *string
		var cHidden *bool
		var cSort *int
		var cSystem *bool
		var cCurrency *string
		var cRollover *bool
		var cFlexibility *string

		if err := rows.Scan(&gID, &gName, &gSort, &gHidden, &gSystem, &gIncome,
			&cID, &cName, &cHidden, &cSort, &cSystem, &cCurrency, &cRollover, &cFlexibility); err != nil {
			return nil, fmt.Errorf("scan category row: %w", err)
		}

		if _, ok := groupMap[gID]; !ok {
			groupMap[gID] = &model.CategoryGroup{
				ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden,
				IsSystem: gSystem, IsIncome: gIncome,
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
			roll := false
			if cRollover != nil {
				roll = *cRollover
			}
			flex := "flexible"
			if cFlexibility != nil {
				flex = *cFlexibility
			}
			groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
				ID: *cID, GroupID: gID, Name: *cName,
				Currency: cur, Hidden: *cHidden, SortOrder: *cSort, IsSystem: sys,
				Rollover: roll, Flexibility: flex,
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

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run TestCategoryRepo_ListGroups_IncomeFlag ./internal/repository/
```

Expected: PASS.

- [ ] **Step 5: Run full repo tests**

```bash
make test
```

Expected: all pass (or skip if no test DB — not FAIL).

- [ ] **Step 6: Commit**

```bash
git add server/internal/repository/category_repo.go server/internal/repository/category_repo_test.go
git commit -m "feat(repo): include is_income in ListGroups query"
```

---

## Task 5: Handler — Categories Response

**Files:**
- Modify: `server/internal/handler/categories.go`

- [ ] **Step 1: Add `IsIncome` to `groupResp` and the response mapping**

In `server/internal/handler/categories.go`, update `ListGroups`:

```go
func (h *CategoryHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListGroups(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type catResp struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Currency    string `json:"currency"`
		Hidden      bool   `json:"hidden"`
		SortOrder   int    `json:"sort_order"`
		IsSystem    bool   `json:"is_system"`
		Rollover    bool   `json:"rollover"`
		Flexibility string `json:"flexibility"`
	}
	type groupResp struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		SortOrder  int       `json:"sort_order"`
		Hidden     bool      `json:"hidden"`
		IsSystem   bool      `json:"is_system"`
		IsIncome   bool      `json:"is_income"`
		Categories []catResp `json:"categories"`
	}

	resp := make([]groupResp, len(groups))
	for i, g := range groups {
		cats := make([]catResp, len(g.Categories))
		for j, c := range g.Categories {
			cats[j] = catResp{
				ID: c.ID, Name: c.Name, Currency: c.Currency,
				Hidden: c.Hidden, SortOrder: c.SortOrder, IsSystem: c.IsSystem,
				Rollover: c.Rollover, Flexibility: c.Flexibility,
			}
		}
		resp[i] = groupResp{
			ID: g.ID, Name: g.Name, SortOrder: g.SortOrder,
			Hidden: g.Hidden, IsSystem: g.IsSystem, IsIncome: g.IsIncome,
			Categories: cats,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/categories.go
git commit -m "feat(handler): include is_income in GET /api/categories response"
```

---

## Task 6: Service — Income-Aware Plan Computation

**Files:**
- Modify: `server/internal/service/plan_service.go`
- Modify: `server/internal/service/plan_service_test.go`

- [ ] **Step 1: Write the failing income test and update the broken LeftToBudget test**

Replace the content of the relevant tests in `server/internal/service/plan_service_test.go`.

Replace `TestPlanService_LeftToBudget` (the old one calls `SetExpectedIncome` which is being removed):

```go
func TestPlanService_LeftToBudget_DerivedFromIncomeCategories(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewPlanService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	// Income category
	incomeGroupID := testutil.SeedIncomeGroup(t, pool)
	incomeCatID := testutil.SeedCategoryInGroup(t, pool, incomeGroupID)

	// Expense category
	expenseCatID := testutil.SeedCategory(t, pool)

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, incomeCatID)
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, expenseCatID)
	})

	if err := svc.SetPlanned(ctx, incomeCatID, "2026-05", 1000000); err != nil {
		t.Fatalf("SetPlanned income: %v", err)
	}
	if err := svc.SetPlanned(ctx, expenseCatID, "2026-05", 300000); err != nil {
		t.Fatalf("SetPlanned expense: %v", err)
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

func TestPlanService_IncomeGroupAppearsInCategoryGroups(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewPlanService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	incomeGroupID := testutil.SeedIncomeGroup(t, pool)
	incomeCatID := testutil.SeedCategoryInGroup(t, pool, incomeGroupID)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, incomeCatID)
	})

	if err := svc.SetPlanned(ctx, incomeCatID, "2026-06", 500000); err != nil {
		t.Fatalf("SetPlanned: %v", err)
	}

	pm, err := svc.GetMonth(ctx, "2026-06")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	var incomeGroup *model.PlanGroup
	for i := range pm.CategoryGroups {
		if pm.CategoryGroups[i].ID == incomeGroupID {
			incomeGroup = &pm.CategoryGroups[i]
		}
	}
	if incomeGroup == nil {
		t.Fatal("income group not found in CategoryGroups")
	}
	if !incomeGroup.IsIncome {
		t.Error("PlanGroup.IsIncome = false, want true")
	}
	// Income planned must NOT be in PlannedTotal
	if pm.PlannedTotal != 0 {
		t.Errorf("PlannedTotal = %d, want 0 (income excluded)", pm.PlannedTotal)
	}
	// Income planned IS the ExpectedIncome
	if pm.ExpectedIncome != 500000 {
		t.Errorf("ExpectedIncome = %d, want 500000", pm.ExpectedIncome)
	}
}
```

Also delete the old `TestPlanService_LeftToBudget` function (the one that calls `svc.SetExpectedIncome`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run "TestPlanService_LeftToBudget_DerivedFromIncomeCategories|TestPlanService_IncomeGroupAppearsInCategoryGroups" ./internal/service/
```

Expected: compilation error or FAIL (SetExpectedIncome doesn't exist yet / income logic not implemented).

- [ ] **Step 3: Update `plan_service.go` — income-aware GetMonth, remove SetExpectedIncome**

Replace the `GetMonth` method body in `server/internal/service/plan_service.go`:

```go
func (s *PlanService) GetMonth(ctx context.Context, month string) (*model.PlanMonth, error) {
	firstOfMonth := month + "-01"
	lastOfMonth := lastDay(month)

	groups, err := s.catRepo.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	plannedByCat, err := s.budgetRepo.GetAllPlannedUpToMonth(ctx, firstOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get planned: %w", err)
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

	rollBalance := s.computeRolloverBalances(groups, plannedByCat, activity, firstOfMonth)

	pm := &model.PlanMonth{
		Month:      month,
		Mode:       mode,
		FlexBudget: plan.FlexBudget,
		// ExpectedIncome starts at 0; accumulated below from income categories
	}

	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		pg := model.PlanGroup{ID: g.ID, Name: g.Name, IsIncome: g.IsIncome}
		for _, c := range g.Categories {
			planned := plannedByCat[c.ID][firstOfMonth]
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
			pg.Planned += plannedCRC
			pg.Activity += actCRC
			pg.Remaining += toCRC(remaining, c.Currency)

			if g.IsIncome {
				// Income category planned → ExpectedIncome; activity is inflow (positive)
				pm.ExpectedIncome += plannedCRC
			} else {
				pm.PlannedTotal += plannedCRC

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
				default:
					pm.FlexibleActual += spendingCRC
				}
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
```

Also delete the `SetExpectedIncome` method entirely from `plan_service.go`:

```go
// DELETE this entire method:
// func (s *PlanService) SetExpectedIncome(ctx context.Context, month string, amount int64) error { ... }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run "TestPlanService_LeftToBudget_DerivedFromIncomeCategories|TestPlanService_IncomeGroupAppearsInCategoryGroups" ./internal/service/
```

Expected: both PASS.

- [ ] **Step 5: Run all tests**

```bash
make test
```

Expected: all pass or skip — no failures.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/plan_service.go server/internal/service/plan_service_test.go
git commit -m "feat(service): income-aware plan computation, derive ExpectedIncome from categories"
```

---

## Task 7: Handler — Plan Group Response Includes is_income

**Files:**
- Modify: `server/internal/handler/budget.go`

- [ ] **Step 1: Add `"is_income"` to `planMonthToJSON`**

In `server/internal/handler/budget.go`, update the `planMonthToJSON` function's groups loop:

```go
groups = append(groups, map[string]any{
    "id": g.ID, "name": g.Name, "is_income": g.IsIncome,
    "planned": g.Planned, "activity": g.Activity, "remaining": g.Remaining,
    "categories": cats,
})
```

(Only the `groups = append(...)` line changes — add `"is_income": g.IsIncome`.)

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/budget.go
git commit -m "feat(handler): include is_income in plan group JSON response"
```

---

## Task 8: Remove Old Income Route

**Files:**
- Modify: `server/main.go`

- [ ] **Step 1: Delete the `SetIncome` route**

In `server/main.go`, delete this line:

```go
mux.HandleFunc("PUT /api/plan/{month}/income", budgets.SetIncome)
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: exits 0. Note: `budgets.SetIncome` handler still exists in `budget.go` — it is now unreachable but not yet deleted (safe, can be cleaned up later).

- [ ] **Step 3: Commit**

```bash
git add server/main.go
git commit -m "feat(routes): retire PUT /api/plan/{month}/income endpoint"
```

---

## Task 9: Frontend — API Types

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add `is_income` to `CategoryGroup`, `CategoryGroupAPI`, `PlanGroupAPI`; remove `setExpectedIncome`**

In `frontend/src/api.ts`:

**Change `CategoryGroup` interface (line ~15):**
```ts
export interface CategoryGroup {
  id: string;
  name: string;
  categories: string[];
  is_income?: boolean;
}
```

**Change `CategoryGroupAPI` interface (line ~61):**
```ts
export interface CategoryGroupAPI {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  is_system: boolean;
  is_income: boolean;
  categories: CategoryItemAPI[];
}
```

**Change `PlanGroupAPI` interface (line ~396):**
```ts
export interface PlanGroupAPI {
  id: string;
  name: string;
  is_income: boolean;
  planned: number;
  activity: number;
  remaining: number;
  categories: PlanCategoryAPI[];
}
```

**Delete the `setExpectedIncome` function (around line ~481):**
```ts
// DELETE this entire function:
// export async function setExpectedIncome(month: string, amount: number): Promise<void> {
//   await apiFetch(`/plan/${month}/income`, {
//     method: 'PUT',
//     body: JSON.stringify({ amount: Math.round(amount * 100) }),
//   });
// }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npm run build 2>&1 | head -30
```

Expected: may have errors from `Budget.tsx` still referencing `setExpectedIncome` — that's fine, fixed in Task 11.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(api): add is_income to group types, retire setExpectedIncome"
```

---

## Task 10: Frontend — App.tsx Passes is_income

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Pass `is_income` in both places where raw groups are mapped**

In `server/App.tsx`, in `reloadCategories` (around line ~86), change:

```ts
setCategoryGroups(rawGroups.filter(g => !g.is_system).map(g => ({
  id: g.id,
  name: g.name,
  categories: g.categories.map(c => c.name),
  is_income: g.is_income,
})));
```

And in the `useEffect` (around line ~113), apply the identical change:

```ts
setCategoryGroups(rawGroups.filter(g => !g.is_system).map(g => ({
  id: g.id,
  name: g.name,
  categories: g.categories.map(c => c.name),
  is_income: g.is_income,
})));
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Expected: no errors for App.tsx (Budget.tsx errors expected until Task 11).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(app): pass is_income through CategoryGroup mapping"
```

---

## Task 11: Frontend — Engine

**Files:**
- Modify: `frontend/src/engine.ts`

- [ ] **Step 1: Update `ComputeInput` and `computePlan` to derive expectedIncome from income categories**

Replace the entire `engine.ts` file:

```ts
import type { PlanGroupAPI } from './api';

export interface PlanCatState {
  cat: string;
  id: string;
  currency: string;
  flexibility: 'fixed' | 'flexible' | 'non_monthly';
  rollover: boolean;
  planned: number;
  activity: number;       // negative = spending, positive = income received
  remaining: number;      // planned + activity
  rolloverBalance: number;
}

export interface PlanState {
  cats: Record<string, PlanCatState>;
  plannedTotalCRC: number; // expense categories only
  expectedIncome: number;  // income categories only
  leftToBudget: number;
}

interface ComputeInput {
  groups: PlanGroupAPI[];
  rate: number;            // USD→CRC
  localPlanned: Record<string, number> | null;
  nameById: Record<string, string>;
}

const toCRC = (amount: number, currency: string, rate: number) =>
  currency === 'USD' ? amount * rate : amount;

export function computePlan(input: ComputeInput): PlanState {
  const { groups, rate, localPlanned, nameById } = input;
  const cats: Record<string, PlanCatState> = {};
  let plannedTotalCRC = 0;
  let expectedIncome = 0;

  for (const g of groups) {
    for (const c of g.categories) {
      const name = nameById[c.id] ?? c.name;
      const planned = localPlanned?.[name] ?? c.planned;
      const remaining = planned + c.activity;
      const accumulates = c.rollover || c.flexibility === 'non_monthly';
      const rolloverBalance = accumulates
        ? c.rollover_balance + (planned - c.planned)
        : 0;
      cats[name] = {
        cat: name, id: c.id, currency: c.currency,
        flexibility: c.flexibility, rollover: c.rollover,
        planned, activity: c.activity, remaining, rolloverBalance,
      };
      if (g.is_income) {
        expectedIncome += toCRC(planned, c.currency, rate);
      } else {
        plannedTotalCRC += toCRC(planned, c.currency, rate);
      }
    }
  }

  return {
    cats,
    plannedTotalCRC,
    expectedIncome,
    leftToBudget: expectedIncome - plannedTotalCRC,
  };
}

// resetAllPlanned returns a planned-override map setting every category to 0.
export function resetAllPlanned(state: PlanState): Record<string, number> {
  const out: Record<string, number> = {};
  Object.values(state.cats).forEach(c => { out[c.cat] = 0; });
  return out;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -30
```

Expected: errors in Budget.tsx where `expectedIncome` is passed to `computePlan` — fixed in Task 12.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine.ts
git commit -m "feat(engine): derive expectedIncome from income categories, exclude from plannedTotalCRC"
```

---

## Task 12: Frontend — Budget.tsx

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

This is the biggest change. Do it in four sub-steps.

### Sub-step A: Remove income state, handler, and api import

- [ ] **Step 1: Remove `setExpectedIncome` from the import**

Find the line (around line 10):
```ts
fetchPlan, setPlanned as apiSetPlanned, copyPreviousPlan, setExpectedIncome as apiSetIncome,
```

Change to:
```ts
fetchPlan, setPlanned as apiSetPlanned, copyPreviousPlan,
```

- [ ] **Step 2: Remove `expectedIncome` state and `handleSaveIncome`**

Delete the state declaration (around line 385):
```ts
const [expectedIncome, setExpectedIncome] = useState(0);
```

Delete the `handleSaveIncome` callback (around lines 502–510):
```ts
const handleSaveIncome = useCallback((value: number) => {
  const prev = expectedIncome;
  setExpectedIncome(value);
  apiSetIncome(currentYM, value).catch(err => toast.error(err.message));
  undoPush({
    label: 'Undo income change',
    undo: () => { setExpectedIncome(prev); apiSetIncome(currentYM, prev).catch(() => {}); },
  });
}, [expectedIncome, currentYM, toast, undoPush]);
```

- [ ] **Step 3: Remove `setExpectedIncome` from the data fetch handler (around line 530)**

Find:
```ts
.then(data => { setServer(data); setExpectedIncome(data.expected_income); setFlexBudget(data.flex_budget); setLocalPlanned(null); })
```

Change to:
```ts
.then(data => { setServer(data); setFlexBudget(data.flex_budget); setLocalPlanned(null); })
```

- [ ] **Step 4: Remove `expectedIncome` from the `useMemo` that calls `computePlan`**

Find (around line 450):
```ts
}), [server, expectedIncome, rate, localPlanned, nameById]);
```

Also find where `computePlan` is called and remove `expectedIncome` from the input:

Find the `computePlan({...})` call (around line 448):
```ts
const state = useMemo(() => computePlan({
  groups: server?.category_groups ?? [],
  expectedIncome,
  rate: rate ?? 1,
  localPlanned,
  nameById,
}), [server, expectedIncome, rate, localPlanned, nameById]);
```

Change to:
```ts
const state = useMemo(() => computePlan({
  groups: server?.category_groups ?? [],
  rate: rate ?? 1,
  localPlanned,
  nameById,
}), [server, rate, localPlanned, nameById]);
```

### Sub-step B: Replace editable Expected Income with read-only display

- [ ] **Step 5: Replace the BudgetCell with a read-only span**

Find (around line 909):
```tsx
<HeaderStat label="Expected income">
  <BudgetCell value={expectedIncome} onSave={handleSaveIncome} fmt={fmt} toDisplay={toDisplayFn} toRaw={toRawFn} />
</HeaderStat>
```

Change to:
```tsx
<HeaderStat label="Expected income">
  <span>{fmt(state.expectedIncome)}</span>
</HeaderStat>
```

### Sub-step C: Add `isIncome` prop to GroupBlock

- [ ] **Step 6: Add `isIncome` to `GroupBlockProps`**

In the `GroupBlockProps` interface (around line 99), add after `usdBadge`/`crcBadge`:
```ts
isIncome: boolean;
```

- [ ] **Step 7: Destructure `isIncome` in `GroupBlock`**

In `GroupBlock`'s destructuring (around line 135), add `isIncome` to the destructured list:
```ts
const { group, gidx, color, catState, collapsed, onToggle, fmt, onSavePlanned, onOpenInspector,
  inspectorCat, rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat, onRenameGroup,
  onMoveGroup, onDeleteGroup, onReorderCat, catCurrencies, toDisplay, toRaw,
  selectedCats, onToggleCatSelection, onToggleGroupSelection, usdBadge, crcBadge, isIncome } = props;
```

- [ ] **Step 8: Flip Actual and Remaining display in the group header row**

Find the group header total cells (around line 202):
```tsx
<td style={{ ...st.groupNum, color: T.textDim }}>{fmt(-totActivity)}</td>
<td style={{ ...st.groupNum, color: totRemaining < 0 ? T.neg : T.text }}>{fmt(totRemaining)}</td>
```

Change to:
```tsx
<td style={{ ...st.groupNum, color: T.textDim }}>
  {isIncome ? fmt(totActivity) : fmt(-totActivity)}
</td>
<td style={{
  ...st.groupNum,
  color: isIncome
    ? (totPlanned - totActivity < 0 ? T.pos : totPlanned - totActivity > 0 ? T.warn : T.textDim)
    : (totRemaining < 0 ? T.neg : T.text),
}}>
  {isIncome ? fmt(totPlanned - totActivity) : fmt(totRemaining)}
</td>
```

- [ ] **Step 9: Add green left-border accent on income group header row**

Find the `<tr style={st.groupRow}>` opening tag for the group header and add a conditional border:
```tsx
<tr style={{ ...st.groupRow, ...(isIncome ? { borderLeft: `3px solid ${T.pos}` } : {}) }}>
```

- [ ] **Step 10: Flip category row Actual and Remaining for income groups**

Find the category row Actual and Remaining cells (around line 311):
```tsx
<td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none', color: c.activity < 0 ? T.neg : T.textDim }}>{fmt(-c.activity)}</td>
<td style={{ ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none', color: c.remaining < 0 ? T.neg : T.text }}>{fmt(c.remaining)}</td>
```

Change to:
```tsx
<td style={{
  ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none',
  color: isIncome ? T.pos : (c.activity < 0 ? T.neg : T.textDim),
}}>
  {isIncome ? fmt(c.activity) : fmt(-c.activity)}
</td>
<td style={{
  ...st.numCell, padding: rowPad + ' 16px 5px', borderBottom: 'none',
  color: isIncome
    ? (c.planned - c.activity < 0 ? T.pos : c.planned - c.activity > 0 ? T.warn : T.textDim)
    : (c.remaining < 0 ? T.neg : T.text),
}}>
  {isIncome ? fmt(c.planned - c.activity) : fmt(c.remaining)}
</td>
```

### Sub-step D: Pass `isIncome` when rendering GroupBlocks

- [ ] **Step 11: Pass `isIncome` to each GroupBlock**

Find the `GroupBlock` render call (around line 994):
```tsx
{groups.map((g, gi) => (
  <GroupBlock key={g.id} group={g} gidx={gi} color={colorFor(g.name, gi)} catState={state.cats}
    collapsed={!!collapsed[g.id]} onToggle={() => toggleGroup(g.id)} fmt={fmtMonth} onSavePlanned={handleSavePlanned}
    ...
    selectedCats={selectedCats} onToggleCatSelection={toggleCatSelection} onToggleGroupSelection={toggleGroupSelection}
    usdBadge={usdBadge} crcBadge={crcBadge} />
```

Add `isIncome={!!g.is_income}` to the props list.

- [ ] **Step 12: Verify TypeScript compiles clean**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "node_modules"
```

Expected: zero errors.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "feat(budget): income group — read-only expected income, flipped actual/remaining display"
```

---

## Task 13: Deploy and Verify

- [ ] **Step 1: Build and deploy**

```bash
make ship
```

Expected: exits 0, pods restart.

- [ ] **Step 2: Verify income group appears at top of budget table**

Open `http://budget.home.arpa`, navigate to Budget. Confirm:
- "Income" group appears above "Immediate Obligations" and other expense groups
- Three categories: Paychecks, Interest, Other Income
- Group row has a green left-border accent
- All three categories show $0 Budgeted / $0 Actual / $0 Remaining

- [ ] **Step 3: Budget a Paychecks planned amount**

Click the Budgeted cell for Paychecks, type `3000`, press Enter (in USD mode). Confirm:
- Paychecks Budgeted updates to $3,000.00
- "Expected income" header stat updates to $3,000.00 (auto-sum)
- "Left to budget" updates correctly

- [ ] **Step 4: Add an income transaction**

In Accounts, create an income transaction categorized as "Paychecks" for $2,500. Navigate back to Budget. Confirm:
- Paychecks Actual shows $2,500.00 (positive, green)
- Paychecks Remaining shows $500.00 (income still expected, yellow)

- [ ] **Step 5: Verify expense categories are unaffected**

Check that "Immediate Obligations" and other expense groups still show Actual as negative (spending) and Remaining with correct expense-budget math.

- [ ] **Step 6: Final commit if any fixups were needed**

```bash
git add -p && git commit -m "fix: post-deploy income group adjustments"
```
