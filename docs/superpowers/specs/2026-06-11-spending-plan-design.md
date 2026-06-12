# Spending Plan Transformation — Design

**Date:** 2026-06-11
**Status:** Approved
**Branch:** `feature/spending-plan`

## Summary

Transform the app from YNAB-style zero-based envelope budgeting to a Monarch-style
spending plan with cash flow tracking. The budget month is no longer tied to account
balances; it is a forecast of expected income against planned spending. Includes
opt-in per-category rollover, flex budgeting (fixed / flexible / non-monthly), and a
new Cash Flow page. Historical budget data is wiped (clean slate, per user decision);
transactions, accounts, imports, categorization, transfers, and exchange rates are
untouched.

## Decisions (settled with user)

1. **Expected income** is a single editable number per month, in CRC.
2. **Rollover** is opt-in per category; default is each month stands alone.
3. **Targets are retired entirely** — the planned amount per category IS the plan.
4. **Scope** includes flex budgeting and the Cash Flow page, behind a
   category/flex mode toggle (both modes supported, Monarch-style).
5. **Clean slate**: existing `budgets` rows are deleted; `category_targets` dropped.

## Core Model

For a given month:

- **Expected income** — one CRC amount, stored in `monthly_plans.expected_income`.
  When a month has no row, the UI offers "copy last month" (same pattern as the
  existing copy-previous budget action).
- **Planned amount per category** — reuses the existing `budgets` table and its
  per-month upsert. `assigned` is reinterpreted as the planned/budgeted amount,
  in the category's native currency (CRC or USD), as today.
  *(Update 2026-06-12: the column was subsequently renamed to `planned` in
  migration 011, completing the alignment.)*
- **Left to budget** = expected income − Σ planned across all categories
  (USD planned amounts converted to CRC at the current rate, reusing the existing
  conversion approach in the budget service). May go negative — displayed as
  over-planned, never blocked. When positive it is also the **planned savings**.
- **Actuals** — actual income = sum of transactions in the Income system category
  for the month; actual spending = sum of outflow activity in non-system categories.
  Actual savings = income − spending; savings rate = savings / income.

### Rollover

`categories.rollover BOOLEAN NOT NULL DEFAULT false`.

- **Non-rollover category:** Remaining = Planned + Activity for the month only.
- **Rollover category:** Balance = Σ(Planned + Activity) over all months from the
  earliest data to the displayed month. Negative balances carry forward as-is —
  no clamping, no overspend cascade, no "cover overspending" flows.

### Flex budgeting

`categories.flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'
CHECK (flexibility IN ('fixed','flexible','non_monthly'))`.

A global mode (`category` | `flex`) stored in a new `app_settings` key-value table
under key `budget_mode`, default `category`.

- **Category mode:** classic per-category table — Budgeted / Actual / Remaining,
  grouped by category group, with rollover balance shown on rollover categories.
- **Flex mode:** three sections:
  - **Fixed** — per-category planned amounts (bills); section header sums them.
  - **Flexible** — ONE monthly number (`monthly_plans.flex_budget`) tracked against
    the combined spending of all flexible categories. Individual flexible categories
    are listed read-only (actuals only) under the single flex budget bar.
  - **Non-monthly** — per-category planned amounts with rollover treated as on
    (the UI presents these as accumulating funds regardless of the per-category
    rollover flag; the flag still governs category mode).

Setting a category's flexibility is part of the category edit UI. Planned amounts
entered in one mode are the same data shown in the other mode (except the flexible
single number, which only exists in flex mode and does not write per-category rows).

## Data Model Changes (migration `010_spending_plan.sql`)

```sql
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS rollover    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flexibility VARCHAR(20) NOT NULL DEFAULT 'flexible'
    CHECK (flexibility IN ('fixed','flexible','non_monthly'));

CREATE TABLE IF NOT EXISTS monthly_plans (
  month           DATE PRIMARY KEY,          -- first of month
  expected_income BIGINT NOT NULL DEFAULT 0, -- CRC centimos
  flex_budget     BIGINT NOT NULL DEFAULT 0, -- CRC centimos
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM budgets;               -- clean slate
DROP TABLE IF EXISTS category_targets;

-- Rename system inflow category
UPDATE categories SET name = 'Income'
WHERE is_system = true AND name = 'Inflow: Ready to Assign';
```

Note: the `CHECK` added via `ADD COLUMN` is idempotent because the whole `ADD COLUMN
IF NOT EXISTS` is skipped on re-run.

## Backend

### Removed

- RTA computation, RTA breakdown, carry/overspend cascade, Age of Money.
- Targets: `target_repo.go`, target endpoints, `model.Target`, underfunded math.
- Move money: `Move` service method, `AtomicMove` repo method,
  `POST /api/budgets/{month}/move`.

### Rewritten / added

`budget_service.go` becomes the plan service (file may keep its name; rename to
`plan_service.go` preferred). `GetMonth` returns:

```go
type PlanCategory struct {
  ID, Name, Currency string
  Flexibility        string // fixed | flexible | non_monthly
  Rollover           bool
  Planned            int64  // native currency
  Activity           int64  // native currency (negative = spending)
  Remaining          int64  // month-scoped: Planned + Activity
  RolloverBalance    int64  // only meaningful when Rollover (or non_monthly in flex mode)
  ActivityBreakdown  []ActivityEntry // existing multi-currency breakdown, kept
}

type PlanMonth struct {
  Month           string
  Mode            string // category | flex
  ExpectedIncome  int64  // CRC
  FlexBudget      int64  // CRC
  PlannedTotal    int64  // CRC (converted)
  LeftToBudget    int64  // ExpectedIncome - PlannedTotal
  ActualIncome    int64  // CRC
  ActualSpending  int64  // CRC (positive number)
  ActualSavings   int64
  FixedPlanned, FixedActual         int64 // CRC, flex-mode rollups
  FlexibleActual                    int64 // CRC, compared against FlexBudget
  NonMonthlyPlanned, NonMonthlyActual int64
  CategoryGroups  []PlanGroup // category-mode grouping, with group subtotals in CRC
}
```

The rollover-balance computation reuses the existing month-range loop but only for
rollover categories, without clamping at zero.

### Endpoints

| Method & path | Change |
|---|---|
| `GET /api/plan/{month}` | replaces `GET /api/budgets/{month}` |
| `PUT /api/plan/{month}/categories/{id}` | replaces budgets equivalent; body `{planned}` |
| `POST /api/plan/{month}/copy-previous` | kept (copies planned amounts; also seeds expected income from prev month if unset) |
| `PUT /api/plan/{month}/income` | new; body `{amount}` |
| `PUT /api/plan/{month}/flex-budget` | new; body `{amount}` |
| `GET/PUT /api/settings/budget-mode` | new |
| `PUT /api/categories/{id}` | extended with `rollover`, `flexibility` |
| `PUT /api/categories/{id}/currency` | kept (still clears planned rows) |
| `*/api/categories/{id}/target`, `/api/budgets/{month}/move` | removed |

Old `/api/budgets/*` routes are removed outright (single self-hosted user; no
compatibility window needed).

### Reports

Existing income-vs-expense endpoint is the basis for the Cash Flow page. Add to the
reports handler as needed:
- monthly savings-rate series (income, spending, savings per month, CRC),
- spending by flexibility bucket per month.

## Frontend

### Spending Plan page (`Budget.tsx` redesign)

- Header: month nav (kept) + **Expected income** (inline-editable, calculator
  support like existing cells) · **Planned** · **Left to budget** · **Planned
  savings**. Left to budget shows negative state in red as "over-planned".
- Mode toggle (Category / Flex) in the page header, persisted via settings endpoint.
- **Category mode table:** groups with collapse (kept), columns Budgeted / Actual /
  Remaining, progress bar per category (kept), rollover categories show accumulated
  balance pill. Inline budget cell editing, calculator, and the undo stack are
  retained, relabeled.
- **Flex mode:** Fixed section (editable per-category planned), single Flexible
  budget bar (one editable number vs combined flexible spending), Non-monthly
  section (editable, accumulating).
- Retired UI: RTA header + breakdown popover, target modals/badges/underfunded,
  move-money modal, quick-assign "underfunded" (keep "copy last month" and
  "reset all"), Age of Money.
- `BudgetSummaryPane`: stats become Budgeted / Actual / Remaining (+ Rollover
  balance when the selection is a rollover category).
- `engine.ts`: rewritten — month-scoped plan math + rollover accumulation +
  left-to-budget. No cumulative income/overspend tracking. Same optimistic
  local-edit pattern feeding the undo stack.

### Cash Flow page (new)

New top-level route/nav item. Reuses the SVG chart style from `Reports.tsx`:
- Income vs spending bars per month with savings line/rate.
- Current-month summary: income, spending, savings, savings rate.
- Breakdown by flexibility bucket (fixed / flexible / non-monthly) per month.
- Top spending categories for the selected month.

### Dashboard

Replace RTA and Age of Money cards with: this month's income, spending, savings
rate, and left to budget. Rest of dashboard unchanged.

### API client (`api.ts`)

Budget section replaced with plan equivalents; target and move functions deleted;
types updated (`PlanMonthAPI` etc.).

## Multi-currency

Unchanged philosophy: planned amounts and activity are native-currency per category;
all cross-category totals (planned total, left to budget, flex rollups, cash flow)
are CRC, converting USD at the current rate (existing `GetNearest` fallback-500
behavior kept). The category-currency-change endpoint still clears that category's
planned rows.

## Docs to update (same branch)

- `docs/prd/04-budgeting.md` — rewritten for the spending-plan model (this spec is
  the basis).
- `docs/prd/00-project-overview.md`, `README.md`, `AGENTS.md` — replace
  zero-based-budgeting positioning with spending plan / cash flow.
- `docs/prd/06-accounts-and-dashboard.md` — dashboard card changes.
- `docs/prd/07-reports-and-analytics.md` — add Cash Flow page.
- `docs/prd/08-api-design.md` — endpoint changes.

## Testing

- Rewrite `budget_service_test.go` as plan service tests: left-to-budget math,
  rollover accumulation (incl. negative carry), flex rollups, multi-currency
  conversion, copy-previous seeding income.
- Repo tests for `monthly_plans`, `app_settings`, category rollover/flexibility.
- Delete `target_repo_test.go` with the feature.
- Existing transaction/import/transfer tests must keep passing untouched.

## Error handling

- Plan endpoints validate month format (`YYYY-MM`) as today.
- `flexibility` validated against the enum at handler level; DB CHECK as backstop.
- Negative left-to-budget is valid state, never an error.
- Missing `monthly_plans` row ⇒ zero values, not 404.

## Out of scope

- Recurring-transaction detection / bill forecasting (future; see `ai-ideas/06`).
- Per-source income planning, income auto-forecast.
- Batch reclassification UI for flexibility (categories edited one by one).
- Any change to imports, transfers, payee rules, accounts, exchange rates.
