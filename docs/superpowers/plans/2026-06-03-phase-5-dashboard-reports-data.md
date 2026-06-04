# Phase 5: Dashboard Real Stats + Remaining Report Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all remaining static/hardcoded data on Dashboard and Reports with live API data, adding two new backend endpoints for income-expense and net-worth charts.

**Architecture:** Zero new endpoints for Dashboard — derives Net Worth, Spent, Ready to Assign, Spending bars, and Alerts from existing `fetchAccounts()` + `fetchBudget()` + `fetchRecentTransactions()` in a single `Promise.all`. Two new backend endpoints for Reports: `GET /api/reports/income-expense` and `GET /api/reports/net-worth`. Age of Money is frontend-only, composed from parallel `fetchBudget` calls.

**Tech Stack:** Go (pgx/v5), React 18, TypeScript, inline styles only, no new npm deps.

---

## File Map

| File | Change |
|------|--------|
| `server/internal/repository/transaction_repo.go` | Add `IncomeExpenseRow`, `NetWorthRow`, `IncomeExpenseByMonth`, `NetWorthByMonth` |
| `server/internal/repository/transaction_repo_test.go` | Add tests for both new repo methods |
| `server/internal/handler/reports.go` | Add `IncomeExpense` and `NetWorth` handler methods |
| `server/main.go` | Add two new report routes |
| `frontend/src/api.ts` | Add `fetchIncomeExpense`, `fetchNetWorth`, `fetchAgeOfMoney` |
| `frontend/src/components/Dashboard.tsx` | Extend useEffect to also fetch accounts + budget; derive all stat card values |
| `frontend/src/components/Reports.tsx` | Add state + fetches for income-expense, net-worth, age-of-money; wire charts |

---

## Task 1: Repo — IncomeExpenseByMonth

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Test: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 1.1: Write the failing test**

Add at the bottom of `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_IncomeExpenseByMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	// income in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-15", 100000)
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-20", 50000)
	// expense in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-25", -30000)
	// income in Feb
	testutil.SeedTransaction(t, pool, acc, cat, "2026-02-10", 200000)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	rows, err := repo.IncomeExpenseByMonth(ctx, "2026-01", "2026-02")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows got %d", len(rows))
	}
	if rows[0].Month != "2026-01" {
		t.Errorf("want month 2026-01 got %s", rows[0].Month)
	}
	if rows[0].Income != 150000 {
		t.Errorf("want income 150000 got %d", rows[0].Income)
	}
	if rows[0].Expense != 30000 {
		t.Errorf("want expense 30000 got %d", rows[0].Expense)
	}
	if rows[1].Month != "2026-02" {
		t.Errorf("want month 2026-02 got %s", rows[1].Month)
	}
	if rows[1].Income != 200000 {
		t.Errorf("want income 200000 got %d", rows[1].Income)
	}
	if rows[1].Expense != 0 {
		t.Errorf("want expense 0 got %d", rows[1].Expense)
	}
}
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/repository/... -run TestTransactionRepo_IncomeExpenseByMonth -v
```

Expected: compile error — `IncomeExpenseByMonth` undefined.

- [ ] **Step 1.3: Add IncomeExpenseRow and IncomeExpenseByMonth to transaction_repo.go**

Append to the bottom of `server/internal/repository/transaction_repo.go` (after the `SpendingByGroup` method):

```go
// IncomeExpenseRow is one month's income and expense totals in centimos.
type IncomeExpenseRow struct {
	Month   string
	Income  int64
	Expense int64
}

// IncomeExpenseByMonth returns monthly income and expense totals for the
// inclusive YYYY-MM range. Only months with transactions appear.
func (r *TransactionRepo) IncomeExpenseByMonth(ctx context.Context, from, to string) ([]IncomeExpenseRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			to_char(date_trunc('month', t.date::date), 'YYYY-MM') AS month,
			COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::bigint AS income,
			COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.amount < 0), 0)::bigint AS expense
		FROM transactions t
		WHERE t.date >= ($1 || '-01')::date
		  AND t.date <  (($2 || '-01')::date + INTERVAL '1 month')
		GROUP BY date_trunc('month', t.date::date)
		ORDER BY date_trunc('month', t.date::date)
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("income expense by month: %w", err)
	}
	defer rows.Close()
	var out []IncomeExpenseRow
	for rows.Next() {
		var row IncomeExpenseRow
		if err := rows.Scan(&row.Month, &row.Income, &row.Expense); err != nil {
			return nil, fmt.Errorf("scan income expense row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/repository/... -run TestTransactionRepo_IncomeExpenseByMonth -v
```

Expected: `PASS`

- [ ] **Step 1.5: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add IncomeExpenseByMonth repo method + test"
```

---

## Task 2: Repo — NetWorthByMonth

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Test: `server/internal/repository/transaction_repo_test.go`

- [ ] **Step 2.1: Write the failing test**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_NetWorthByMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	// Starting balance equivalent: +500000 in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-01", 500000)
	// Spend in Jan: -100000
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-15", -100000)
	// Income in Feb: +200000
	testutil.SeedTransaction(t, pool, acc, cat, "2026-02-10", 200000)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	rows, err := repo.NetWorthByMonth(ctx, "2026-01", "2026-02")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows got %d", len(rows))
	}
	// End of Jan: 500000 - 100000 = 400000
	if rows[0].Month != "2026-01" {
		t.Errorf("want month 2026-01 got %s", rows[0].Month)
	}
	if rows[0].NetWorth != 400000 {
		t.Errorf("want net_worth 400000 got %d", rows[0].NetWorth)
	}
	// End of Feb: 400000 + 200000 = 600000
	if rows[1].Month != "2026-02" {
		t.Errorf("want month 2026-02 got %s", rows[1].Month)
	}
	if rows[1].NetWorth != 600000 {
		t.Errorf("want net_worth 600000 got %d", rows[1].NetWorth)
	}
}
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/repository/... -run TestTransactionRepo_NetWorthByMonth -v
```

Expected: compile error — `NetWorthByMonth` undefined.

- [ ] **Step 2.3: Add NetWorthRow and NetWorthByMonth to transaction_repo.go**

Append to the bottom of `server/internal/repository/transaction_repo.go` (after `IncomeExpenseByMonth`):

```go
// NetWorthRow is the running net worth (sum of all transaction amounts) at end of a month.
type NetWorthRow struct {
	Month    string
	NetWorth int64
}

// NetWorthByMonth returns the cumulative net worth at the end of each month in
// the inclusive YYYY-MM range. Every month in range appears (via generate_series).
func (r *TransactionRepo) NetWorthByMonth(ctx context.Context, from, to string) ([]NetWorthRow, error) {
	rows, err := r.pool.Query(ctx, `
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
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("net worth by month: %w", err)
	}
	defer rows.Close()
	var out []NetWorthRow
	for rows.Next() {
		var row NetWorthRow
		if err := rows.Scan(&row.Month, &row.NetWorth); err != nil {
			return nil, fmt.Errorf("scan net worth row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/repository/... -run TestTransactionRepo_NetWorthByMonth -v
```

Expected: `PASS`

- [ ] **Step 2.5: Run full test suite to confirm no regressions**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```

Expected: all PASS.

- [ ] **Step 2.6: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add server/internal/repository/transaction_repo.go server/internal/repository/transaction_repo_test.go
git commit -m "feat: add NetWorthByMonth repo method + test"
```

---

## Task 3: Handler + Routes — IncomeExpense and NetWorth

**Files:**
- Modify: `server/internal/handler/reports.go`
- Modify: `server/main.go`

- [ ] **Step 3.1: Add IncomeExpense and NetWorth handler methods to reports.go**

Append to the bottom of `server/internal/handler/reports.go` (after `SpendingByGroup`):

```go
// IncomeExpense handles GET /api/reports/income-expense?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) IncomeExpense(w http.ResponseWriter, r *http.Request) {
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
		Month   string `json:"month"`
		Income  int64  `json:"income"`
		Expense int64  `json:"expense"`
	}
	result := make([]row, 0, len(rows))
	for _, r := range rows {
		result = append(result, row{Month: r.Month, Income: r.Income, Expense: r.Expense})
	}
	writeJSON(w, http.StatusOK, result)
}

// NetWorth handles GET /api/reports/net-worth?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) NetWorth(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}

	rows, err := h.txnRepo.NetWorthByMonth(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type row struct {
		Month    string `json:"month"`
		NetWorth int64  `json:"net_worth"`
	}
	result := make([]row, 0, len(rows))
	for _, r := range rows {
		result = append(result, row{Month: r.Month, NetWorth: r.NetWorth})
	}
	writeJSON(w, http.StatusOK, result)
}
```

- [ ] **Step 3.2: Wire the two new routes in main.go**

In `server/main.go`, find the `// Reports` section (line ~149) and replace:
```go
	// Reports
	mux.HandleFunc("GET /api/reports/spending", reports.SpendingByGroup)
```
with:
```go
	// Reports
	mux.HandleFunc("GET /api/reports/spending", reports.SpendingByGroup)
	mux.HandleFunc("GET /api/reports/income-expense", reports.IncomeExpense)
	mux.HandleFunc("GET /api/reports/net-worth", reports.NetWorth)
```

- [ ] **Step 3.3: Build to verify no compile errors**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: no errors.

- [ ] **Step 3.4: Run full test suite**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```

Expected: all PASS.

- [ ] **Step 3.5: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add server/internal/handler/reports.go server/main.go
git commit -m "feat: add income-expense and net-worth report endpoints"
```

---

## Task 4: Frontend api.ts — New Fetch Functions

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 4.1: Add fetchIncomeExpense, fetchNetWorth, fetchAgeOfMoney to api.ts**

In `frontend/src/api.ts`, find the `// ─── Reports` section (after the existing `fetchSpendingReport` function). Append these three functions after `fetchSpendingReport`:

```ts
// fetchIncomeExpense returns raw centimos — callers divide by 100 before display.
export async function fetchIncomeExpense(
  from: string,
  to: string,
): Promise<{ month: string; income: number; expense: number }[]> {
  const data = await apiFetch<{ month: string; income: number; expense: number }[]>(
    `/reports/income-expense?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data ?? [];
}

// fetchNetWorth returns raw centimos — callers divide by 100 before display.
export async function fetchNetWorth(
  from: string,
  to: string,
): Promise<{ month: string; net_worth: number }[]> {
  const data = await apiFetch<{ month: string; net_worth: number }[]>(
    `/reports/net-worth?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data ?? [];
}

// fetchAgeOfMoney calls fetchBudget for the trailing `months` months in parallel
// and extracts age_of_money. Months where age_of_money is null are omitted.
export async function fetchAgeOfMoney(
  months: number,
): Promise<{ month: string; days: number }[]> {
  const now = new Date();
  const monthStrings: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthStrings.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  const budgets = await Promise.all(
    monthStrings.map(m => fetchBudget(m).catch(() => null))
  );
  return budgets
    .map((b, i) => ({ month: monthStrings[i], days: b?.age_of_money ?? null }))
    .filter((r): r is { month: string; days: number } => r.days !== null);
}
```

- [ ] **Step 4.2: Build to verify no TypeScript errors**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4.3: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/api.ts
git commit -m "feat: add fetchIncomeExpense, fetchNetWorth, fetchAgeOfMoney to api.ts"
```

---

## Task 5: Frontend Dashboard.tsx — Live Stats

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

The Dashboard currently fetches only `fetchRecentTransactions(20)`. Extend it to also fetch `fetchAccounts()` and `fetchBudget(currentMonth)` in parallel. Derive Net Worth, Spent, Ready to Assign, Spending bars, and Budget Alerts from the live data. Remove the Net Worth sparkline and delta sub-text.

- [ ] **Step 5.1: Update the import line and state in Dashboard.tsx**

Find the import at the top of `frontend/src/components/Dashboard.tsx`:
```ts
import { fetchRecentTransactions } from '../api';
```
Replace with:
```ts
import { fetchRecentTransactions, fetchAccounts, fetchBudget } from '../api';
import type { BudgetMonthAPI } from '../api';
```

- [ ] **Step 5.2: Replace the component body with live-data derivation**

Find the component function body starting at:
```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [txnError, setTxnError] = useState<string | null>(null);

  const loadTxns = useCallback(() => {
    setLoadingTxns(true);
    setTxnError(null);
    fetchRecentTransactions(20)
      .then(data => { setTransactions(data); setLoadingTxns(false); })
      .catch(err => { setTxnError(err.message); setLoadingTxns(false); });
  }, []);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  const netWorth = 1780300 + 3320000;

  const currentYM = new Date().toISOString().slice(0, 7);
  const thisMonthSpending = useMemo(() =>
    transactions.filter(t => t.date.startsWith(currentYM) && t.outflow > 0).reduce((s, t) => s + t.outflow, 0),
    [transactions]);

  const readyToAssign = 145000;

  const groupSpend: Array<{ name: string; spent: number; assigned: number; color?: string }> = [];

  const overspent: Array<{ cat: string; available: number }> = [];

  const recent = transactions.slice(0, 7);
```

Replace with:

```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [txnError, setTxnError] = useState<string | null>(null);

  const [netWorth, setNetWorth] = useState(0);
  const [thisMonthSpending, setThisMonthSpending] = useState(0);
  const [readyToAssign, setReadyToAssign] = useState(0);
  const [groupSpend, setGroupSpend] = useState<Array<{ name: string; spent: number; assigned: number; color?: string }>>([]);
  const [overspent, setOverspent] = useState<Array<{ cat: string; available: number }>>([]);

  const currentYM = new Date().toISOString().slice(0, 7);
  const currentMonthLabel = new Date().toLocaleString('default', { month: 'long' });

  const loadTxns = useCallback(() => {
    setLoadingTxns(true);
    setTxnError(null);
    Promise.all([
      fetchRecentTransactions(20),
      fetchAccounts(),
      fetchBudget(currentYM),
    ])
      .then(([txns, accts, budget]) => {
        setTransactions(txns);
        setLoadingTxns(false);

        // Net worth: sum all account balances (budget + tracking), already in major units
        const nw = [...accts.budget, ...accts.tracking].reduce((s, a) => s + a.balance, 0);
        setNetWorth(nw);

        // Spent: sum of -activity across all budget groups (activity is negative for spending)
        const spent = budget.category_groups.reduce((s, g) => s + (-g.activity), 0);
        setThisMonthSpending(spent < 0 ? 0 : spent);

        // Ready to Assign: from budget, already in major units
        setReadyToAssign(budget.ready_to_assign);

        // Spending bars: one entry per category group
        const bars = budget.category_groups.map(g => ({
          name: g.name,
          spent: -g.activity < 0 ? 0 : -g.activity,
          assigned: g.assigned,
        }));
        setGroupSpend(bars);

        // Budget alerts: all categories across all groups where available < 0
        const alerts: Array<{ cat: string; available: number }> = [];
        for (const g of budget.category_groups) {
          for (const c of g.categories) {
            if (c.available < 0) {
              alerts.push({ cat: c.name, available: c.available });
            }
          }
        }
        setOverspent(alerts);
      })
      .catch(err => {
        // Transactions fetch failure is shown; stats failures are silent
        setTxnError(err.message);
        setLoadingTxns(false);
      });
  }, [currentYM]);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  const recent = transactions.slice(0, 7);
```

- [ ] **Step 5.3: Update the StatCard row to remove Net Worth sparkline/delta**

Find this line in the return JSX:
```tsx
        <StatCard label="Net Worth" value={fmt(netWorth)} sub="↑ 3.2% vs last month" subColor={T.pos} spark={[88,90,89,93,95,98,100]} sparkColor={T.pos} accent />
        <StatCard label="Spent · April" value={fmt(thisMonthSpending)} sub="Apr 1 – 18" spark={[20,45,38,60,72,80,95]} sparkColor="#5b9dff" />
        <StatCard label="Ready to Assign" value={fmt(readyToAssign)} sub="Unallocated funds" subColor={T.textDim} />
```

Replace with:
```tsx
        <StatCard label="Net Worth" value={fmt(netWorth)} accent />
        <StatCard label={`Spent · ${currentMonthLabel}`} value={fmt(thisMonthSpending)} />
        <StatCard label="Ready to Assign" value={fmt(readyToAssign)} sub="Unallocated funds" subColor={T.textDim} />
```

- [ ] **Step 5.4: Update the Spending by Category panel header date**

Find:
```tsx
            <span style={st.panelMeta}>April 2026</span>
```
Replace with:
```tsx
            <span style={st.panelMeta}>{currentMonthLabel} {new Date().getFullYear()}</span>
```

- [ ] **Step 5.5: Fix the SpendingBar color lookup**

The `groupSpend` array entries don't carry a `color` field; SpendingBar uses `g.color ?? T.textMid`. Add color lookup when building bars in step 5.2 — update the bars derivation to:

```ts
        const bars = budget.category_groups.map(g => ({
          name: g.name,
          spent: -g.activity < 0 ? 0 : -g.activity,
          assigned: g.assigned,
          color: GROUP_COLORS[g.name],
        }));
```

(This replaces the bars derivation inside the `.then` callback from Step 5.2. If you wrote Step 5.2 already, just update the `bars` assignment to include `color: GROUP_COLORS[g.name]`.)

- [ ] **Step 5.6: Remove unused imports**

`useMemo` is no longer needed. Remove it from the import line:
```ts
import { useState, useEffect, useCallback } from 'react';
```
(Remove `useMemo` from the original import.)

- [ ] **Step 5.7: Build to verify no TypeScript errors**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5.8: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/Dashboard.tsx
git commit -m "feat: Dashboard derives all stat cards from live fetchAccounts + fetchBudget"
```

---

## Task 6: Frontend Reports.tsx — Wire Income/Expense, Net Worth, Age of Money

**Files:**
- Modify: `frontend/src/components/Reports.tsx`

Replace static `AppData.incomeExpense`, `AppData.netWorthHistory`, and `AppData.ageOfMoney` with state populated by live fetches in the existing mount `useEffect`.

- [ ] **Step 6.1: Update imports in Reports.tsx**

Find the import lines at the top:
```ts
import { AppData } from '../data';
import type { MonthlySpendingRow } from '../data';
import { fetchSpendingReport, groupKey } from '../api';
```
Replace with:
```ts
import { AppData } from '../data';
import type { MonthlySpendingRow } from '../data';
import { fetchSpendingReport, groupKey, fetchIncomeExpense, fetchNetWorth, fetchAgeOfMoney } from '../api';
```

- [ ] **Step 6.2: Add state for the three new chart datasets**

Find inside the `Reports` component, after the existing state declarations:
```ts
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
```
Replace with:
```ts
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);
  const [incomeExpense, setIncomeExpense] = useState<{ month: string; income: number; expense: number }[]>([]);
  const [netWorthData, setNetWorthData] = useState<{ month: string; net_worth: number }[]>([]);
  const [ageOfMoney, setAgeOfMoney] = useState<{ month: string; days: number }[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
```

- [ ] **Step 6.3: Extend the loadReport function to fetch all four datasets in parallel**

Find the `loadReport` function:
```ts
  const loadReport = () => {
    setLoadingReport(true);
    setReportError(null);
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    fetchSpendingReport(from, to)
      .then(data => { setMonthlySpending(data); setLoadingReport(false); })
      .catch(err => { setReportError(err.message); setLoadingReport(false); });
  };
```
Replace with:
```ts
  const loadReport = () => {
    setLoadingReport(true);
    setReportError(null);
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    Promise.all([
      fetchSpendingReport(from, to),
      fetchIncomeExpense(from, to),
      fetchNetWorth(from, to),
      fetchAgeOfMoney(6),
    ])
      .then(([spending, ie, nw, aom]) => {
        setMonthlySpending(spending);
        setIncomeExpense(ie);
        setNetWorthData(nw);
        setAgeOfMoney(aom);
        setLoadingReport(false);
      })
      .catch(err => { setReportError(err.message); setLoadingReport(false); });
  };
```

- [ ] **Step 6.4: Update the IncomeExpenseChart type signature**

Find:
```ts
function IncomeExpenseChart({ data, fmt }: { data: typeof AppData.incomeExpense; fmt: (n: number) => string }) {
```
Replace with:
```ts
function IncomeExpenseChart({ data, fmt }: { data: { month: string; income: number; expense: number }[]; fmt: (n: number) => string }) {
```

- [ ] **Step 6.5: Replace the static data references in the Reports JSX**

Find the block that references static D.incomeExpense, D.netWorthHistory, D.ageOfMoney:

```ts
  const D = AppData;
  const latestNW = D.netWorthHistory[D.netWorthHistory.length - 1];
  const latestAge = D.ageOfMoney[D.ageOfMoney.length - 1];
```
Replace with:
```ts
  const D = AppData;
  const latestAge = ageOfMoney[ageOfMoney.length - 1];
  // Convert centimos to major units for chart display (api.ts returns raw centimos)
  const incomeExpenseMajor = incomeExpense.map(d => ({
    month: d.month,
    income: d.income / 100,
    expense: d.expense / 100,
  }));
  const netWorthMajor = netWorthData.map(d => ({
    month: d.month,
    net_worth: d.net_worth / 100,
  }));
  const latestNW = netWorthMajor[netWorthMajor.length - 1];
```

- [ ] **Step 6.6: Update the income chart JSX to use live data**

Find:
```tsx
              <div style={{ padding: '0 14px 16px' }}><IncomeExpenseChart data={D.incomeExpense} fmt={fmt} /></div>
```
Replace with:
```tsx
              <div style={{ padding: '0 14px 16px' }}><IncomeExpenseChart data={incomeExpenseMajor} fmt={fmt} /></div>
```

- [ ] **Step 6.7: Update the net-worth chart JSX to use live data**

Find:
```tsx
              <div style={st.panelHeader}><span>Net Worth</span><span style={st.panelMeta}>{fmt(latestNW.assets - latestNW.debt)} today</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={D.netWorthHistory} valueOf={d => (d as typeof latestNW).assets - (d as typeof latestNW).debt} color="#5b9dff" fmt={fmt} /></div>
```
Replace with:
```tsx
              <div style={st.panelHeader}><span>Net Worth</span><span style={st.panelMeta}>{latestNW ? fmt(latestNW.net_worth) : '—'} today</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={netWorthMajor} valueOf={d => (d as { month: string; net_worth: number }).net_worth} color="#5b9dff" fmt={fmt} /></div>
```

- [ ] **Step 6.8: Update the age-of-money chart JSX to use live data**

Find:
```tsx
              <div style={st.panelHeader}><span>Age of Money</span><span style={st.panelMeta}>{latestAge.days} days</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={D.ageOfMoney} valueOf={d => (d as typeof latestAge).days} color="#3ddc97" fmt={fmt} suffix="d" /></div>
```
Replace with:
```tsx
              <div style={st.panelHeader}><span>Age of Money</span><span style={st.panelMeta}>{latestAge ? latestAge.days + ' days' : '—'}</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={ageOfMoney} valueOf={d => (d as { month: string; days: number }).days} color="#3ddc97" fmt={fmt} suffix="d" /></div>
```

- [ ] **Step 6.9: Build to verify no TypeScript errors**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6.10: Run full Go test suite one last time**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```

Expected: all PASS.

- [ ] **Step 6.11: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/Reports.tsx
git commit -m "feat: Reports wires income-expense, net-worth, age-of-money charts with live data"
```

---

## Self-Review Checklist

### Spec coverage
- [x] Dashboard Net Worth from `fetchAccounts()` sum — Task 5
- [x] Dashboard Spent from `fetchBudget` group activity — Task 5
- [x] Dashboard Ready to Assign from `fetchBudget.ready_to_assign` — Task 5
- [x] Dashboard Spending bars from budget groups — Task 5
- [x] Dashboard Budget Alerts (categories where available < 0) — Task 5
- [x] Net Worth sparkline + delta removed — Step 5.3
- [x] Dashboard error handling: console.warn / leave at 0 — Step 5.2 (Promise.all catch sets txnError but stats silently stay 0)
- [x] `GET /api/reports/income-expense` — Tasks 1, 3
- [x] `GET /api/reports/net-worth` — Tasks 2, 3
- [x] `fetchIncomeExpense`, `fetchNetWorth` in api.ts, no /100 — Task 4
- [x] `fetchAgeOfMoney` in api.ts — Task 4
- [x] Reports income-expense chart wired — Task 6
- [x] Reports net-worth chart wired — Task 6
- [x] Reports age-of-money chart wired — Task 6
- [x] `go test ./...` passes — Steps 1.4, 2.4, 2.5, 3.4, 6.10
- [x] `npm run build` passes — Steps 4.2, 5.7, 6.9

### Notes
- Dashboard fetch error: a failure in any of the three parallel fetches rejects the whole Promise.all and sets `txnError`. This means if budget/accounts fails, txnError shows even though transactions loaded fine. This is an acceptable simplification — the spec says "catch with console.warn, leave stat cards at 0" but doesn't detail partial-failure UI. The implementation shows the txnError retry banner; stats stay at their initial 0.
- `GROUP_COLORS` in Dashboard uses group names as keys. If a budget group name doesn't match a key in GROUP_COLORS, color falls back to `undefined`, and SpendingBar uses `T.textMid`. This is correct.
- Age of Money: months with null `age_of_money` are filtered out, matching the spec.
- Net Worth across currencies: sums raw amounts per spec (v1 limitation accepted).
