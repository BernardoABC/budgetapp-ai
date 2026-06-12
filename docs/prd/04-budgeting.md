# PRD 04: Spending Plan

## Overview

The spending plan is a monthly **forecast** model inspired by Monarch Money. Unlike zero-based envelope budgeting, the plan is not tied to account balances. The user sets an expected income for the month, assigns planned amounts to categories, and tracks how actual spending compares to those plans. The core question the page answers is: "How much do I plan to spend, and how much is left?"

Negative "left to budget" (over-planning) is valid and displayed in red — it is never blocked.

## Core Concepts

### Expected Income
A single editable CRC amount stored per month in `monthly_plans.expected_income`. Represents what the user expects to receive that month. Inline-editable in the Spending Plan page header.

### Planned Amounts
Each category can have a planned (budgeted) amount for a given month, stored in the `budgets` table (`assigned` column, reinterpreted). Amounts are in the category's native currency (CRC or USD). USD amounts are converted to CRC at the current exchange rate for cross-category totals.

### Left to Budget / Planned Savings
```
Left to budget = Expected income − Σ planned (all categories, CRC-converted)
```
When positive, this is also the **planned savings** for the month. When negative, it means the user has planned to spend more than their expected income ("over-planned"), shown in red. This is informational only — no assignment is blocked.

### Actuals and Savings Rate
- **Actual income** — sum of inflow transactions in the "Income" system category for the month.
- **Actual spending** — sum of outflow activity across all non-system categories.
- **Actual savings** = actual income − actual spending.
- **Savings rate** = actual savings / actual income (shown as a percentage).

## Rollover

Controlled by `categories.rollover BOOLEAN NOT NULL DEFAULT false`. Default: each month stands alone.

| Mode | Remaining Calculation |
|------|-----------------------|
| Non-rollover (default) | `Remaining = Planned + Activity` for the current month only |
| Rollover | `Balance = Σ(Planned + Activity)` over all months from earliest data through displayed month |

Rollover balances carry negative values forward as-is — no clamping, no "cover overspending" cascade, no move-money flows. A rollover category with a negative running balance shows that balance as a red pill on the row.

## Flex Budgeting

### Flexibility Classes

Each category has `categories.flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'` with three values:

| Value | Meaning |
|-------|---------|
| `fixed` | Regular, predictable bills (rent, phone). Planned per category. |
| `flexible` | Day-to-day discretionary spending (groceries, dining, gas). Grouped under a single monthly flex budget number. |
| `non_monthly` | Irregular expenses planned over time (travel, repairs). Planned per category with accumulated rollover. |

### Mode Toggle

A global `budget_mode` key in `app_settings` stores `category` (default) or `flex`. The user toggles between modes in the Spending Plan page header; the setting persists via `GET/PUT /api/settings/budget-mode`.

### Category Mode
Classic per-category table grouped by category group. Columns: **Budgeted / Actual / Remaining**. Rollover categories show an accumulated balance pill.

### Flex Mode
Three sections:

**Fixed** — Per-category planned amounts (each category row is editable). Section header shows the sum of all fixed planned amounts.

**Flexible** — A single monthly number (`monthly_plans.flex_budget`) edited as one bar. Individual flexible categories are listed read-only beneath it (showing actuals only). The bar tracks `flex_budget` against combined spending of all flexible categories.

**Non-monthly** — Per-category planned amounts, treated as accumulating funds (rollover on for display purposes regardless of the per-category rollover flag). Section header sums planned amounts.

Planned amounts entered in category mode are the same data shown in flex mode. The flex budget number (`flex_budget`) exists only in flex mode.

## Data Model

### budgets table (per-category, per-month — reinterpreted)
```sql
CREATE TABLE budgets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID        NOT NULL REFERENCES categories(id),
    month       DATE        NOT NULL,  -- always the 1st of the month
    assigned    BIGINT      NOT NULL DEFAULT 0,  -- planned amount, native currency centimos
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(category_id, month)
);
```

`assigned` is now reinterpreted as the **planned** amount. The column name is unchanged for compatibility; the API and UI call it "planned" or "budgeted."

### monthly_plans table (migration 010)
```sql
CREATE TABLE IF NOT EXISTS monthly_plans (
  month           DATE PRIMARY KEY,          -- first of month
  expected_income BIGINT NOT NULL DEFAULT 0, -- CRC centimos
  flex_budget     BIGINT NOT NULL DEFAULT 0, -- CRC centimos
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

A missing row for a month means zero expected income and zero flex budget; the API returns zero values rather than 404.

### app_settings table (migration 010)
```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Current keys: `budget_mode` → `"category"` or `"flex"`.

### categories table additions (migration 010)
```sql
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed','flexible','non_monthly'));
```

### category_targets table
Dropped entirely in migration 010. Targets are replaced by the planned amount itself.

### Income system category
The "Inflow: Ready to Assign" system category is renamed to **"Income"** in migration 010.

## API Endpoints

### Spending Plan

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/plan/{month} | Get plan for a month (YYYY-MM); returns PlanMonth |
| PUT | /api/plan/{month}/categories/{categoryId} | Set planned amount; body `{"planned": <bigint>}` |
| POST | /api/plan/{month}/copy-previous | Copy planned amounts from previous month; also seeds expected income if unset |
| PUT | /api/plan/{month}/income | Set expected income; body `{"amount": <bigint>}` |
| PUT | /api/plan/{month}/flex-budget | Set flex budget amount; body `{"amount": <bigint>}` |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/settings/budget-mode | Returns `{"mode": "category"}` or `{"mode": "flex"}` |
| PUT | /api/settings/budget-mode | Body `{"mode": "category"\|"flex"}` |

### Categories (extended)

`PUT /api/categories/{id}` accepts `rollover` (bool) and `flexibility` (string) fields in addition to existing fields.

### Removed endpoints

The following endpoints from the old zero-based model are removed:
- `GET /api/budgets/{month}` → replaced by `GET /api/plan/{month}`
- `PUT /api/budgets/{month}/categories/{id}` → replaced by `PUT /api/plan/{month}/categories/{categoryId}`
- `POST /api/budgets/{month}/move` — move-money removed entirely
- `*/api/categories/{id}/target` — targets removed entirely

### GET /api/plan/{month} response shape

```json
{
  "month": "2026-06",
  "mode": "category",
  "expected_income": 180000000,
  "flex_budget": 40000000,
  "planned_total": 155000000,
  "left_to_budget": 25000000,
  "actual_income": 175000000,
  "actual_spending": 142000000,
  "actual_savings": 33000000,
  "fixed_planned": 60000000,
  "fixed_actual": 58000000,
  "flexible_actual": 45000000,
  "non_monthly_planned": 20000000,
  "non_monthly_actual": 8000000,
  "category_groups": [
    {
      "id": "uuid",
      "name": "Housing",
      "planned": 60000000,
      "actual": -58000000,
      "remaining": 2000000,
      "categories": [
        {
          "id": "uuid",
          "name": "Rent",
          "flexibility": "fixed",
          "rollover": false,
          "planned": 60000000,
          "activity": -58000000,
          "remaining": 2000000,
          "rollover_balance": 0
        }
      ]
    }
  ]
}
```

All CRC amounts are in centimos (BIGINT). Multi-currency categories return `planned` and `activity` in their native currency; cross-category totals (`planned_total`, `left_to_budget`, flex rollups) are always CRC, with USD converted at the current rate.

## UI Behavior

### Page Header
- Month navigator (prev / MONTH YEAR / next)
- **Expected income** — inline-editable CRC amount; calculator support
- **Planned** — sum of all planned amounts (CRC-converted); read-only
- **Left to budget** — displayed green when positive ("planned savings"), red when negative ("over-planned")
- **Mode toggle** — Category / Flex buttons; persisted via settings endpoint

### Category Mode Table

Columns: **Category · Budgeted · Actual · Remaining**

Each category row:
- Budgeted cell — click to edit (inline input with calculator support)
- Progress bar — `|activity| / planned` percentage; group color, amber >85%, red when overspent
- Rollover categories show an accumulated balance pill instead of month-scoped remaining

Group rows show subtotals for each column. Groups are collapsible.

### Flex Mode Sections

Fixed and Non-monthly sections show per-category rows with editable planned amounts. The Flexible section shows a single editable bar (flex budget number) with read-only category rows beneath it showing actuals.

### Bulk Actions

| Action | Behavior |
|--------|---------|
| Copy last month | Copies every category's planned amount from the previous month; seeds expected income if the current month has none |
| Reset all | Sets all planned amounts to 0 for the current month |

Targets ("auto-assign underfunded") and move-money are removed.

### Undo Stack

Inline budget edits feed an undo stack (same mechanism as before). Ctrl+Z reverts the last cell edit optimistically before the API call completes.

### Category Inspector (BudgetSummaryPane)

Slide-in drawer showing: Budgeted · Actual · Remaining (or Rollover balance for rollover categories). Flexibility and rollover toggles accessible here. Target editor removed.

## Edge Cases

1. **Missing monthly_plans row** — API returns zero for expected income and flex budget; no 404.
2. **Negative left to budget** — Valid state; shown in red, never blocked.
3. **Rollover category with negative balance** — Balance carries forward; no clamping.
4. **First month ever** — No previous data; copy-previous is a no-op; all planned amounts start at 0.
5. **USD category** — Planned and activity stored in USD centimos; converted to CRC only for totals using current exchange rate.
6. **Category currency change** — `PUT /api/categories/{id}/currency` still clears that category's planned rows (same behavior as before).
