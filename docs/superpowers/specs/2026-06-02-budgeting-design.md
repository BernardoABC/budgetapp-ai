# Budgeting Engine — Design Spec
**Phase 3 / Date: 2026-06-02**

## Overview

Wire the existing Budget UI to a real backend. The frontend Budget component is already complete (assigned editing, rollover display, move money, targets, quick-assign) but runs entirely off hardcoded `AppData`. Phase 3 builds the server-side budget engine, category targets storage, and Age of Money computation, then replaces every `AppData` reference in the budget flow with live API calls.

---

## 1. New Files and Responsibilities

### Backend

```
server/internal/model/
  budget.go              — BudgetMonth, CategoryBudget, Target model structs

server/internal/repository/
  budget_repo.go         — GetAssigned, UpsertAssigned, ListAssignedUpToMonth
                           BulkUpsertAssigned, GetActivityByMonth,
                           GetAllActivityUpToMonth
  target_repo.go         — GetAll, Upsert, Delete

server/internal/service/
  budget_service.go      — GetMonth, SetAssigned, CopyPrevious, Move,
                           computeAgeOfMoney (private)

server/internal/handler/
  budget.go              — HTTP handlers for all budget endpoints

server/internal/database/migrations/
  002_category_targets.sql
```

### Frontend

```
frontend/src/api.ts             — 6 new budget API functions
frontend/src/engine.ts          — simplify compute() to use carry_in
frontend/src/components/Budget.tsx  — replace AppData with API calls
frontend/src/App.tsx            — remove budget/ageOfMoney from AppData usage
frontend/src/data.ts            — remove AppData.budget, AppData.ageOfMoney
```

---

## 2. Database Migration

**`002_category_targets.sql`:**

```sql
CREATE TABLE IF NOT EXISTS category_targets (
    category_id  UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    type         VARCHAR(20)  NOT NULL,   -- 'monthly' | 'refill' | 'savings'
    amount       BIGINT       NOT NULL,   -- CRC centimos
    deadline     DATE,                    -- nullable; used only by 'savings' type
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

The `budgets` table already exists (001_initial_schema.sql). No changes needed.

---

## 3. Model

```go
// server/internal/model/budget.go

type Target struct {
    Type     string  // "monthly" | "refill" | "savings"
    Amount   int64   // CRC centimos
    Deadline *string // YYYY-MM-DD, nil unless type == "savings"
}

type CategoryBudget struct {
    ID          string
    Name        string
    Assigned    int64
    Activity    int64
    CarryIn     int64
    Available   int64   // CarryIn + Assigned + Activity
    Target      *Target // nil if no target set
    Underfunded int64   // 0 if fully funded
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
    Month          string                // "2026-04"
    ReadyToAssign  int64
    AgeOfMoney     *int                  // days; nil if no spending data
    TotalUnderfunded int64
    CategoryGroups []CategoryGroupBudget
}
```

---

## 4. Rollover Algorithm

`BudgetService.GetMonth(ctx, month string)` computes the full budget snapshot for the requested month:

```
1. Load all category groups (with categories) from DB
2. Load all targets from category_targets
3. Load all assigned rows from budgets WHERE month <= requested_month (keyed by category_id + month)
4. Load all activity: SELECT category_id, date_trunc('month', date) AS month, SUM(amount) AS activity
   FROM transactions JOIN accounts ON ... WHERE accounts.on_budget = true AND date <= last_day(requested_month)
   GROUP BY category_id, month
5. Determine earliest_month = min of all months in assigned or activity data
6. Iterate month-by-month from earliest_month to requested_month:
     for each category:
       assigned = budgets[cat][m] or 0
       activity = activity_map[cat][m] or 0
       available = carry[cat] + assigned + activity
       carry[cat] = available   ← rolls into next month
7. For the requested month, compute underfunded per category using targets
8. Sum on-budget account balances → compute RTA = balance_sum - sum(all available)
9. Compute AgeOfMoney (see Section 5)
10. Return BudgetMonth
```

**Why Go loop instead of SQL CTE:** Simple to reason about, easy to test, and handles arbitrary history depth without complex recursive SQL. Performance is negligible for a personal finance app.

---

## 5. Age of Money

```
AoM = SUM(on_budget_account.balance) / (SUM(ABS(outflows last 30 days)) / 30)
```

- "Outflows" = transactions with `amount < 0` on on-budget accounts within the past 30 days from today
- Result rounded to nearest integer (days)
- Returns `nil` if total outflows = 0 (no recent spending); frontend displays `—`
- Included in every `GET /api/budgets/:month` response — no separate endpoint

---

## 6. Underfunded Calculation

For each category with a target, `underfunded` is computed during the rollover loop for the requested month:

| Target type | Underfunded formula |
|-------------|---------------------|
| `monthly`   | `max(0, target.amount − assigned)` |
| `refill`    | `max(0, target.amount − available)` |
| `savings`   | `max(0, (target.amount − available) / months_remaining)` where `months_remaining = max(1, months from current to deadline)` |

`totalUnderfunded` = sum of all underfunded values across all categories, returned at the top level of `BudgetMonth`.

---

## 7. Ready to Assign

```
RTA = SUM(on_budget_account.balance) − SUM(available for all categories in requested month)
```

Account balances are loaded fresh from the `accounts` table on each `GetMonth` call (not cached). If RTA goes negative, it means more has been assigned than exists — the UI already shows this in red.

---

## 8. API Endpoints

### GET /api/budgets/:month
Returns the full budget snapshot for the given month (`2026-04` format).

```json
{
  "month": "2026-04",
  "ready_to_assign": 14500000,
  "age_of_money": 23,
  "total_underfunded": 35000,
  "category_groups": [
    {
      "id": "uuid",
      "name": "Food & Dining",
      "assigned": 175000,
      "activity": -145000,
      "available": 30000,
      "categories": [
        {
          "id": "uuid",
          "name": "Groceries",
          "assigned": 120000,
          "activity": -145000,
          "carry_in": 5000,
          "available": -20000,
          "underfunded": 0,
          "target": { "type": "monthly", "amount": 120000, "deadline": null }
        }
      ]
    }
  ]
}
```

### PUT /api/budgets/:month/categories/:categoryId
Set the assigned amount for a category in a month. Creates or updates the `budgets` row.

Request: `{ "assigned": 120000 }`
Response: `{ "assigned": 120000 }`

### POST /api/budgets/:month/copy-previous
Copies all assigned values from the previous calendar month into the current month. Uses `INSERT ... ON CONFLICT DO NOTHING` — only categories with no `budgets` row for this month get copied; existing rows (including those with `assigned = 0`) are left untouched.

Response: `204 No Content`

### POST /api/budgets/:month/move
Transfers an amount between two categories' assigned values for the month.

Request: `{ "from_category_id": "uuid", "to_category_id": "uuid", "amount": 5000 }`
Response: `204 No Content`

### PUT /api/categories/:id/target
Upsert a target for a category.

Request: `{ "type": "monthly", "amount": 120000, "deadline": null }`
Response: `{ "type": "monthly", "amount": 120000, "deadline": null }`

### DELETE /api/categories/:id/target
Remove a target for a category.

Response: `204 No Content`

---

## 9. Repository Layer

### budget_repo.go

```go
// GetAssigned returns all budget rows for a category up to and including the given month.
GetAssignedUpToMonth(ctx, month string) (map[string]map[string]int64, error)
// Returns map[categoryID][YYYY-MM-01] = assigned

// UpsertAssigned creates or updates a single budget row.
UpsertAssigned(ctx, categoryID, month string, assigned int64) error

// BulkUpsertAssigned sets assigned for multiple categories in one transaction.
// Used by CopyPrevious.
BulkUpsertAssigned(ctx, entries []BudgetEntry) error

// GetActivityUpToMonth returns SUM(amount) grouped by (category_id, month)
// for all on-budget transactions up to the last day of the given month.
GetActivityUpToMonth(ctx, month string) (map[string]map[string]int64, error)
// Returns map[categoryID][YYYY-MM-01] = activity_sum
```

### target_repo.go

```go
// GetAll returns all targets keyed by category_id.
GetAll(ctx) (map[string]*model.Target, error)

// Upsert creates or replaces a target for a category.
Upsert(ctx, categoryID string, t model.Target) error

// Delete removes a target for a category.
Delete(ctx, categoryID string) error
```

---

## 10. Frontend Changes

### api.ts additions

```ts
fetchBudget(month: string): Promise<BudgetMonth>
setAssigned(month: string, categoryId: string, amount: number): Promise<void>
copyPrevious(month: string): Promise<void>
moveMoney(month: string, from: string, to: string, amount: number): Promise<void>
setTarget(categoryId: string, target: Target): Promise<Target>
deleteTarget(categoryId: string): Promise<void>
```

### engine.ts — simplified compute()

The server now provides `carry_in` per category, so the frontend no longer needs to iterate through all prior months. The compute function accepts the API response directly and computes:

```ts
available = carry_in + assigned + activity
```

RTA, totalUnderfunded, and AoM come directly from the API response — the engine reads them through rather than computing them.

The `EngineData` interface changes: `budget` entries gain `carry_in` and `activity` fields from the API (replacing the hardcoded `AppData.budget` structure).

### Budget.tsx wiring

**Month navigation:** The fixed `AppData.months` array is replaced by a free cursor (`currentMonth: string` in state, initialized to the current calendar month). Prev/next buttons decrement/increment by one month. No upper or lower bound enforced — the API returns zeros for months with no data.

**Data loading:** On mount and on month change, `fetchBudget(currentMonth)` is called. The response seeds `localBudget` state (assigned + activity per category keyed by category ID) and `targets` state. `carry_in` per category is stored separately in a ref (immutable for the current month display).

**Saves:**
- `handleSaveAssigned(catId, value)`: updates local state immediately (optimistic), then calls `setAssigned(month, catId, value)` (fire-and-forget, logs error on failure)
- `handleMove(from, to, amount)`: updates local state, calls `moveMoney()`
- `handleSetTarget(catId, target)`: updates local state, calls `setTarget()` or `deleteTarget()`

**Category keying:** Budget data migrates from category-name keys to category-ID keys throughout Budget.tsx and engine.ts. The `categoryIdByName` prop (already exists in App.tsx) is used during the transition for the category editor (rename, reorder, hide, delete) which still works by name. Display still uses names from the category groups structure.

### App.tsx

Removes `budget` from the AppData destructure passed to `<Budget>`. Budget component fetches its own data. The `ageOfMoney` field is also removed from AppData usage.

### data.ts

`AppData.budget` and `AppData.ageOfMoney` are deleted. The `BudgetEntry` interface is updated to include `carry_in`. The `Target` interface is unchanged (already matches the API shape).

---

## 11. Error Handling

| Failure | Behaviour |
|---------|-----------|
| `fetchBudget` fails on mount | Shows error message in budget area, retry button |
| `setAssigned` fails | Logs error; local state already updated (optimistic). User sees stale data until next fetch. |
| `copyPrevious` fails | Toast-style error (or console log for Phase 3); no state change |
| `moveMoney` fails | Reverts local state update |
| `setTarget` fails | Reverts local target state |
| Target with savings type and no deadline | Backend returns 400; frontend validates before calling |

---

## 12. Out of Scope (deferred)

- Per-transaction rate in budget view (USD conversion uses 1st-of-month rate) — Phase 3.5+
- Flagging stale-rate transactions in budget — Phase 3.5+
- Budget view in USD mode (requires per-month exchange rates) — Phase 3.5+
- Dashboard RTA card wired to live data — Phase 4.1
- Import history view — Phase 4.4
