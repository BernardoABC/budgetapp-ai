# Phase 4 — Transaction Operations + Toast Foundation (Plan 1)

## Scope

This spec covers the first of two Phase 4 Polish plans:

- Backend: full-featured `GET /api/accounts/{id}/transactions` (search, filter, sort, pagination, summary)
- Backend: `PATCH /api/transactions/batch` (categorize, clear, unclear, delete)
- Frontend: server-driven Accounts.tsx (debounced search, prev/next pagination, summary stat strip, bulk action bar, all-column sort, confirm-on-delete)
- Frontend: cleared-toggle persistence via `PUT /api/transactions/{id}`
- Frontend: `ToastProvider` + `useToast()` + `ToastContainer` replacing `console.error` in the Accounts view

**Out of scope for this plan:** Payee Rules full-stack CRUD; toast/loading/empty/error sweep across Dashboard, Reports, Budget, Import (Plan 2).

---

## 1. Backend — List Endpoint Upgrade

### 1.1 Filter struct

```go
// server/internal/repository/transaction_repo.go
type TxnFilter struct {
    Search     string   // ILIKE payee OR memo
    FromDate   string   // "YYYY-MM-DD"
    ToDate     string   // "YYYY-MM-DD"
    CategoryID string   // UUID or "none" (uncategorized) or "" (all)
    Cleared    *bool    // nil = all, true/false = filtered
    MinAmount  *int64   // centimos abs value (unsigned); applies to abs(amount)
    MaxAmount  *int64   // centimos abs value (unsigned)
    Sort       string   // "date_desc"(default) | "date_asc" | "payee_asc" | "payee_desc"
                        // | "category_asc" | "category_desc" | "memo_asc" | "memo_desc"
                        // | "amount_asc" | "amount_desc" | "cleared_asc" | "cleared_desc"
    Page       int      // 1-based, default 1
    PerPage    int      // default 50, max 200
}
```

### 1.2 Repo changes

`ListByAccount(ctx, accountID, filter TxnFilter) ([]Transaction, int64, Summary, error)`

WHERE clause is built once with `$N` placeholders. All three queries (COUNT, page SELECT, aggregate SELECT) share the same WHERE predicate — assembled into a helper that returns a `(whereSQL string, args []any)` tuple.

The aggregate query returns:
```sql
SELECT
  COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_inflow,
  COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_outflow,
  COALESCE(SUM(CASE WHEN cleared AND amount > 0 THEN amount
                    WHEN cleared AND amount < 0 THEN amount ELSE 0 END), 0) AS cleared_balance,
  COALESCE(SUM(CASE WHEN NOT cleared THEN amount ELSE 0 END), 0) AS uncleared_balance
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE <shared-where>
```

Sort mapping is a whitelist (switch statement) — no raw sort string injected into SQL.

```go
type TxnSummary struct {
    TotalInflow      int64
    TotalOutflow     int64
    ClearedBalance   int64
    UnclearedBalance int64
}
```

### 1.3 Handler changes

`transactions.go` — `ListByAccount` reads all new query params, constructs `TxnFilter`, calls updated repo method. Response shape:

```json
{
  "transactions": [...],
  "pagination": { "page": 1, "per_page": 50, "total": 332, "total_pages": 7 },
  "summary": {
    "total_inflow": 96800000,
    "total_outflow": 107484931,
    "cleared_balance": 24500000,
    "uncleared_balance": -98956700
  }
}
```

All amounts centimos. `total_outflow` is returned as a positive magnitude (absolute value) — the frontend decides the sign/display.

**Breaking change note:** response shape changes from `{transactions, total, page, per_page}` to the above. `fetchAccountTransactions` in `api.ts` is updated in the same commit — no other callers outside the frontend.

---

## 2. Backend — Batch Endpoint

### 2.1 Route

`PATCH /api/transactions/batch`

### 2.2 Request body

```json
{ "transaction_ids": ["uuid1", "uuid2"],
  "action": "categorize",
  "category_id": "uuid-or-empty-string" }
```

Actions: `categorize` | `clear` | `unclear` | `delete`.
- `categorize`: `category_id` = UUID assigns that category; `category_id` = `""` uncategorizes (sets `category_id = NULL`).
- `clear` / `unclear`: set `cleared = true/false` on all rows.
- `delete`: deletes rows and reverses account balances.

### 2.3 Repo method

`BatchUpdate(ctx, ids []string, action string, categoryID string) (affected int64, error)`

All changes run in a single DB transaction. For `delete`, the method groups transactions by `account_id`, subtracts sum-of-amounts per account in one `UPDATE accounts SET balance = balance - $delta WHERE id = $account_id` per account group.

Batch categorize does **not** update `payee_rules` (rule learning stays on single inline edits and import).

### 2.4 Response

`HTTP 200 { "affected": N }` on success.
`HTTP 400` for unknown action or missing `category_id` when action is `categorize`.
`HTTP 500` on DB error.

---

## 3. Backend — Tests

New file `server/internal/repository/transaction_repo_test.go` following the pattern of `budget_repo_test.go`:
- Filter by search term (payee, memo)
- Filter by date range
- Filter by category (including `"none"`)
- Filter by cleared
- Sort by each supported column
- Summary aggregation correctness
- Batch categorize, clear/unclear, delete (balance reversal)

---

## 4. Frontend — `api.ts` additions

### 4.1 New types

```ts
export interface TxnPage {
  transactions: Transaction[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
  summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
}

export interface TxnFilter {
  search?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;
  cleared?: boolean;
  sort?: string;
  page?: number;
  per_page?: number;
}
```

### 4.2 New function

`fetchTransactionsPage(accountId, filter): Promise<TxnPage>` — builds query string from non-empty filter fields, converts centimos → major units on all summary and transaction amounts.

### 4.3 Updated function

`fetchAccountTransactions` — now calls `fetchTransactionsPage(id, { per_page: 200 })` and returns `.transactions` only. Callers (`fetchRecentTransactions`, Dashboard) are unaffected.

### 4.4 New batch function

`batchTransactions(ids, action, categoryId?): Promise<{ affected: number }>` — calls `PATCH /api/transactions/batch`.

---

## 5. Frontend — ToastProvider

`frontend/src/components/Toast.tsx` exports:
- `ToastContext` + `ToastProvider` wrapping component
- `useToast()` hook returning `{ success, error, info }` (each takes a message string)
- `ToastContainer` — absolutely positioned bottom-right stack, inline styles, 4s auto-dismiss, manual dismiss ✕ button. Three severity styles (green accent, red/neg, textDim).

`App.tsx` wraps the tree in `<ToastProvider>` and renders `<ToastContainer>` inside it (same pattern as the existing `CurrencyContext`).

---

## 6. Frontend — Accounts.tsx rewrite of data flow

### 6.1 State model

```ts
const [filter, setFilter] = useState<TxnFilter>({ sort: 'date_desc', page: 1, per_page: 50 });
const [txnPage, setTxnPage] = useState<TxnPage | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

`txns` is derived: `txnPage?.transactions ?? []`.

### 6.2 Fetch trigger

`useEffect` on `[accountId, filter]` — debounced for the `search` field only (300ms via `useRef` timer). Changing `accountId` resets `filter` to defaults (page 1).

### 6.3 Filter bar changes

- Search input searches payee **and memo** (the endpoint handles both via `ILIKE`).
- Category dropdown uses `category_id` values from `categoryGroups` (not names).
- Date from/to pickers unchanged.
- "Uncategorized" option (`category_id = "none"`) added to category dropdown.
- Sort dropdown or column header clicks update `filter.sort`; all columns (Date, Payee, Category, Memo, Outflow/Inflow, C) are sortable.

### 6.4 Stat strip

Reads from `txnPage.summary` (server-computed over full filtered set):
- Count from `pagination.total`
- Outflow from `summary.total_outflow`
- Inflow from `summary.total_inflow`

### 6.5 Pagination

Below the table: `Showing X–Y of N · [◀ Prev] [Next ▶]`. Prev/Next disabled at boundary. Clicking updates `filter.page`.

### 6.6 Bulk action bar

Appears below filter bar when `selected.size > 0`. Contains:

| Control | Behaviour |
|---------|-----------|
| `X selected` | Label |
| Category dropdown + "Apply" | Calls `batchTransactions(ids, 'categorize', categoryId)` → toast success/error → refetch |
| "Clear" button | `batchTransactions(ids, 'clear')` → refetch |
| "Unclear" button | `batchTransactions(ids, 'unclear')` → refetch |
| "Delete N" button | Confirm dialog → `batchTransactions(ids, 'delete')` → refetch + `onAccountsChanged()` |

After each action, `selected` resets to empty.

### 6.7 Cleared toggle

`onToggleCleared(id)` calls `updateTransaction(id, { ...currentFields, cleared: !current.cleared })` (optimistic update, revert on error + error toast).

### 6.8 Single-row delete

Moved from filter bar into a per-row context or the existing ✕ area. Requires confirm dialog before calling `deleteTransaction(id)` → refetch + `onAccountsChanged()`.

### 6.9 Loading / empty / error states

- **Loading:** spinner/skeleton message replaces table body while `loading === true`.
- **Empty (no transactions exist):** "No transactions yet — add one above" with CTA.
- **Empty (filters active, no results):** "No transactions match your filters" + "Clear filters" link.
- **Error:** error banner with message + "Retry" button.

All mutating operations use `useToast()` for success and error feedback.

---

## 7. Constraints

- Inline styles only — no CSS files, no Tailwind.
- Money in centimos server-side; frontend major-unit conversion in `api.ts` only.
- No new dependencies.
- `go test ./...` and `npm run build` must pass before done.

---

## Non-goals (Plan 2)

- Payee Rules full-stack CRUD
- Toast/loading/empty/error polish in Dashboard, Reports, Budget, Import
