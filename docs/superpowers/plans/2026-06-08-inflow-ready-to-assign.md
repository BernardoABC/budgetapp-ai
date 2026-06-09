# Inflow: Ready to Assign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system-level "Inflow: Ready to Assign" category so inflows (salary, etc.) can be explicitly categorized, increasing RTA correctly — with a shared grouped `CategorySelect` component replacing all flat category dropdowns.

**Architecture:** A new `is_system` flag on categories/groups gates the budget engine and the budget table from ever seeing inflow transactions as category activity, while a new `CategorySelect` React component renders system categories as a visually distinct top group and regular categories under optgroups.

**Tech Stack:** PostgreSQL 16, Go (pgx/v5), React + TypeScript (Vite), Tailwind (inline styles via `T` theme object)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/internal/database/migrations/008_inflow_category.sql` | Create | Add `is_system` columns, seed system group+category, migrate NULL-category inflows |
| `server/internal/model/category.go` | Modify | Add `IsSystem bool` to `Category` and `CategoryGroup` |
| `server/internal/repository/category_repo.go` | Modify | Scan `is_system` in `ListGroups` |
| `server/internal/handler/categories.go` | Modify | Include `is_system` in JSON response structs |
| `server/internal/service/budget_service.go` | Modify | Skip system categories in rollover loop and budget response |
| `server/internal/service/budget_service_test.go` | Modify | Add test: system category inflow does not reduce RTA |
| `frontend/src/api.ts` | Modify | Add `is_system: boolean` to `CategoryItemAPI` and `CategoryGroupAPI` |
| `frontend/src/App.tsx` | Modify | Store `rawCategoryGroups: CategoryGroupAPI[]` state, pass to children |
| `frontend/src/components/CategorySelect.tsx` | Create | Shared grouped category picker; system group at top, regular groups below |
| `frontend/src/components/Accounts.tsx` | Modify | Use `CategorySelect` in edit row; add optgroups to filter/bulk selects |
| `frontend/src/components/Import.tsx` | Modify | Use `CategorySelect` in Step2 rows and RulesManager |

---

### Task 1: DB Migration — `is_system` columns, system category, data migration

**Files:**
- Create: `server/internal/database/migrations/008_inflow_category.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 008_inflow_category.sql

-- 1. Add is_system to category_groups
ALTER TABLE category_groups
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 2. Add is_system to categories
ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- 3. Seed the Inflows system group + Inflow: Ready to Assign category,
--    then migrate all uncategorized positive transactions to it.
DO $$
DECLARE
    grp_id UUID;
    cat_id UUID;
BEGIN
    -- Insert system group (idempotent)
    INSERT INTO category_groups (name, sort_order, is_system)
    VALUES ('Inflows', 0, true)
    ON CONFLICT (name) DO UPDATE SET is_system = true
    RETURNING id INTO grp_id;

    -- Insert system category (idempotent)
    INSERT INTO categories (group_id, name, sort_order, is_system)
    VALUES (grp_id, 'Inflow: Ready to Assign', 0, true)
    ON CONFLICT (group_id, name) DO UPDATE SET is_system = true
    RETURNING id INTO cat_id;

    -- Migrate existing uncategorized inflows
    UPDATE transactions
    SET category_id = cat_id
    WHERE amount > 0 AND category_id IS NULL;
END;
$$;
```

- [ ] **Step 2: Verify the migration runs without error**

```bash
cd server && go run ./... 2>&1 | head -5
```

Expected: server starts (or exits with "config" error — either way, no migration error). Alternatively, if a test DB is running:

```bash
cd server && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable go test ./internal/... -run NOMATCH 2>&1 | grep -i "migration\|error" || echo "migrations ok"
```

- [ ] **Step 3: Commit**

```bash
git add server/internal/database/migrations/008_inflow_category.sql
git commit -m "feat: add is_system columns and seed Inflow: Ready to Assign category"
```

---

### Task 2: Go model — add `IsSystem` to Category and CategoryGroup

**Files:**
- Modify: `server/internal/model/category.go`

- [ ] **Step 1: Add `IsSystem bool` to both structs**

Replace the entire file content with:

```go
package model

type Category struct {
	ID        string `json:"id"`
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	Hidden    bool   `json:"hidden"`
	SortOrder int    `json:"sort_order"`
	IsSystem  bool   `json:"is_system"`
}

type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SortOrder  int        `json:"sort_order"`
	Hidden     bool       `json:"hidden"`
	IsSystem   bool       `json:"is_system"`
	Categories []Category `json:"categories"`
}

type CreateCategoryReq struct {
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateCategoryReq struct {
	Name      string `json:"name"`
	Hidden    bool   `json:"hidden"`
	SortOrder int    `json:"sort_order"`
}

type CreateGroupReq struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateGroupReq struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Hidden    bool   `json:"hidden"`
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 3: Commit**

```bash
git add server/internal/model/category.go
git commit -m "feat: add IsSystem field to Category and CategoryGroup models"
```

---

### Task 3: Repository — scan `is_system` in `ListGroups`

**Files:**
- Modify: `server/internal/repository/category_repo.go`

- [ ] **Step 1: Update the `ListGroups` query and scan**

Find the `ListGroups` function. Replace the query string and scan call:

Old query:
```go
rows, err := r.pool.Query(ctx, `
    SELECT g.id::text, g.name, g.sort_order, g.hidden,
           c.id::text, c.name, c.hidden, c.sort_order
    FROM category_groups g
    LEFT JOIN categories c ON c.group_id = g.id AND c.hidden = false
    ORDER BY g.sort_order, g.name, c.sort_order, c.name
`)
```

New query:
```go
rows, err := r.pool.Query(ctx, `
    SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system,
           c.id::text, c.name, c.hidden, c.sort_order, c.is_system
    FROM category_groups g
    LEFT JOIN categories c ON c.group_id = g.id AND c.hidden = false
    ORDER BY g.sort_order, g.name, c.sort_order, c.name
`)
```

Old variable declarations and scan:
```go
var gID, gName string
var gSort int
var gHidden bool
var cID, cName *string
var cHidden *bool
var cSort *int

if err := rows.Scan(&gID, &gName, &gSort, &gHidden,
    &cID, &cName, &cHidden, &cSort); err != nil {
```

New variable declarations and scan:
```go
var gID, gName string
var gSort int
var gHidden, gSystem bool
var cID, cName *string
var cHidden *bool
var cSort *int
var cSystem *bool

if err := rows.Scan(&gID, &gName, &gSort, &gHidden, &gSystem,
    &cID, &cName, &cHidden, &cSort, &cSystem); err != nil {
```

Old group construction inside `if _, ok := groupMap[gID]; !ok {`:
```go
groupMap[gID] = &model.CategoryGroup{
    ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden,
}
```

New:
```go
groupMap[gID] = &model.CategoryGroup{
    ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden, IsSystem: gSystem,
}
```

Old category append:
```go
if cID != nil {
    groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
        ID: *cID, GroupID: gID, Name: *cName,
        Hidden: *cHidden, SortOrder: *cSort,
    })
}
```

New:
```go
if cID != nil {
    sys := false
    if cSystem != nil {
        sys = *cSystem
    }
    groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
        ID: *cID, GroupID: gID, Name: *cName,
        Hidden: *cHidden, SortOrder: *cSort, IsSystem: sys,
    })
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd server && go build ./...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/internal/repository/category_repo.go
git commit -m "feat: scan is_system columns in ListGroups repository query"
```

---

### Task 4: Handler — expose `is_system` in categories API response

**Files:**
- Modify: `server/internal/handler/categories.go`

- [ ] **Step 1: Add `IsSystem` to the response structs in `ListGroups`**

Find the `ListGroups` handler method. Replace the two local struct definitions:

Old:
```go
type catResp struct {
    ID        string `json:"id"`
    Name      string `json:"name"`
    Hidden    bool   `json:"hidden"`
    SortOrder int    `json:"sort_order"`
}
type groupResp struct {
    ID         string    `json:"id"`
    Name       string    `json:"name"`
    SortOrder  int       `json:"sort_order"`
    Hidden     bool      `json:"hidden"`
    Categories []catResp `json:"categories"`
}
```

New:
```go
type catResp struct {
    ID        string `json:"id"`
    Name      string `json:"name"`
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
```

Find the loop that builds the response. Replace the inner category assignment:

Old:
```go
cats[j] = catResp{ID: c.ID, Name: c.Name, Hidden: c.Hidden, SortOrder: c.SortOrder}
```

New:
```go
cats[j] = catResp{ID: c.ID, Name: c.Name, Hidden: c.Hidden, SortOrder: c.SortOrder, IsSystem: c.IsSystem}
```

Replace the group assignment:

Old:
```go
resp[i] = groupResp{ID: g.ID, Name: g.Name, SortOrder: g.SortOrder, Hidden: g.Hidden, Categories: cats}
```

New:
```go
resp[i] = groupResp{ID: g.ID, Name: g.Name, SortOrder: g.SortOrder, Hidden: g.Hidden, IsSystem: g.IsSystem, Categories: cats}
```

- [ ] **Step 2: Verify compilation**

```bash
cd server && go build ./...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/categories.go
git commit -m "feat: expose is_system in category groups API response"
```

---

### Task 5: Budget service — exclude system categories from RTA and budget table

**Files:**
- Modify: `server/internal/service/budget_service.go`

- [ ] **Step 1: Skip system categories when building `allCatIDs`**

Find this block (around line 52):
```go
var allCatIDs []string
for _, g := range groups {
    for _, c := range g.Categories {
        allCatIDs = append(allCatIDs, c.ID)
    }
}
```

Replace with:
```go
var allCatIDs []string
for _, g := range groups {
    if g.IsSystem {
        continue
    }
    for _, c := range g.Categories {
        allCatIDs = append(allCatIDs, c.ID)
    }
}
```

- [ ] **Step 2: Skip system groups in the `groupBudgets` builder**

Find this block (around line 126):
```go
for _, g := range groups {
    gb := model.CategoryGroupBudget{
        ID:   g.ID,
        Name: g.Name,
    }
```

Replace with:
```go
for _, g := range groups {
    if g.IsSystem {
        continue
    }
    gb := model.CategoryGroupBudget{
        ID:   g.ID,
        Name: g.Name,
    }
```

- [ ] **Step 3: Verify compilation**

```bash
cd server && go build ./...
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/budget_service.go
git commit -m "feat: exclude system categories from RTA and budget table calculations"
```

---

### Task 6: Budget service test — system category inflow increases RTA

**Files:**
- Modify: `server/internal/service/budget_service_test.go`

- [ ] **Step 1: Write the failing test**

Add this test at the bottom of `budget_service_test.go`:

```go
func TestBudgetService_GetMonth_SystemCategoryInflowIncreasesRTA(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo)
	ctx := context.Background()

	// Get the seeded system category ID.
	var sysCatID string
	err := pool.QueryRow(ctx,
		`SELECT id::text FROM categories WHERE is_system = true AND name = 'Inflow: Ready to Assign' LIMIT 1`,
	).Scan(&sysCatID)
	if err != nil {
		t.Skipf("system category not seeded (run migrations): %v", err)
	}

	// Create an on-budget account with a balance of 500000.
	accID := testutil.SeedOnBudgetAccount(t, pool)
	pool.Exec(ctx, `UPDATE accounts SET balance = 500000 WHERE id = $1::uuid`, accID)
	t.Cleanup(func() {
		pool.Exec(ctx, `UPDATE accounts SET balance = 0 WHERE id = $1::uuid`, accID)
	})

	// Inflow transaction categorized to the system category.
	txID := testutil.SeedTransaction(t, pool, accID, sysCatID, "2026-04-15", 500000)
	_ = txID

	result, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	// RTA = balance (500000) - totalAvailable (0, system cat excluded) = 500000.
	if result.ReadyToAssign != 500000 {
		t.Errorf("want RTA=500000, got %d", result.ReadyToAssign)
	}

	// System group must NOT appear in CategoryGroups.
	for _, g := range result.CategoryGroups {
		if g.Name == "Inflows" {
			t.Errorf("system group 'Inflows' must not appear in budget CategoryGroups")
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails before the fix**

(Skip this step if Task 5 is already done — the fix is already in place.)

```bash
cd server && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable go test ./internal/service/... -run TestBudgetService_GetMonth_SystemCategoryInflowIncreasesRTA -v
```

Expected after fix: `PASS`.

- [ ] **Step 3: Run all budget service tests to confirm no regressions**

```bash
cd server && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable go test ./internal/service/... -v
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/budget_service_test.go
git commit -m "test: verify system category inflow increases RTA and is excluded from budget table"
```

---

### Task 7: TypeScript API — add `is_system` to category types

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add `is_system` to `CategoryItemAPI` and `CategoryGroupAPI`**

Find `CategoryItemAPI` (around line 56):
```ts
export interface CategoryItemAPI {
  id: string;
  name: string;
  hidden: boolean;
  sort_order: number;
}
```

Replace with:
```ts
export interface CategoryItemAPI {
  id: string;
  name: string;
  hidden: boolean;
  sort_order: number;
  is_system: boolean;
}
```

Find `CategoryGroupAPI` (around line 63):
```ts
export interface CategoryGroupAPI {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  categories: CategoryItemAPI[];
}
```

Replace with:
```ts
export interface CategoryGroupAPI {
  id: string;
  name: string;
  sort_order: number;
  hidden: boolean;
  is_system: boolean;
  categories: CategoryItemAPI[];
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no type errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add is_system to CategoryItemAPI and CategoryGroupAPI types"
```

---

### Task 8: App.tsx — store and thread `rawCategoryGroups`

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add `rawCategoryGroups` state and update `reloadCategories`**

Find the state declarations (around line 69):
```ts
const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
const [categoryIdByName, setCategoryIdByName] = useState<Record<string, string>>({});
```

Add after them:
```ts
const [rawCategoryGroups, setRawCategoryGroups] = useState<CategoryGroupAPI[]>([]);
```

Find the `reloadCategories` callback. It currently ends with:
```ts
setCategoryGroups(rawGroups.map(g => ({
  id: g.id,
  name: g.name,
  categories: g.categories.map(c => c.name),
})));
```

Add `setRawCategoryGroups(rawGroups);` immediately after that line (before the closing `})`).

Find the `useEffect` initial load. It has the same pattern — a call to `setCategoryGroups(rawGroups.map(...))`. Add `setRawCategoryGroups(rawGroups);` after that line too.

- [ ] **Step 2: Pass `rawCategoryGroups` to `Accounts` and `ImportWizard`**

Find the JSX where `<Accounts ... />` is rendered and add the prop:
```tsx
rawCategoryGroups={rawCategoryGroups}
```

Find the JSX where `<ImportWizard ... />` is rendered and add the prop:
```tsx
rawCategoryGroups={rawCategoryGroups}
```

- [ ] **Step 3: Verify TypeScript compilation** (will have errors until Tasks 9–11 update the prop types — that's expected at this stage)

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "rawCategoryGroups" | head -5
```

Expected: errors about missing props on `Accounts` and `ImportWizard` (fixed in later tasks).

- [ ] **Step 4: Commit** (after Tasks 9–11 pass typecheck)

Hold this commit — combine with Task 9 or do it after all frontend tasks pass typecheck.

---

### Task 9: New component — `CategorySelect`

**Files:**
- Create: `frontend/src/components/CategorySelect.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import type { CategoryGroupAPI } from '../api';
import { T } from '../theme';

interface CategorySelectProps {
  value: string;
  onChange: (id: string | null) => void;
  rawCategoryGroups: CategoryGroupAPI[];
  style?: React.CSSProperties;
  placeholder?: string;
}

export function CategorySelect({ value, onChange, rawCategoryGroups, style, placeholder = '—' }: CategorySelectProps) {
  const systemGroups = rawCategoryGroups.filter(g => g.is_system && !g.hidden);
  const regularGroups = rawCategoryGroups.filter(g => !g.is_system && !g.hidden);

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value || null)}
      style={style}
    >
      <option value="">{placeholder}</option>
      {systemGroups.map(g => (
        <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
          {g.categories.filter(c => !c.hidden).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
      {regularGroups.map(g => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.filter(c => !c.hidden).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "CategorySelect" | head -5
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/CategorySelect.tsx
git commit -m "feat: add CategorySelect component with system group at top and optgroups"
```

---

### Task 10: Accounts.tsx — use CategorySelect in edit row, add optgroups to filter/bulk selects

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add `rawCategoryGroups` prop to the component and `EditableRow`**

Find the `EditableRowProps` interface definition. Add:
```ts
rawCategoryGroups: CategoryGroupAPI[];
```

Find the `EditableRow` function signature. It receives these props — add `rawCategoryGroups` to both the interface and the destructured parameters.

Find the `Props` interface for the main `Accounts` component. Add:
```ts
rawCategoryGroups: CategoryGroupAPI[];
```

Find the `Accounts` function signature and add `rawCategoryGroups` to the destructured props.

- [ ] **Step 2: Import `CategorySelect` and `CategoryGroupAPI`**

At the top of the file add to the imports:
```ts
import { CategorySelect } from './CategorySelect';
import type { CategoryGroupAPI } from '../api';
```

- [ ] **Step 3: Replace the edit-row category `<select>` with `CategorySelect`**

In `EditableRow`, find the inline `<select>` for category (inside the `else` branch that renders the edit UI — the one with `value={draft.category ?? ''}`).

It currently reads:
```tsx
<select
  value={draft.category ?? ''}
  onChange={e => {
    if (e.target.value === '__transfer__') {
      setDraft(d => ({ ...d, category: null }));
      onLink(t);
    } else {
      setDraft(d => ({ ...d, category: e.target.value || null }));
    }
  }}
  style={st.inlineSelect}
>
  <option value="">—</option>
  <option value="__transfer__" style={{ color: 'var(--text-faint, #666)' }}>↔ Transfer to account…</option>
  {categories.map(c => <option key={c} value={c}>{c}</option>)}
</select>
```

Note: this select uses category **names** as values (`draft.category` is a name string). `CategorySelect` uses IDs. To keep the existing data flow (which converts to ID at save time via `categoryIdByName`), keep using names here BUT add optgroups manually:

```tsx
<select
  value={draft.category ?? ''}
  onChange={e => {
    if (e.target.value === '__transfer__') {
      setDraft(d => ({ ...d, category: null }));
      onLink(t);
    } else {
      setDraft(d => ({ ...d, category: e.target.value || null }));
    }
  }}
  style={st.inlineSelect}
>
  <option value="">—</option>
  <option value="__transfer__" style={{ color: 'var(--text-faint, #666)' }}>↔ Transfer to account…</option>
  {rawCategoryGroups.filter(g => g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
  {rawCategoryGroups.filter(g => !g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={g.name}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
</select>
```

(This keeps the name-based value contract; `categories: string[]` prop can be removed from `EditableRowProps` if no longer used, but leave it if used elsewhere in the component.)

- [ ] **Step 4: Add optgroups to the filter bar category select**

Find the filter bar `<select>` (around line 557):
```tsx
<select value={filter.category} onChange={e => { setFilter(f => ({ ...f, category: e.target.value })); setPageNum(1); }} style={st.filterSelect}>
  <option value="">All categories</option>
  <option value="__uncategorized__">Uncategorized</option>
  {categories.map(c => <option key={c} value={c}>{c}</option>)}
</select>
```

Replace with:
```tsx
<select value={filter.category} onChange={e => { setFilter(f => ({ ...f, category: e.target.value })); setPageNum(1); }} style={st.filterSelect}>
  <option value="">All categories</option>
  <option value="__uncategorized__">Uncategorized</option>
  {rawCategoryGroups.filter(g => g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
  {rawCategoryGroups.filter(g => !g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={g.name}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
</select>
```

- [ ] **Step 5: Add optgroups to the bulk categorize select**

Find the bulk bar `<select>` (around line 571):
```tsx
<select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={st.filterSelect}>
  <option value="">Set category…</option>
  <option value="__uncategorized__">— Uncategorized —</option>
  {categories.map(c => <option key={c} value={c}>{c}</option>)}
</select>
```

Replace with:
```tsx
<select value={bulkCat} onChange={e => setBulkCat(e.target.value)} style={st.filterSelect}>
  <option value="">Set category…</option>
  <option value="__uncategorized__">— Uncategorized —</option>
  {rawCategoryGroups.filter(g => g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
  {rawCategoryGroups.filter(g => !g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={g.name}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.name}>{c.name}</option>
      ))}
    </optgroup>
  ))}
</select>
```

- [ ] **Step 6: Pass `rawCategoryGroups` through to `EditableRow` at the call site**

Find where `EditableRow` is rendered inside the `Accounts` component. Add `rawCategoryGroups={rawCategoryGroups}` to the JSX props.

- [ ] **Step 7: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only Import.tsx errors remaining from Task 11).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Accounts.tsx frontend/src/App.tsx
git commit -m "feat: add grouped optgroups to category selects in Accounts view"
```

---

### Task 11: Import.tsx — replace flat selects with grouped selects in Step2 and RulesManager

**Files:**
- Modify: `frontend/src/components/Import.tsx`

- [ ] **Step 1: Add `rawCategoryGroups` prop to `ImportWizard` and thread it down**

Find the `Props` interface for `ImportWizard` (around line 206):
```ts
interface Props {
  accounts: Accounts;
  categoryGroups: CategoryGroup[];
  categoryIdByName: Record<string, string>;
  fmt: (n: number) => string;
  onNavigate: (page: string) => void;
}
```

Add `rawCategoryGroups: CategoryGroupAPI[];` to it.

Add `import type { CategoryGroupAPI } from '../api';` to the import section at the top.

Find the `ImportWizard` function and add `rawCategoryGroups` to its destructured props.

- [ ] **Step 2: Update `Step2` to accept `rawCategoryGroups` and render grouped options**

Find the `Step2` function signature:
```ts
function Step2({ parsed, allCategoryNames, categoryIdByName, onSetCategory, onToggleInclude, fmt, onNext, onBack }: {
  parsed: ParsedRow[];
  allCategoryNames: string[];
  categoryIdByName: Record<string, string>;
  ...
```

Add `rawCategoryGroups: CategoryGroupAPI[];` to the type and `rawCategoryGroups` to the destructured params.

Find the inner `<select>` in Step2 (around line 133):
```tsx
<select
  value={row.categoryId ?? ''}
  onChange={e => onSetCategory(row.tempId, e.target.value || null)}
  style={{ ...st.inlineSelect, borderColor: row.categoryId ? T.border : T.warn, color: row.categoryId ? T.text : T.warn }}
>
  <option value="">— assign —</option>
  {allCategoryNames.map(name => (
    <option key={name} value={categoryIdByName[name] ?? ''}>{name}</option>
  ))}
</select>
```

Replace with:
```tsx
<select
  value={row.categoryId ?? ''}
  onChange={e => onSetCategory(row.tempId, e.target.value || null)}
  style={{ ...st.inlineSelect, borderColor: row.categoryId ? T.border : T.warn, color: row.categoryId ? T.text : T.warn }}
>
  <option value="">— assign —</option>
  {rawCategoryGroups.filter(g => g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </optgroup>
  ))}
  {rawCategoryGroups.filter(g => !g.is_system && !g.hidden).map(g => (
    <optgroup key={g.id} label={g.name}>
      {g.categories.filter(c => !c.hidden).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </optgroup>
  ))}
</select>
```

Note: Step2 used to receive `allCategoryNames: string[]` for a flat list. After this change it no longer needs that prop for the select (the select is now ID-based using `rawCategoryGroups` directly). Keep `allCategoryNames` in the signature for now since the autoCat count display line still uses `parsed.filter(p => p.autoCat).length` which doesn't depend on it — verify no other usage before removing.

- [ ] **Step 3: Pass `rawCategoryGroups` to `Step2` at its call site**

Find where `<Step2 ... />` is rendered inside `ImportWizard`. Add `rawCategoryGroups={rawCategoryGroups}`.

- [ ] **Step 4: Update `RulesManager` to accept `rawCategoryGroups` and render grouped options**

Find the `RulesManager` function signature:
```ts
function RulesManager({ categoryIdByName, idToName, allCategoryNames }: {
  categoryIdByName: Record<string, string>;
  idToName: Record<string, string>;
  allCategoryNames: string[];
})
```

Add `rawCategoryGroups: CategoryGroupAPI[];` to the type and `rawCategoryGroups` to destructured params.

Find the `<select>` inside `RulesManager` that lists categories (around line 617):
```tsx
{allCategoryNames.map(name => (
  <option key={name} value={categoryIdByName[name] ?? ''}>{name}</option>
))}
```

Replace it (keep the surrounding `<select>` element, just replace the options):
```tsx
{rawCategoryGroups.filter(g => g.is_system && !g.hidden).map(g => (
  <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
    {g.categories.filter(c => !c.hidden).map(c => (
      <option key={c.id} value={c.id}>{c.name}</option>
    ))}
  </optgroup>
))}
{rawCategoryGroups.filter(g => !g.is_system && !g.hidden).map(g => (
  <optgroup key={g.id} label={g.name}>
    {g.categories.filter(c => !c.hidden).map(c => (
      <option key={c.id} value={c.id}>{c.name}</option>
    ))}
  </optgroup>
))}
```

- [ ] **Step 5: Pass `rawCategoryGroups` to `RulesManager` at its call site**

Find where `<RulesManager ... />` is rendered inside `ImportWizard`. Add `rawCategoryGroups={rawCategoryGroups}`.

- [ ] **Step 6: Verify TypeScript compilation — full clean**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Import.tsx
git commit -m "feat: add grouped optgroups to category selects in Import wizard"
```

---

### Task 12: Final verification

- [ ] **Step 1: Run all Go tests**

```bash
cd server && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable go test ./... -v 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 2: Build the frontend**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `built in Xs` with no errors.

- [ ] **Step 3: Start the app and verify manually**

Start the dev server. Open the Accounts view and click a transaction to edit it. Verify:
- The category dropdown shows `━━ INFLOWS ━━` at the top with "Inflow: Ready to Assign" under it
- Regular categories appear below grouped by their group names

Open the Import wizard Step 2. Verify the same grouping appears.

Open the Budget view. Verify "Inflows" group does NOT appear in the budget table.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git status
git add -p  # stage any remaining changes
git commit -m "chore: final cleanup for inflow ready-to-assign feature"
```
