# Phase 5: Dashboard Real Stats + Remaining Report Charts — Design

**Date:** 2026-06-03
**Status:** Design — pending implementation plan

## Goal

Replace the remaining static/hardcoded data on the Dashboard and Reports pages with live API data. After this phase, the only static data left in the app is the Import wizard's sample preview (deferred to Phase 5.5).

## Scope

In scope:
1. **Dashboard** — net worth, monthly spending, ready-to-assign, spending-by-category bars, and budget alerts derived from existing APIs.
2. **Reports — Income vs Expense** — new backend endpoint.
3. **Reports — Net Worth** — new backend endpoint (transaction-sum-per-month).
4. **Reports — Age of Money** — composed from the existing budget API, no new endpoint.

Out of scope (deferred):
- Import wizard real preview/confirm wiring → **Phase 5.5**
- Net Worth card sparkline + month-over-month delta (no historical snapshot data)
- Transaction search, bulk operations, payee rules UI → later phases

## Architecture

The chosen approach (Option A) composes existing endpoints wherever possible and adds only two genuinely new backend endpoints. The Dashboard needs **zero** new backend work.

### Component / file map

| File | Change |
|------|--------|
| `server/internal/repository/transaction_repo.go` | Add `IncomeExpenseByMonth(from, to)` and `NetWorthByMonth(from, to)` methods |
| `server/internal/handler/reports.go` | Add `IncomeExpense` and `NetWorth` handler methods |
| `server/main.go` | Wire `GET /api/reports/income-expense` and `GET /api/reports/net-worth` |
| `frontend/src/api.ts` | Add `fetchIncomeExpense`, `fetchNetWorth`, `fetchAgeOfMoney` |
| `frontend/src/components/Dashboard.tsx` | Fetch accounts + current-month budget; derive all stat values |
| `frontend/src/components/Reports.tsx` | Replace static `AppData.incomeExpense`, `netWorthHistory`, `ageOfMoney` with fetched data |

## Section 1: Dashboard

The Dashboard already fetches recent transactions on mount (Phase 4). Extend its `useEffect` to also fetch accounts and the current-month budget in parallel:

```
Promise.all([
  fetchRecentTransactions(20),
  fetchAccounts(),
  fetchBudget(currentMonth),   // currentMonth = new Date().toISOString().slice(0,7)
])
```

Derive the stat-card and panel values:

| UI element | Derivation |
|------------|------------|
| Net Worth card value | Sum of all account balances (`budget` + `tracking`) from `fetchAccounts()` |
| Spent · {month} card value | Sum of `activity` across all budget category groups (activity is negative for spending; display as positive outflow) |
| Ready to Assign card value | `ready_to_assign` from `fetchBudget()` |
| Spending by Category bars | One bar per `category_group`: `spent = -activity`, `budget = assigned`, color from `GROUP_COLORS[group.name]` |
| Budget Alerts | All categories across all groups where `available < 0`, shown with the overspent amount |

The Net Worth card's sparkline and "↑ 3.2% vs last month" delta are removed (no historical data). The card keeps its accent-gradient styling.

`fetchAccounts` and `fetchBudget` already exist in `api.ts`. No new backend or api.ts work for this section — only `Dashboard.tsx` changes.

### Error handling
If any of the three fetches fail, catch with `console.warn` and leave the affected values at their initial state (0 / empty). The page still renders; cards show zero values rather than crashing. This matches the existing Phase 4 pattern.

## Section 2: Reports — Income vs Expense + Net Worth

### Endpoint: `GET /api/reports/income-expense?from=YYYY-MM&to=YYYY-MM`

Groups transactions by calendar month within the inclusive range. Positive amounts sum to income, negative amounts sum to expense (returned as a positive magnitude).

Response:
```json
[
  { "month": "2026-01", "income": 120000000, "expense": 85600000 }
]
```

Repo method `IncomeExpenseByMonth(ctx, from, to string) ([]IncomeExpenseRow, error)` where:
```go
type IncomeExpenseRow struct {
    Month   string
    Income  int64
    Expense int64
}
```

SQL aggregates over the `transactions` table:
- `SUM(amount) FILTER (WHERE amount > 0)` → income
- `SUM(ABS(amount)) FILTER (WHERE amount < 0)` → expense
- Grouped by `date_trunc('month', date)`, same inclusive-range bounds as Phase 4's `SpendingByGroup`.

### Endpoint: `GET /api/reports/net-worth?from=YYYY-MM&to=YYYY-MM`

Net worth at the end of month M = sum of **all** transactions (all accounts) with `date <= last day of M`. This is correct because each account's balance is the cumulative sum of its transactions, including the "Starting Balance" transaction created on account creation.

Response:
```json
[
  { "month": "2026-01", "net_worth": 450000000 }
]
```

Repo method `NetWorthByMonth(ctx, from, to string) ([]NetWorthRow, error)` where:
```go
type NetWorthRow struct {
    Month    string
    NetWorth int64
}
```

SQL uses `generate_series` over the month range to produce one row per month, with a correlated subquery summing all transactions up to the end of each month:
```sql
SELECT to_char(m, 'YYYY-MM') AS month,
       COALESCE((
         SELECT SUM(t.amount)
         FROM transactions t
         WHERE t.date < (m + INTERVAL '1 month')
       ), 0)::bigint AS net_worth
FROM generate_series(
       ($1 || '-01')::date,
       ($2 || '-01')::date,
       INTERVAL '1 month'
     ) AS m
ORDER BY m
```

### Handler

Both endpoints are added as methods on the existing `ReportsHandler` (created in Phase 4). Each validates that `from` and `to` are present (400 otherwise), calls the repo, and writes the result via `writeJSON`. Empty results return `[]`, not `null`.

### Frontend

`api.ts` gains:
```ts
export async function fetchIncomeExpense(from: string, to: string):
  Promise<{ month: string; income: number; expense: number }[]>

export async function fetchNetWorth(from: string, to: string):
  Promise<{ month: string; net_worth: number }[]>
```

Amounts stay in centimos (no `/100`) — the charts and `fmt` handle display.

## Section 3: Reports — Age of Money

No new backend endpoint. `GET /api/budgets/{month}` already returns `age_of_money: number | null`.

`api.ts` gains:
```ts
export async function fetchAgeOfMoney(months: number):
  Promise<{ month: string; days: number }[]>
```

It computes the trailing `months` YYYY-MM strings, calls `fetchBudget` for each in parallel via `Promise.all`, extracts `age_of_money`, filters out `null` entries, and returns `{ month, days }` rows in chronological order. Up to 6 lightweight parallel requests — acceptable.

## Section 4: Reports component wiring

`Reports.tsx` currently reads `D.incomeExpense`, `D.netWorthHistory`, and `D.ageOfMoney` from `AppData`. Replace with state populated in the existing mount `useEffect` (which already fetches the spending report). The chart components (`IncomeExpenseChart`, `AreaLineChart`) already consume the right shapes:

- Income vs Expense: `[{ month, income, expense }]` — direct from `fetchIncomeExpense`
- Net Worth: the `AreaLineChart` `valueOf` accessor changes from `assets - debt` to `net_worth`
- Age of Money: `[{ month, days }]` — direct from `fetchAgeOfMoney`

The month label format: backend returns `YYYY-MM`; the charts display whatever string is in `month`. Keep the raw `YYYY-MM` labels for consistency with the spending chart (already wired this way in Phase 4) — no `MMM YY` reformatting needed.

The `AppData.incomeExpense`, `AppData.netWorthHistory`, and `AppData.ageOfMoney` entries become dead data but are left in `data.ts` (harmless; removal is a separate cleanup).

## Testing

- **Go:** `go test ./...` must pass. The two new repo methods are covered by the existing repository test pattern if integration tests are added; at minimum the build and existing suite must stay green. (Repo-level integration tests follow the `budget_repo_test.go` pattern if added.)
- **Frontend:** `npm run build` must pass with no TypeScript errors.
- **Manual:** With the dev server running, the Dashboard shows real net worth/spending and the three report charts render real data; empty ranges render the "No data" guard (added in Phase 4).

## Risks / notes

- **Net worth across currencies:** `NetWorthByMonth` sums raw `amount` across all accounts regardless of currency. If accounts hold mixed currencies (CRC + USD), the raw sum mixes minor units. For v1 this matches the existing behavior of the Net Worth card (which also sums raw balances). True multi-currency net worth normalization is out of scope.
- **Empty months:** `income-expense` only returns months that have transactions; `net-worth` returns every month in range via `generate_series`. The charts tolerate both (gaps in income/expense are fine; the empty-data guard covers <2 points).
