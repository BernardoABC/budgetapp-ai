# Category Currency Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users switch a category's currency (CRC ↔ USD) from the category inspector, storing the currency per budget row so historical planned amounts are preserved in their original currency.

**Architecture:** A `currency` column is added to the `budgets` table; `UpsertPlanned` stores it, `GetAllPlannedUpToMonth` returns it via a new `PlannedRow` struct. The plan service uses per-row currency for conversions. The frontend adds a currency toggle to `CategoryInspector` and colored badge pills to the budget table, with badge colors customizable from the Tweaks panel.

**Tech Stack:** Go (pgx/v5), PostgreSQL, React + TypeScript, Vite

---

## File Map

| File | Change |
|------|--------|
| `server/internal/database/migrations/012_budget_currency.sql` | **Create** — adds `currency` column to `budgets` |
| `server/internal/repository/budget_repo.go` | **Modify** — `PlannedRow` struct, updated `PlannedEntry`, `GetAllPlannedUpToMonth`, `UpsertPlanned`, `BulkInsertPlannedIfAbsent` |
| `server/internal/repository/budget_repo_test.go` | **Modify** — update callers of changed signatures |
| `server/internal/service/plan_service.go` | **Modify** — `SetPlanned`, `CopyPrevious`, `ChangeCategoryCurrency`, `GetMonth`, `computeRolloverBalances` |
| `server/internal/service/plan_service_test.go` | **Modify** — add test proving history is preserved |
| `frontend/src/App.tsx` | **Modify** — `Tweaks` type, `TweaksPanel`, pass badge props to `Budget` |
| `frontend/src/components/Budget.tsx` | **Modify** — `Props`, `GroupBlockProps`, import `ACCENTS`/`AccentKey`, badge rendering, `handleChangeCurrency`, pass currency to inspector |
| `frontend/src/components/BudgetModals.tsx` | **Modify** — currency section in `CategoryInspector`, `onChangeCurrency` prop |

---

## Task 1: DB Migration — add `currency` to `budgets`

**Files:**
- Create: `server/internal/database/migrations/012_budget_currency.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 012_budget_currency.sql — record the currency each planned amount was entered in.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CRC';
```

- [ ] **Step 2: Verify migration applies**

Run the server once so migrations execute, then check:
```bash
psql "postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" \
  -c "\d budgets"
```
Expected: `currency` column present with default `'CRC'`.

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/012_budget_currency.sql
git commit -m "feat: add currency column to budgets table"
```

---

## Task 2: BudgetRepo — PlannedRow type and updated functions

**Files:**
- Modify: `server/internal/repository/budget_repo.go`
- Modify: `server/internal/repository/budget_repo_test.go`

- [ ] **Step 1: Write a failing test for per-currency upsert/get**

Add to `server/internal/repository/budget_repo_test.go` after `TestBudgetRepo_UpsertAndGetPlanned`:

```go
func TestBudgetRepo_UpsertPlanned_PreservesCurrency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	if err := repo.UpsertPlanned(ctx, catID, "2026-04-01", 8500, "USD"); err != nil {
		t.Fatal(err)
	}
	all, err := repo.GetAllPlannedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	row := all[catID]["2026-04-01"]
	if row.Amount != 8500 {
		t.Errorf("Amount: want 8500 got %d", row.Amount)
	}
	if row.Currency != "USD" {
		t.Errorf("Currency: want USD got %q", row.Currency)
	}
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run TestBudgetRepo_UpsertPlanned_PreservesCurrency ./internal/repository/
```
Expected: compile error — `UpsertPlanned` has wrong number of arguments and `GetAllPlannedUpToMonth` returns `int64` not a struct.

- [ ] **Step 3: Add `PlannedRow` struct and update `PlannedEntry` in `budget_repo.go`**

Replace the existing `PlannedEntry` type definition (around line 35) with:

```go
// PlannedRow is one row from the budgets table: amount + the currency it was entered in.
type PlannedRow struct {
	Amount   int64
	Currency string
}

type PlannedEntry struct {
	CategoryID string
	Month      string // YYYY-MM-DD (first of month)
	Planned    int64
	Currency   string
}
```

- [ ] **Step 4: Update `GetAllPlannedUpToMonth` to return `map[string]map[string]PlannedRow`**

Replace the existing `GetAllPlannedUpToMonth` function:

```go
func (r *BudgetRepo) GetAllPlannedUpToMonth(ctx context.Context, month string) (map[string]map[string]PlannedRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category_id::text, month::text, planned, currency
		FROM budgets
		WHERE month <= $1::date
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get planned up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]PlannedRow)
	for rows.Next() {
		var catID, m, currency string
		var planned int64
		if err := rows.Scan(&catID, &m, &planned, &currency); err != nil {
			return nil, fmt.Errorf("scan planned: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]PlannedRow)
		}
		out[catID][m] = PlannedRow{Amount: planned, Currency: currency}
	}
	return out, rows.Err()
}
```

- [ ] **Step 5: Update `UpsertPlanned` to accept and store `currency`**

Replace the existing `UpsertPlanned` function:

```go
func (r *BudgetRepo) UpsertPlanned(ctx context.Context, categoryID, month string, planned int64, currency string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO budgets (category_id, month, planned, currency)
		VALUES ($1::uuid, $2::date, $3, $4)
		ON CONFLICT (category_id, month) DO UPDATE
		SET planned    = EXCLUDED.planned,
		    currency   = EXCLUDED.currency,
		    updated_at = NOW()
	`, categoryID, month, planned, currency)
	if err != nil {
		return fmt.Errorf("upsert planned %s/%s: %w", categoryID, month, err)
	}
	return nil
}
```

- [ ] **Step 6: Update `BulkInsertPlannedIfAbsent` to propagate `currency`**

Replace the existing `BulkInsertPlannedIfAbsent` function:

```go
func (r *BudgetRepo) BulkInsertPlannedIfAbsent(ctx context.Context, entries []PlannedEntry) error {
	for _, e := range entries {
		cur := e.Currency
		if cur == "" {
			cur = "CRC"
		}
		_, err := r.pool.Exec(ctx, `
			INSERT INTO budgets (category_id, month, planned, currency)
			VALUES ($1::uuid, $2::date, $3, $4)
			ON CONFLICT (category_id, month) DO NOTHING
		`, e.CategoryID, e.Month, e.Planned, cur)
		if err != nil {
			return fmt.Errorf("bulk upsert %s/%s: %w", e.CategoryID, e.Month, err)
		}
	}
	return nil
}
```

- [ ] **Step 7: Fix existing tests that call the changed signatures**

In `budget_repo_test.go`:

**`TestBudgetRepo_UpsertAndGetPlanned`** — change the `UpsertPlanned` call and the assertion:
```go
// Change:
if err := repo.UpsertPlanned(ctx, catID, "2026-04-01", 120000); err != nil {
// To:
if err := repo.UpsertPlanned(ctx, catID, "2026-04-01", 120000, "CRC"); err != nil {

// Change:
if all[catID]["2026-04-01"] != 120000 {
    t.Errorf("want 120000 got %d", all[catID]["2026-04-01"])
}
// To:
if all[catID]["2026-04-01"].Amount != 120000 {
    t.Errorf("want 120000 got %d", all[catID]["2026-04-01"].Amount)
}
```

**`TestBudgetRepo_BulkInsertPlannedIfAbsent`** — add `Currency` to entries and update assertions:
```go
// Change:
entries := []repository.PlannedEntry{
    {CategoryID: catID1, Month: "2026-04-01", Planned: 50000},
    {CategoryID: catID2, Month: "2026-04-01", Planned: 80000},
}
// To:
entries := []repository.PlannedEntry{
    {CategoryID: catID1, Month: "2026-04-01", Planned: 50000, Currency: "CRC"},
    {CategoryID: catID2, Month: "2026-04-01", Planned: 80000, Currency: "USD"},
}

// Change:
if all[catID1]["2026-04-01"] != 50000 || all[catID2]["2026-04-01"] != 80000 {
    t.Errorf("bulk upsert failed: got %v", all)
}
// To:
if all[catID1]["2026-04-01"].Amount != 50000 || all[catID2]["2026-04-01"].Amount != 80000 {
    t.Errorf("bulk upsert failed: got %v", all)
}
if all[catID1]["2026-04-01"].Currency != "CRC" || all[catID2]["2026-04-01"].Currency != "USD" {
    t.Errorf("currency mismatch: %v", all)
}
```

**`TestBudgetRepo_ClearAllPlanned`** — fix the two `UpsertPlanned` calls:
```go
// Change both:
if err := repo.UpsertPlanned(ctx, catID, "2026-07-01", 10000); err != nil {
if err := repo.UpsertPlanned(ctx, catID, "2026-08-01", 20000); err != nil {
// To:
if err := repo.UpsertPlanned(ctx, catID, "2026-07-01", 10000, "CRC"); err != nil {
if err := repo.UpsertPlanned(ctx, catID, "2026-08-01", 20000, "CRC"); err != nil {
```

- [ ] **Step 8: Run all repo tests**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v ./internal/repository/
```
Expected: all tests pass including `TestBudgetRepo_UpsertPlanned_PreservesCurrency`.

- [ ] **Step 9: Commit**

```bash
git add server/internal/repository/budget_repo.go server/internal/repository/budget_repo_test.go
git commit -m "feat: PlannedRow per-row currency in BudgetRepo"
```

---

## Task 3: PlanService — per-row currency and preserve history on switch

**Files:**
- Modify: `server/internal/service/plan_service.go`
- Modify: `server/internal/service/plan_service_test.go`

- [ ] **Step 1: Write a failing test for currency preservation**

Add to `server/internal/service/plan_service_test.go`:

```go
func TestPlanService_ChangeCategoryCurrency_PreservesPlanned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewPlanService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	budgetRepo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	catID := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
	})

	if err := svc.SetPlanned(ctx, catID, "2026-05", 300000); err != nil {
		t.Fatalf("SetPlanned: %v", err)
	}
	if err := svc.ChangeCategoryCurrency(ctx, catID, "USD"); err != nil {
		t.Fatalf("ChangeCategoryCurrency: %v", err)
	}

	all, err := budgetRepo.GetAllPlannedUpToMonth(ctx, "2026-05-01")
	if err != nil {
		t.Fatal(err)
	}
	row := all[catID]["2026-05-01"]
	if row.Amount != 300000 {
		t.Errorf("planned amount must be preserved: got %d, want 300000", row.Amount)
	}
	if row.Currency != "CRC" {
		t.Errorf("row currency must stay CRC (original): got %q", row.Currency)
	}
}
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v -run TestPlanService_ChangeCategoryCurrency_PreservesPlanned ./internal/service/
```
Expected: compile error (repo return types changed) or test failure (history deleted).

- [ ] **Step 3: Update `computeRolloverBalances` signature and accumulation**

In `plan_service.go`, replace the `computeRolloverBalances` function signature and the accumulation line. The parameter type changes from `map[string]map[string]int64` to `map[string]map[string]repository.PlannedRow` for `plannedByCat`. The accumulation uses `.Amount` instead of the raw value.

Replace the entire `computeRolloverBalances` function:

```go
func (s *PlanService) computeRolloverBalances(
	groups []model.CategoryGroup,
	plannedByCat map[string]map[string]repository.PlannedRow,
	activity map[string]map[string]int64,
	firstOfMonth string,
) map[string]int64 {
	rollover := map[string]bool{}
	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		for _, c := range g.Categories {
			if c.Rollover || c.Flexibility == "non_monthly" {
				rollover[c.ID] = true
			}
		}
	}

	earliest := firstOfMonth
	for _, mm := range plannedByCat {
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
			acc += plannedByCat[catID][m].Amount + activity[catID][m]
		}
		bal[catID] = acc
	}
	return bal
}
```

- [ ] **Step 4: Update `GetMonth` to use per-row currency for `plannedCRC`**

In `plan_service.go`, inside `GetMonth`, find the section that reads `planned` for a category (around the `for _, c := range g.Categories` loop). Replace:

```go
planned := plannedByCat[c.ID][firstOfMonth]
act := activity[c.ID][firstOfMonth]
remaining := planned + act
```
with:
```go
plannedRow := plannedByCat[c.ID][firstOfMonth]
planned := plannedRow.Amount
act := activity[c.ID][firstOfMonth]
remaining := planned + act
```

And replace:
```go
plannedCRC := toCRC(planned, c.Currency)
```
with:
```go
plannedCRC := toCRC(planned, plannedRow.Currency)
```

The `PlanCategory` struct initialization keeps `Currency: c.Currency` (the category's current currency is still useful context for the frontend).

- [ ] **Step 5: Update `SetPlanned` to look up and store the category's current currency**

Replace the existing `SetPlanned` function:

```go
func (s *PlanService) SetPlanned(ctx context.Context, catID, month string, planned int64) error {
	currencies, err := s.catRepo.GetCurrencies(ctx, []string{catID})
	if err != nil {
		return fmt.Errorf("get category currency: %w", err)
	}
	currency := currencies[catID]
	if currency == "" {
		currency = "CRC"
	}
	return s.budgetRepo.UpsertPlanned(ctx, catID, month+"-01", planned, currency)
}
```

- [ ] **Step 6: Update `CopyPrevious` to propagate per-row currency**

In `CopyPrevious`, the `prevPlanned` variable is now `map[string]map[string]repository.PlannedRow`. Replace:

```go
for catID, mm := range prevPlanned {
    if v, ok := mm[prevKey]; ok && v > 0 {
        entries = append(entries, repository.PlannedEntry{CategoryID: catID, Month: month + "-01", Planned: v})
    }
}
```
with:
```go
for catID, mm := range prevPlanned {
    if row, ok := mm[prevKey]; ok && row.Amount > 0 {
        entries = append(entries, repository.PlannedEntry{
            CategoryID: catID, Month: month + "-01", Planned: row.Amount, Currency: row.Currency,
        })
    }
}
```

- [ ] **Step 7: Update `ChangeCategoryCurrency` to remove the `ClearAllPlanned` call**

Replace:

```go
func (s *PlanService) ChangeCategoryCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	if err := s.catRepo.UpdateCategoryCurrency(ctx, catID, newCurrency); err != nil {
		return fmt.Errorf("update category currency: %w", err)
	}
	return s.budgetRepo.ClearAllPlanned(ctx, catID)
}
```
with:
```go
func (s *PlanService) ChangeCategoryCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	return s.catRepo.UpdateCategoryCurrency(ctx, catID, newCurrency)
}
```

- [ ] **Step 8: Run all service and repo tests**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test -v ./internal/...
```
Expected: all tests pass including `TestPlanService_ChangeCategoryCurrency_PreservesPlanned`.

- [ ] **Step 9: Build the server to catch any remaining compile errors**

```bash
cd server && go build ./...
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add server/internal/service/plan_service.go server/internal/service/plan_service_test.go
git commit -m "feat: per-row currency in PlanService; preserve history on currency switch"
```

---

## Task 4: Frontend — badge colors in Tweaks + colored pill badges

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add `usdBadge` and `crcBadge` to `Tweaks` in `App.tsx`**

In `App.tsx`, replace:
```typescript
interface Tweaks { accent: AccentKey; density: string; }

const TWEAK_DEFAULTS = { accent: 'mint' as AccentKey, density: 'comfortable' };
```
with:
```typescript
interface Tweaks { accent: AccentKey; density: string; usdBadge: AccentKey; crcBadge: AccentKey; }

const TWEAK_DEFAULTS = { accent: 'mint' as AccentKey, density: 'comfortable', usdBadge: 'indigo' as AccentKey, crcBadge: 'amber' as AccentKey };
```

- [ ] **Step 2: Add USD Badge and CRC Badge swatch rows to `TweaksPanel` in `App.tsx`**

Inside `TweaksPanel`, after the Row Density `<div>` block and before the closing `</div>` of `twk.body`, add:

```tsx
<div>
  <div style={twk.label}>USD Badge</div>
  <div style={{ display: 'flex', gap: 9 }}>
    {(Object.entries(ACCENTS) as [AccentKey, typeof ACCENTS[AccentKey]][]).map(([k, a]) => (
      <button key={k} onClick={() => updateTweak('usdBadge', k)} title={k}
        style={{ width: 26, height: 26, borderRadius: '50%', background: a.c, border: 'none', cursor: 'pointer', boxShadow: tweaks.usdBadge === k ? `0 0 0 2px ${T.surface2}, 0 0 0 4px ${a.c}, 0 0 12px ${a.glow}` : 'none', transition: 'box-shadow 0.15s' }} />
    ))}
  </div>
</div>
<div>
  <div style={twk.label}>CRC Badge</div>
  <div style={{ display: 'flex', gap: 9 }}>
    {(Object.entries(ACCENTS) as [AccentKey, typeof ACCENTS[AccentKey]][]).map(([k, a]) => (
      <button key={k} onClick={() => updateTweak('crcBadge', k)} title={k}
        style={{ width: 26, height: 26, borderRadius: '50%', background: a.c, border: 'none', cursor: 'pointer', boxShadow: tweaks.crcBadge === k ? `0 0 0 2px ${T.surface2}, 0 0 0 4px ${a.c}, 0 0 12px ${a.glow}` : 'none', transition: 'box-shadow 0.15s' }} />
    ))}
  </div>
</div>
```

- [ ] **Step 3: Pass `usdBadge` and `crcBadge` to `Budget` in `App.tsx`**

Find the `<Budget .../>` render in `App.tsx` (it's inside the `{page === 'budget' && ...}` block). Add the two new props:

```tsx
{page === 'budget' && <Budget categoryGroups={categoryGroups} fmt={fmtBound} currency={currency} density={tweaks.density} categoryIdByName={categoryIdByName} onCategoriesChanged={reloadCategories} usdBadge={tweaks.usdBadge} crcBadge={tweaks.crcBadge} />}
```

- [ ] **Step 4: Add `ACCENTS` and `AccentKey` imports to `Budget.tsx`**

In `Budget.tsx`, replace the theme import line:
```typescript
import { T, GROUP_COLORS } from '../theme';
```
with:
```typescript
import { T, GROUP_COLORS, ACCENTS } from '../theme';
import type { AccentKey } from '../theme';
```

- [ ] **Step 5: Add `usdBadge` and `crcBadge` to `Props` and `GroupBlockProps` in `Budget.tsx`**

In `Budget.tsx`, update the `Props` interface:
```typescript
interface Props {
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  currency: string;
  density: string;
  categoryIdByName: Record<string, string>;
  onCategoriesChanged: () => void;
  usdBadge: AccentKey;
  crcBadge: AccentKey;
}
```

Update `GroupBlockProps` — add after the `onToggleGroupSelection` prop:
```typescript
usdBadge: AccentKey;
crcBadge: AccentKey;
```

Update the `Budget` function signature to destructure the new props:
```typescript
export function Budget({ categoryGroups, fmt, currency, density, categoryIdByName, onCategoriesChanged, usdBadge, crcBadge }: Props) {
```

Update `GroupBlock`'s destructuring inside the function body. Find the existing `const { group, gidx, ...} = props;` block. Add `usdBadge, crcBadge` at the end:
```typescript
const { group, gidx, color, catState, collapsed, onToggle, fmt, onSavePlanned, onOpenInspector,
  inspectorCat, rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat, onRenameGroup,
  onMoveGroup, onDeleteGroup, onReorderCat, catCurrencies, toDisplay, toRaw,
  selectedCats, onToggleCatSelection, onToggleGroupSelection, usdBadge, crcBadge } = props;
```

- [ ] **Step 6: Pass badge props from `Budget` to each `GroupBlock`**

In the `groups.map(...)` render block (around line 994), add the two new props to `<GroupBlock>`:
```tsx
usdBadge={usdBadge} crcBadge={crcBadge}
```

- [ ] **Step 7: Replace the symbol chip with a colored pill badge in `GroupBlock`**

In `GroupBlock`, find the `<td>` that contains the `BudgetCell` and the currency chip (around line 300–309). Replace the existing `<span>` chip:

```tsx
<span style={{ fontSize: 9, fontWeight: 700, color: T.textDim, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3, padding: '1px 4px', letterSpacing: '0.05em', flexShrink: 0 }}>
  {(catCurrencies[cat] ?? 'CRC') === 'USD' ? '$' : '₡'}
</span>
```

with:

```tsx
{(() => {
  const isUSD = (catCurrencies[cat] ?? 'CRC') === 'USD';
  const accent = ACCENTS[isUSD ? usdBadge : crcBadge];
  return (
    <span style={{ fontSize: 9, fontWeight: 800, color: accent.c, background: accent.dim, border: `1px solid ${accent.c}40`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.06em', flexShrink: 0 }}>
      {isUSD ? 'USD' : 'CRC'}
    </span>
  );
})()}
```

- [ ] **Step 8: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Budget.tsx
git commit -m "feat: colored currency badge pills with Tweaks customization"
```

---

## Task 5: Frontend — Currency section in CategoryInspector + Budget wiring

**Files:**
- Modify: `frontend/src/components/BudgetModals.tsx`
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add `onChangeCurrency` prop and `currency` state to `CategoryInspector`**

In `BudgetModals.tsx`, update the `InspectorProps` interface — add after `onUpdateCategoryMeta`:
```typescript
onChangeCurrency: (catId: string, currency: 'CRC' | 'USD') => void;
```

Update the `CategoryInspector` function signature to destructure the new prop:
```typescript
export function CategoryInspector({ cat, color, c, fmt, onClose, onUpdateCategoryMeta, onChangeCurrency, onHide, onDelete }: InspectorProps) {
```

Add currency local state alongside the existing `rollover` and `flexibility` states:
```typescript
const [currency, setCurrency] = useState<'CRC' | 'USD'>(c.currency as 'CRC' | 'USD');
```

Add the commit handler alongside `commitRollover` and `commitFlexibility`:
```typescript
const commitCurrency = (next: 'CRC' | 'USD') => {
  setCurrency(next);
  onChangeCurrency(c.id, next);
};
```

- [ ] **Step 2: Add the Currency section to the inspector JSX**

In `CategoryInspector`'s JSX, add a new section after the Flexibility section and before the `<div style={insp.actions}>` block:

```tsx
<div style={insp.section}>
  <div style={insp.sectionTitle}>Currency</div>
  <div style={insp.typeGrid2}>
    {(['CRC', 'USD'] as const).map(cur => (
      <button key={cur} onClick={() => commitCurrency(cur)} style={{ ...insp.typeBtn, ...(currency === cur ? insp.typeOn : {}) }}>{cur}</button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Add `typeGrid2` to the `insp` styles object**

In the `insp` styles object at the bottom of `BudgetModals.tsx`, add after `typeGrid3`:
```typescript
typeGrid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
```

- [ ] **Step 4: Add `changeCategoryCurrency` to imports in `Budget.tsx`**

In `Budget.tsx`, find the API import block (lines 9–13). Add `changeCategoryCurrency` to it:
```typescript
import {
  fetchPlan, setPlanned as apiSetPlanned, copyPreviousPlan, setExpectedIncome as apiSetIncome,
  setFlexBudget as apiSetFlexBudget, fetchBudgetMode, setBudgetMode as apiSetBudgetMode,
  createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory,
  fetchNearestRate, changeCategoryCurrency,
} from '../api';
```

- [ ] **Step 5: Add `handleChangeCurrency` to `Budget.tsx`**

In `Budget.tsx`, add `handleChangeCurrency` alongside `handleUpdateCategoryMeta` (around line 543):

```typescript
const handleChangeCurrency = useCallback((catId: string, newCurrency: 'CRC' | 'USD') => {
  changeCategoryCurrency(catId, newCurrency)
    .then(() => { onCategoriesChanged(); setFetchCounter(c => c + 1); })
    .catch(err => toast.error(err.message));
}, [onCategoriesChanged, toast]);
```

- [ ] **Step 6: Pass `onChangeCurrency` to `CategoryInspector` in `Budget.tsx`**

Find the `<CategoryInspector>` render block (around line 1020). Add the new prop:
```tsx
<CategoryInspector cat={inspectorCat} color={colorFor(grpName, grpIdx)} c={state.cats[inspectorCat]}
  fmt={fmtMonth} onClose={() => setInspectorCat(null)}
  onUpdateCategoryMeta={handleUpdateCategoryMeta}
  onChangeCurrency={handleChangeCurrency}
  onHide={hideCat}
  onDelete={cat => { const g = groups.find(x => x.categories.includes(cat)); if (g) deleteCat(g.id, cat); }} />
```

- [ ] **Step 7: Type-check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Run all backend tests one final time**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" \
  go test ./...
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/BudgetModals.tsx frontend/src/components/Budget.tsx
git commit -m "feat: currency toggle in CategoryInspector"
```
