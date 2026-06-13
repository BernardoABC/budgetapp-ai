# Income Category Group

**Date:** 2026-06-12  
**Status:** Approved

## Summary

Add a user-visible "Income" category group to the budget table with three default categories: Paychecks, Interest, and Other Income. Users categorize income transactions to these categories; planned amounts per category auto-sum to become the Expected Income total. The group appears at the top of the budget table with income-appropriate column math (Actual shows positive inflows, Remaining shows income still pending).

## Design Decisions

| Question | Decision |
|---|---|
| Where in budget table? | Top (sort_order = -1) |
| Expected Income field | Auto-derived from income category planned sums — no longer manually editable |
| Actual column | Shows positive inflow amount (not negated like expenses) |
| Remaining column | planned − actual (income still expected) |
| How to identify income groups | `is_income BOOLEAN` on `category_groups` table (Approach A) |

## Data Layer

### Migration: `013_income_categories.sql`

```sql
ALTER TABLE category_groups
  ADD COLUMN is_income BOOLEAN NOT NULL DEFAULT false;

-- Seed Income group and default categories
INSERT INTO category_groups (name, sort_order, is_income)
VALUES ('Income', -1, true)
ON CONFLICT (name) DO UPDATE SET is_income = true, sort_order = -1;

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

### Go Model (`model/category.go`)

Add `IsIncome bool` to `CategoryGroup` struct.

### Repository (`repository/category_repo.go`)

Include `is_income` in the `ListGroups` SELECT query. Scan into `CategoryGroup.IsIncome`.

### Category Handler (`handler/categories.go`)

Include `"is_income": g.IsIncome` in the `GET /api/categories` JSON response per group.

## Server Plan Computation (`service/plan_service.go`)

The group loop gains income-aware branching:

```
pm.ExpectedIncome = 0   // start at zero; accumulated below, not read from DB

for each group:
  if group.IsSystem → skip (unchanged)
  if group.IsIncome:
    pm.ExpectedIncome += toCRC(planned, c.Currency)  // accumulate per category
    do NOT feed activity into FixedActual / FlexibleActual / NonMonthlyActual
  else (expense group):
    existing logic unchanged — feeds pm.PlannedTotal, pm.FixedActual, etc.

pm.LeftToBudget = pm.ExpectedIncome - pm.PlannedTotal
```

`planMonthToJSON` adds `"is_income": g.IsIncome` to each group object in the response.

**Retired:** `SetExpectedIncome` service method and `PUT /api/plan/{month}/income` endpoint are removed. The `monthly_plans.expected_income` column is no longer written or read. (The DB column can be dropped in a future cleanup migration.)

**Behavior note for existing months:** Prior months have no planned amounts in income categories yet, so `ExpectedIncome` will show $0 for those months until the user budgets them. This is expected — the manual Expected Income field is replaced by per-category budgeting.

## Frontend

### `api.ts`

```ts
export interface CategoryGroupAPI {
  // existing fields ...
  is_income: boolean;
}

export interface PlanGroupAPI {
  // existing fields ...
  is_income: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  categories: string[];
  is_income?: boolean;
}
```

### `App.tsx`

Pass `is_income` when mapping raw groups to `CategoryGroup[]`:

```ts
setCategoryGroups(rawGroups.filter(g => !g.is_system).map(g => ({
  id: g.id,
  name: g.name,
  categories: g.categories.map(c => c.name),
  is_income: g.is_income,
})));
```

### `engine.ts` (`computePlan`)

Skip income categories when accumulating `plannedTotalCRC`:

```ts
if (!g.is_income) {
  plannedTotalCRC += toCRC(planned, c.currency, rate);
}
```

`expectedIncome` continues to come from `server.expected_income` (now server-derived).

### `Budget.tsx`

**Expected Income field:** Rendered as display-only text (no `BudgetCell`, no `onSave`). Shows the auto-summed value from the plan response.

**`GroupBlock` — income variant:**

When `isIncome === true`:
- `Actual` cell: display `+activity` (not `-activity`)
- `Remaining` cell: display `planned - activity`
- Remaining color: yellow when > 0 (income pending), dim when 0, green when < 0 (over-received)
- Group header row: green left-border accent (`borderLeft: '3px solid var(--accent)'` or `T.pos`)

Category rows inside income groups use the same flipped math as their group header.

## What Is Not Changing

- System "Inflows" group and "Income" system category remain untouched (used internally; hidden from users).
- Existing transaction categorization flow is unchanged — users will now be able to pick Paychecks / Interest / Other Income as category options when entering income transactions.
- `actual_income` (used by Dashboard) continues to read from the system category; it is not updated in this change.
- No changes to `SetPlanned` — income categories use the same `PUT /api/plan/{month}/{categoryId}/planned` endpoint as expense categories.

## Rollout

1. Deploy migration (adds column with default false — zero downtime).
2. Deploy server (computes ExpectedIncome from income categories; retires SetExpectedIncome endpoint).
3. Deploy frontend (reads is_income, flips income display, Expected Income becomes read-only).
