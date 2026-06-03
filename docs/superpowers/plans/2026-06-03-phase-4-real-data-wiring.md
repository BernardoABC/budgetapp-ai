# Phase 4: Wire Reports & Dashboard to Real Data + Import History UI

> **Status: COMPLETED — 2026-06-03**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all static/hardcoded data in Reports and Dashboard with live API calls, and add an Import History table to the Import page.

**Architecture:** Three independent frontend changes (Reports, Dashboard, Import history) plus one new backend endpoint (spending report). Backend changes are isolated to a new handler file + one new repo method. Frontend changes remove props from App.tsx and fetch inside each component on mount.

**Tech Stack:** Go 1.26 / pgx v5 / PostgreSQL 18 (backend); React 19 + TypeScript + Vite, inline styles only (frontend).

---

## File Map

| File | Change |
|------|--------|
| `server/internal/repository/transaction_repo.go` | Add `SpendingByGroup(ctx, from, to string)` method |
| `server/internal/handler/reports.go` | New: `ReportsHandler` with `SpendingByGroup` HTTP handler |
| `server/main.go` | Wire `GET /api/reports/spending` route |
| `frontend/src/api.ts` | Add `fetchSpendingReport(from, to)` and `fetchRecentTransactions(limit)` |
| `frontend/src/components/Reports.tsx` | Remove `monthlySpending` prop; fetch on mount |
| `frontend/src/components/Dashboard.tsx` | Remove `transactions` prop; fetch on mount |
| `frontend/src/components/Import.tsx` | Add Import History section below wizard |
| `frontend/src/App.tsx` | Remove static `monthlySpending`/`transactions` refs and props |

---

## Task 1: Backend — SpendingByGroup repo method

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`

The method returns rows of `(month, group_name, total_centimos)` for outflow transactions in the given inclusive month range.

- [ ] **Step 1: Add the method to TransactionRepo**

Open `server/internal/repository/transaction_repo.go` and append:

```go
// SpendingByGroupRow is one (month, group) spend total in centimos (outflows only).
type SpendingByGroupRow struct {
	Month     string
	GroupName string
	Total     int64
}

// SpendingByGroup returns outflow totals grouped by category group and calendar
// month for the given inclusive YYYY-MM range. Transactions with no category are
// excluded.
func (r *TransactionRepo) SpendingByGroup(ctx context.Context, from, to string) ([]SpendingByGroupRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			to_char(date_trunc('month', t.date::date), 'YYYY-MM') AS month,
			cg.name AS group_name,
			SUM(ABS(t.amount))::bigint AS total
		FROM transactions t
		JOIN categories c  ON c.id = t.category_id
		JOIN category_groups cg ON cg.id = c.group_id
		WHERE t.amount < 0
		  AND t.date >= ($1 || '-01')::date
		  AND t.date <  (($2 || '-01')::date + INTERVAL '1 month')
		GROUP BY month, cg.name
		ORDER BY month, cg.name
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("spending by group: %w", err)
	}
	defer rows.Close()
	var out []SpendingByGroupRow
	for rows.Next() {
		var row SpendingByGroupRow
		if err := rows.Scan(&row.Month, &row.GroupName, &row.Total); err != nil {
			return nil, fmt.Errorf("scan spending row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: no output (clean build).

- [ ] **Step 3: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add server/internal/repository/transaction_repo.go
git commit -m "feat: add SpendingByGroup repo method for reports endpoint"
```

---

## Task 2: Backend — Reports HTTP handler

**Files:**
- Create: `server/internal/handler/reports.go`
- Modify: `server/main.go`

Response shape: `[{ "month": "YYYY-MM", "groups": [{ "name": "Housing", "total": 52200000 }] }]`

- [ ] **Step 1: Create handler/reports.go**

```go
package handler

import (
	"net/http"

	"budgetapp/internal/repository"
)

type ReportsHandler struct {
	txnRepo *repository.TransactionRepo
}

func NewReportsHandler(txnRepo *repository.TransactionRepo) *ReportsHandler {
	return &ReportsHandler{txnRepo: txnRepo}
}

type spendingGroup struct {
	Name  string `json:"name"`
	Total int64  `json:"total"`
}

type spendingMonth struct {
	Month  string          `json:"month"`
	Groups []spendingGroup `json:"groups"`
}

// SpendingByGroup handles GET /api/reports/spending?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) SpendingByGroup(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}

	rows, err := h.txnRepo.SpendingByGroup(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	// Pivot flat rows into per-month buckets.
	order := []string{}
	byMonth := map[string]*spendingMonth{}
	for _, row := range rows {
		if _, ok := byMonth[row.Month]; !ok {
			byMonth[row.Month] = &spendingMonth{Month: row.Month, Groups: []spendingGroup{}}
			order = append(order, row.Month)
		}
		byMonth[row.Month].Groups = append(byMonth[row.Month].Groups, spendingGroup{
			Name:  row.GroupName,
			Total: row.Total,
		})
	}

	result := make([]spendingMonth, 0, len(order))
	for _, m := range order {
		result = append(result, *byMonth[m])
	}
	writeJSON(w, http.StatusOK, result)
}
```

- [ ] **Step 2: Wire the route in main.go**

In `server/main.go`, after the existing repos are declared (around line 45), the `txnRepo` variable already exists. Add the `reports` handler and its route:

After the line `budgets  := handler.NewBudgetHandler(budgetSvc)` (around line 86), add:
```go
reports  := handler.NewReportsHandler(txnRepo)
```

After the budget routes (around line 132), add:
```go
// Reports
mux.HandleFunc("GET /api/reports/spending", reports.SpendingByGroup)
```

- [ ] **Step 3: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: no output.

- [ ] **Step 4: Run all Go tests**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```

Expected: all existing tests pass (PASS lines, no FAIL).

- [ ] **Step 5: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add server/internal/handler/reports.go server/main.go
git commit -m "feat: add GET /api/reports/spending endpoint"
```

---

## Task 3: Frontend api.ts — two new fetch functions

**Files:**
- Modify: `frontend/src/api.ts`

`fetchSpendingReport` calls the new backend endpoint and returns data keyed for the existing `MonthlySpendingRow` type. `fetchRecentTransactions` merges the first page of all budget accounts and returns the top N by date.

- [ ] **Step 1: Add types and functions to api.ts**

After the existing imports at the top of `frontend/src/api.ts`, add the import for `MonthlySpendingRow`:
```ts
import type {
  Account,
  Transaction,
  CategoryGroup,
  CategoryGroupAPI,
  CategoryItemAPI,
  MonthlySpendingRow,
} from './data';
```

At the bottom of `frontend/src/api.ts`, append:

```ts
// ─── Reports ─────────────────────────────────────────────────────────────────

interface SpendingApiMonth {
  month: string;
  groups: { name: string; total: number }[];
}

const groupKey = (g: string) => g.toLowerCase().split(' ')[0];

export async function fetchSpendingReport(from: string, to: string): Promise<MonthlySpendingRow[]> {
  const data = await apiFetch<SpendingApiMonth[]>(
    `/reports/spending?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  return data.map(m => {
    const row: MonthlySpendingRow = {
      month: m.month,
      housing: 0, food: 0, transport: 0, entertainment: 0, health: 0, savings: 0,
    };
    for (const g of m.groups) {
      const key = groupKey(g.name);
      if (key in row) (row as Record<string, string | number>)[key] = g.total;
    }
    return row;
  });
}

// ─── Recent Transactions ──────────────────────────────────────────────────────

export async function fetchRecentTransactions(limit: number): Promise<Transaction[]> {
  const accs = await fetchAccounts();
  const pages = await Promise.all(
    accs.budget.map(a => fetchAccountTransactions(a.id, 1, limit).catch(() => [] as Transaction[]))
  );
  return pages
    .flat()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}
```

- [ ] **Step 2: TypeScript build check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: build completes without TypeScript errors. (Vite output or "✓ built in …" line.)

- [ ] **Step 3: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/api.ts
git commit -m "feat: add fetchSpendingReport and fetchRecentTransactions to api.ts"
```

---

## Task 4: Frontend Reports.tsx — fetch on mount, remove prop

**Files:**
- Modify: `frontend/src/components/Reports.tsx`
- Modify: `frontend/src/App.tsx`

The component fetches the trailing 6 months on mount. The date inputs remain functional for future use. The `monthlySpending` prop is removed.

- [ ] **Step 1: Update Reports.tsx**

Replace the top of the file (lines 1–6) — the imports and groupKey — and the Props interface + component signature:

Change:
```tsx
import { useState } from 'react';
import { T, GROUP_COLORS } from '../theme';
import { AppData } from '../data';
import type { MonthlySpendingRow } from '../data';

const groupKey = (g: string) => g.toLowerCase().split(' ')[0];
```

To:
```tsx
import { useState, useEffect } from 'react';
import { T, GROUP_COLORS } from '../theme';
import { AppData } from '../data';
import type { MonthlySpendingRow } from '../data';
import { fetchSpendingReport } from '../api';

const groupKey = (g: string) => g.toLowerCase().split(' ')[0];
```

Change the Props interface and component signature (lines 185–190):
```tsx
interface Props {
  fmt: (n: number) => string;
}

export function Reports({ fmt }: Props) {
  const [activeReport, setActiveReport] = useState('trend');
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);
```

Add a `useEffect` to fetch data right after the `useState` for `activeReport` (before the `const D = AppData;` line):
```tsx
  useEffect(() => {
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    fetchSpendingReport(from, to)
      .then(setMonthlySpending)
      .catch(err => console.warn('Failed to load spending report:', err.message));
  }, []);
```

- [ ] **Step 2: Update App.tsx to remove monthlySpending**

In `frontend/src/App.tsx`, remove **only** the `monthlySpending` line from the "Still static" block. Change:
```tsx
  // Still static
  const { monthlySpending } = AppData;
  const transactions = AppData.transactions;
```
To:
```tsx
  // Still static
  const transactions = AppData.transactions;
```

Change the Reports render (line ~154):
```tsx
{page === 'reports' && <Reports monthlySpending={monthlySpending} fmt={fmtBound} />}
```
To:
```tsx
{page === 'reports' && <Reports fmt={fmtBound} />}
```

- [ ] **Step 3: Build check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: clean build with no TypeScript errors. (`transactions` is still in App.tsx for Dashboard until Task 5.)

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Reports.tsx frontend/src/App.tsx
git commit -m "feat: Reports fetches real spending data from API on mount"
```

---

## Task 5: Frontend Dashboard.tsx — fetch on mount, remove prop

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`
- Modify: `frontend/src/App.tsx`

Remove the `transactions` prop from Dashboard and fetch 20 recent transactions on mount.

- [ ] **Step 1: Update Dashboard.tsx**

Replace line 1–3 (the imports):
```tsx
import { useMemo } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { Transaction, CategoryGroup } from '../data';
```
With:
```tsx
import { useMemo, useState, useEffect } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { Transaction, CategoryGroup } from '../data';
import { fetchRecentTransactions } from '../api';
```

Change the Props interface (lines 5–10) — remove `transactions`:
```tsx
interface Props {
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  onNavigate: (page: string, accountId?: string) => void;
}
```

Change the component signature and add state + effect (lines 72–77):
```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    fetchRecentTransactions(20)
      .then(setTransactions)
      .catch(err => console.warn('Failed to load recent transactions:', err.message));
  }, []);

  const netWorth = 1780300 + 3320000;
```

- [ ] **Step 2: Update App.tsx**

In `frontend/src/App.tsx`, remove the `transactions` line from the "Still static" block. Change:
```tsx
  // Still static
  const transactions = AppData.transactions;
```
To (delete the two lines entirely — the comment can go too).

Change the Dashboard render (line ~150):
```tsx
{page === 'dashboard' && <Dashboard transactions={transactions} categoryGroups={categoryGroups} fmt={fmtBound} onNavigate={navigate} />}
```
To:
```tsx
{page === 'dashboard' && <Dashboard categoryGroups={categoryGroups} fmt={fmtBound} onNavigate={navigate} />}
```

- [ ] **Step 3: Build check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: clean build with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Dashboard.tsx frontend/src/App.tsx
git commit -m "feat: Dashboard fetches 20 recent transactions from API on mount"
```

---

## Task 6: Frontend Import.tsx — Import History section

**Files:**
- Modify: `frontend/src/components/Import.tsx`

Add an `ImportHistory` component and render it below the wizard. It fetches `GET /api/imports` on mount. The `ImportRecord` shape from the backend: `{ id, account_id, filename, imported_at, transaction_count, status }`.

- [ ] **Step 1: Add ImportRecord type and fetchImportHistory to api.ts**

Append to `frontend/src/api.ts`:

```ts
// ─── Import History ───────────────────────────────────────────────────────────

export interface ImportRecord {
  id: string;
  account_id: string;
  filename: string;
  imported_at: string;
  transaction_count: number;
  status: string;
}

export async function fetchImportHistory(): Promise<ImportRecord[]> {
  return apiFetch<ImportRecord[]>('/imports');
}
```

- [ ] **Step 2: Add ImportHistory component and render it in Import.tsx**

In `frontend/src/components/Import.tsx`, add the import at the top alongside existing imports:

Change:
```tsx
import { useState, useRef, useCallback } from 'react';
import { T } from '../theme';
import { categorize } from '../engine';
import { AppData } from '../data';
import type { CategoryGroup } from '../data';
```
To:
```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../theme';
import { categorize } from '../engine';
import { AppData } from '../data';
import type { CategoryGroup } from '../data';
import { fetchImportHistory, fetchAccounts } from '../api';
import type { ImportRecord } from '../api';
import type { Account } from '../data';
```

Add the `ImportHistory` component definition just before the `const st = {` object at the bottom of the file (before line 213):

```tsx
function ImportHistory() {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    fetchImportHistory()
      .then(setRecords)
      .catch(err => console.warn('Failed to load import history:', err.message));
    fetchAccounts()
      .then(accs => setAccounts([...accs.budget, ...accs.tracking]))
      .catch(() => {});
  }, []);

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return s; }
  };

  if (records.length === 0) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto 28px', padding: '0 24px' }}>
      <div style={stHistory.panel}>
        <div style={stHistory.header}>Import History</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['File', 'Account', 'Transactions', 'Date', 'Status'].map(h => (
                  <th key={h} style={{ ...stHistory.th, textAlign: h === 'Transactions' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={stHistory.td}>{r.filename}</td>
                  <td style={stHistory.td}>{accountName(r.account_id)}</td>
                  <td style={{ ...stHistory.td, textAlign: 'right', fontFamily: T.mono }}>{r.transaction_count}</td>
                  <td style={{ ...stHistory.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{fmtDate(r.imported_at)}</td>
                  <td style={stHistory.td}>
                    <span style={{ ...stHistory.badge, background: r.status === 'completed' ? 'rgba(61,220,151,0.12)' : 'rgba(246,196,90,0.12)', color: r.status === 'completed' ? T.pos : T.warn }}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const stHistory = {
  panel:  { background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', boxShadow: T.shadow },
  header: { padding: '14px 18px', fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, letterSpacing: '-0.01em' },
  th:     { padding: '10px 18px', fontSize: 10, fontWeight: 700, color: T.textDim, letterSpacing: '0.06em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' as const, background: 'rgba(255,255,255,0.015)' },
  td:     { padding: '10px 18px', fontSize: 13, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}`, transition: 'background 0.1s' },
  badge:  { display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' as const },
};
```

Add `<ImportHistory />` to the `ImportWizard` render, just before the closing `</div>` of the outer wrapper. Change the return in `ImportWizard` (lines 199–209):

```tsx
  return (
    <>
      <div style={{ padding: '28px 24px', maxWidth: 760, margin: '0 auto' }}>
        <StepIndicator step={step} />
        <div style={{ marginTop: 28 }}>
          {step === 0 && <Step1 accounts={accounts} onNext={info => { setUploadInfo(info); setStep(1); }} />}
          {step === 1 && <Step2 parsed={parsed} onChangeParsed={handleChangeParsed} categoryGroups={categoryGroups} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
          {step === 2 && <Step3 parsed={parsed} uploadInfo={uploadInfo ?? { file: { name: 'estado_cuenta_abril.csv' } }} onBack={() => setStep(1)} onConfirm={() => setDone(true)} />}
        </div>
      </div>
      <ImportHistory />
    </>
  );
```

- [ ] **Step 3: Build check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Import.tsx frontend/src/api.ts
git commit -m "feat: add Import History table to Import page"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all Go tests**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```

Expected: all tests PASS, none FAIL.

- [ ] **Step 2: Full frontend build**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build
```

Expected: exits 0. No TypeScript errors. Vite outputs bundle sizes.

- [ ] **Step 3: Verify App.tsx has no remaining references to removed props**

```bash
grep -n "monthlySpending\|const transactions" /home/Berny/budgetapp-ai/frontend/src/App.tsx
```

Expected: no output (both references removed).

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
cd /home/Berny/budgetapp-ai
git status
```

If clean, no action needed. Otherwise commit any stray changes with an appropriate message.
