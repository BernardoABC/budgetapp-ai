# Transfer Peer Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When viewing or editing a linked transfer transaction, show the peer account name and let the user click to navigate to and scroll-highlight the peer transaction.

**Architecture:** Two backend additions (peer account JOIN on all transaction reads; `highlight_id` filter that overrides pagination to the page containing the target transaction) feed three frontend changes (updated types in `api.ts`; `App.tsx` navigation handler; `Accounts.tsx` edit-mode display, read-mode badge, and scroll/flash). No DB schema changes — peer account is derived via JOIN.

**Tech Stack:** Go (pgx/v5, net/http), React, TypeScript, inline styles

---

### Task 1: Backend — `TransferPeerAccountID` in model, repo, and handler

**Files:**
- Modify: `server/internal/model/transaction.go`
- Modify: `server/internal/repository/transaction_repo.go` — `ListByAccount` and `Get`
- Modify: `server/internal/handler/transactions.go` — `toResponse`
- Modify: `server/internal/testutil/helpers.go` — add `SeedLinkedPair`
- Modify: `server/internal/repository/transaction_repo_test.go`

**Context:** `model.Transaction` has `TransferPeerID string` (empty if not a transfer). We need to add `TransferPeerAccountID string` for the same pattern. The `ListByAccount` and `Get` queries both `LEFT JOIN categories c ON c.id = t.category_id` — we'll add a second LEFT JOIN on the peer transaction to get its `account_id`. The `toResponse` handler serialises all fields.

- [ ] **Step 1: Add field to the model**

In `server/internal/model/transaction.go`, add after `TransferPeerID`:

```go
TransferPeerAccountID string // empty if not a transfer
```

- [ ] **Step 2: Write the failing test**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_TransferPeerAccountID(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	idA, idB := testutil.SeedLinkedPair(t, pool, accA, accB, "2026-05-01", 5000)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// ListByAccount returns peer account id
	txns, _, _, _, err := repo.ListByAccount(ctx, accA, repository.TxnFilter{})
	if err != nil {
		t.Fatal(err)
	}
	var got string
	for _, tx := range txns {
		if tx.ID == idA {
			got = tx.TransferPeerAccountID
		}
	}
	if got != accB {
		t.Errorf("ListByAccount: want peer account %s got %q", accB, got)
	}

	// Get returns peer account id
	txA, err := repo.Get(ctx, idA)
	if err != nil {
		t.Fatal(err)
	}
	if txA.TransferPeerAccountID != accB {
		t.Errorf("Get: want peer account %s got %q", accB, txA.TransferPeerAccountID)
	}
	_ = idB
}
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_TransferPeerAccountID
```

Expected: FAIL — `SeedLinkedPair` not defined, return arity mismatch.

- [ ] **Step 4: Add `SeedLinkedPair` test helper**

Append to `server/internal/testutil/helpers.go`:

```go
// SeedLinkedPair inserts two linked transfer transactions: accA gets -amount,
// accB gets +amount, both pointing at each other via transfer_peer_id.
// Returns (idA, idB).
func SeedLinkedPair(t *testing.T, pool *pgxpool.Pool, accA, accB, date string, amount int64) (string, string) {
	t.Helper()
	ctx := context.Background()
	var idA, idB string
	err := pool.QueryRow(ctx,
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accA, date, -amount,
	).Scan(&idA)
	if err != nil {
		t.Fatalf("SeedLinkedPair A: %v", err)
	}
	err = pool.QueryRow(ctx,
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accB, date, amount,
	).Scan(&idB)
	if err != nil {
		t.Fatalf("SeedLinkedPair B: %v", err)
	}
	_, err = pool.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $2::uuid WHERE id = $1::uuid`,
		idA, idB,
	)
	if err != nil {
		t.Fatalf("SeedLinkedPair link A: %v", err)
	}
	_, err = pool.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $2::uuid WHERE id = $1::uuid`,
		idB, idA,
	)
	if err != nil {
		t.Fatalf("SeedLinkedPair link B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id IN ($1::uuid, $2::uuid)`, idA, idB)
	})
	return idA, idB
}
```

- [ ] **Step 5: Update `ListByAccount` — add peer JOIN and scan**

In `server/internal/repository/transaction_repo.go`, in `ListByAccount`, the main SELECT query (lines ~149–170) currently starts with:
```go
rows, err := r.pool.Query(ctx, `
    SELECT t.id::text, t.account_id::text,
           COALESCE(t.category_id::text,''), COALESCE(c.name,''),
           t.date::text, t.amount, t.currency,
           COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
           t.exchange_rate, t.reconciled,
           COALESCE(t.transfer_peer_id::text,''),
           COALESCE(
             json_agg(
               json_build_object('category', c2.name, 'amount', s.amount)
               ORDER BY s.created_at
             ) FILTER (WHERE s.id IS NOT NULL),
             '[]'::json
           ) AS splits
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN transaction_splits s ON s.transaction_id = t.id
    LEFT JOIN categories c2 ON c2.id = s.category_id
    WHERE `+where+`
    GROUP BY t.id, c.name
    ORDER BY `+sortClause(f.Sort)+`
    LIMIT `+limPlace+` OFFSET `+offPlace, pageArgs...)
```

Replace with (add peer JOIN, peer account_id in SELECT, peer.account_id in GROUP BY):

```go
rows, err := r.pool.Query(ctx, `
    SELECT t.id::text, t.account_id::text,
           COALESCE(t.category_id::text,''), COALESCE(c.name,''),
           t.date::text, t.amount, t.currency,
           COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
           t.exchange_rate, t.reconciled,
           COALESCE(t.transfer_peer_id::text,''),
           COALESCE(peer.account_id::text,''),
           COALESCE(
             json_agg(
               json_build_object('category', c2.name, 'amount', s.amount)
               ORDER BY s.created_at
             ) FILTER (WHERE s.id IS NOT NULL),
             '[]'::json
           ) AS splits
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN transaction_splits s ON s.transaction_id = t.id
    LEFT JOIN categories c2 ON c2.id = s.category_id
    LEFT JOIN transactions peer ON peer.id = t.transfer_peer_id
    WHERE `+where+`
    GROUP BY t.id, c.name, peer.account_id
    ORDER BY `+sortClause(f.Sort)+`
    LIMIT `+limPlace+` OFFSET `+offPlace, pageArgs...)
```

Also update the `rows.Scan` call to include `&t.TransferPeerAccountID` after `&t.TransferPeerID`:

```go
if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
    &t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
    &t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &t.TransferPeerAccountID,
    &splitsJSON); err != nil {
    return nil, 0, summary, 0, fmt.Errorf("scan transaction: %w", err)
}
```

Note: the return signature of `ListByAccount` will change in Step 7 — for now leave it as-is and fix the compiler errors last.

- [ ] **Step 6: Update `Get` — add peer JOIN and scan**

In `Get` (lines ~195–233), replace the query and scan:

```go
err := r.pool.QueryRow(ctx, `
    SELECT t.id::text, t.account_id::text,
           COALESCE(t.category_id::text,''), COALESCE(c.name,''),
           t.date::text, t.amount, t.currency,
           COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
           t.exchange_rate, t.reconciled,
           COALESCE(t.transfer_peer_id::text,''),
           COALESCE(peer.account_id::text,''),
           COALESCE(
             json_agg(
               json_build_object('category', c2.name, 'amount', s.amount)
               ORDER BY s.created_at
             ) FILTER (WHERE s.id IS NOT NULL),
             '[]'::json
           ) AS splits
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN transaction_splits s ON s.transaction_id = t.id
    LEFT JOIN categories c2 ON c2.id = s.category_id
    LEFT JOIN transactions peer ON peer.id = t.transfer_peer_id
    WHERE t.id = $1
    GROUP BY t.id, c.name, peer.account_id
`, id).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
    &t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
    &t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &t.TransferPeerAccountID,
    &splitsJSON)
```

- [ ] **Step 7: Update `ListByAccount` return signature**

`ListByAccount` currently returns `([]model.Transaction, int64, TxnSummary, error)`. Change to `([]model.Transaction, int64, TxnSummary, int, error)` — the new `int` is `highlightPage` (always 0 in this task; Task 2 will populate it). Update all `return` statements in the function:

- `return nil, 0, summary, 0, fmt.Errorf(...)` for errors
- `return txns, total, summary, 0, rows.Err()` for the success path

Update the caller in `handler/transactions.go`:
```go
txns, total, summary, highlightPage, err := h.repo.ListByAccount(r.Context(), accountID, f)
```
And include `highlight_page` in the JSON response (always 0 for now):
```go
writeJSON(w, http.StatusOK, map[string]any{
    "transactions":   resp,
    "highlight_page": highlightPage,
    "pagination": map[string]any{
        "page":        p,
        "per_page":    pp,
        "total":       total,
        "total_pages": totalPages,
    },
    "summary": summary,
})
```

- [ ] **Step 8: Update `toResponse` to include `transfer_peer_account_id`**

In `handler/transactions.go`, in `toResponse`, add alongside `transfer_peer_id`:

```go
var transferPeerAccountID any = nil
if t.TransferPeerAccountID != "" {
    transferPeerAccountID = t.TransferPeerAccountID
}
```

And include in the returned map:
```go
"transfer_peer_account_id": transferPeerAccountID,
```

- [ ] **Step 9: Run the test**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_TransferPeerAccountID
```

Expected: PASS.

- [ ] **Step 10: Run full test suite**

```bash
cd /home/Berny/budgetapp-ai && make test
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add server/internal/model/transaction.go \
        server/internal/repository/transaction_repo.go \
        server/internal/handler/transactions.go \
        server/internal/testutil/helpers.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: add transfer_peer_account_id to transaction model and API response"
```

---

### Task 2: Backend — `highlight_id` filter and `highlight_page` response

**Files:**
- Modify: `server/internal/repository/transaction_repo.go` — `TxnFilter`, `ListByAccount`
- Modify: `server/internal/handler/transactions.go` — `ListByAccount` handler
- Modify: `server/internal/repository/transaction_repo_test.go`

**Context:** When a client passes `highlight_id=<uuid>`, the backend finds the page in `date_desc` order that contains that transaction and returns it (overriding the `page` param). The response includes `highlight_page: N` so the frontend can update its page state.

- [ ] **Step 1: Write the failing test**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_HighlightPage(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	// Seed 7 transactions on different dates (newest first in date_desc order)
	for i := 7; i >= 1; i-- {
		testutil.SeedTransactionFull(t, pool, acc, "", fmt.Sprintf("2026-05-%02d", i), -int64(i*100), "P", "", false)
	}
	// Seed the target on 2026-05-03 → it's the 5th row in date_desc order
	target := testutil.SeedTransactionFull(t, pool, acc, "", "2026-05-03", -999, "TARGET", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// per_page=3: target is on page 2 (rows 4-6 in date_desc)
	txns, _, _, hlPage, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{
		HighlightID: target,
		PerPage:     3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if hlPage != 2 {
		t.Errorf("want highlight_page 2 got %d", hlPage)
	}
	// The returned transactions should be the page containing the target
	found := false
	for _, tx := range txns {
		if tx.ID == target {
			found = true
		}
	}
	if !found {
		t.Errorf("target transaction not found in returned page")
	}
}
```

This test requires `fmt` — add it to imports if not present.

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_HighlightPage
```

Expected: FAIL — `HighlightID` field not found.

- [ ] **Step 3: Add `HighlightID` to `TxnFilter`**

In `server/internal/repository/transaction_repo.go`, in `TxnFilter`:

```go
HighlightID string // UUID; when set, returns the page containing this transaction
```

- [ ] **Step 4: Implement `highlight_page` computation in `ListByAccount`**

In `ListByAccount`, after the `offset` is computed (line ~122) and before the summary query, add:

```go
highlightPage := 0
if f.HighlightID != "" {
    var pos int64
    err := r.pool.QueryRow(ctx, `
        WITH target AS (
            SELECT date, created_at
            FROM transactions
            WHERE id = $1::uuid AND account_id = $2::uuid
        )
        SELECT COUNT(*) + 1
        FROM transactions t, target
        WHERE t.account_id = $2::uuid
          AND (t.date > target.date
               OR (t.date = target.date AND t.created_at > target.created_at))
    `, f.HighlightID, accountID).Scan(&pos)
    if err == nil && pos > 0 {
        highlightPage = int((pos-1)/int64(perPage)) + 1
        offset = (highlightPage - 1) * perPage
    }
}
```

Note: `pos` is the 1-based row number of the target in `date_desc` order. `highlightPage = ceil(pos / perPage)` computed with integer math: `(pos-1)/perPage + 1`.

Update the success return to pass `highlightPage`:
```go
return txns, total, summary, highlightPage, rows.Err()
```

- [ ] **Step 5: Parse `highlight_id` in the handler**

In `server/internal/handler/transactions.go`, in `ListByAccount`, add to the filter setup:

```go
f := repository.TxnFilter{
    Search:      q.Get("search"),
    FromDate:    q.Get("from_date"),
    ToDate:      q.Get("to_date"),
    CategoryID:  q.Get("category_id"),
    Sort:        q.Get("sort"),
    Page:        page,
    PerPage:     perPage,
    MinAmount:   parseAmountParam(q.Get("min_amount")),
    MaxAmount:   parseAmountParam(q.Get("max_amount")),
    HighlightID: q.Get("highlight_id"),
}
```

- [ ] **Step 6: Run the test**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_HighlightPage
```

Expected: PASS.

- [ ] **Step 7: Run full test suite**

```bash
cd /home/Berny/budgetapp-ai && make test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/internal/repository/transaction_repo.go \
        server/internal/handler/transactions.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: add highlight_id filter to ListByAccount for peer transaction navigation"
```

---

### Task 3: Frontend — update `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`

**Context:** `Transaction` needs `transfer_peer_account_id`. `TxnPage` needs `highlight_page`. `TxnFilterParams` needs `highlight_id`. `fetchTransactionsPage` must pass the new param. `mapApiTxn` must map the new field.

- [ ] **Step 1: Add `transfer_peer_account_id` to `Transaction` interface**

In `frontend/src/api.ts`, in the `Transaction` interface, add after `transfer_peer_id`:

```ts
transfer_peer_account_id?: string | null;
```

- [ ] **Step 2: Add `highlight_page` to `TxnPage`**

In the `TxnPage` interface:

```ts
export interface TxnPage {
  transactions: Transaction[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
  summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
  highlight_page?: number | null;
}
```

- [ ] **Step 3: Add `highlight_id` to `TxnFilterParams`**

```ts
export interface TxnFilterParams {
  search?: string;
  from_date?: string;
  to_date?: string;
  category_id?: string;
  cleared?: boolean;
  sort?: string;
  page?: number;
  per_page?: number;
  highlight_id?: string;
}
```

- [ ] **Step 4: Update `mapApiTxn` to pass through `transfer_peer_account_id`**

The `mapApiTxn` parameter type currently has `transfer_peer_id?: string | null`. Add alongside it:

```ts
function mapApiTxn(t: {
  id: string; date: string; payee: string; category: string | null; memo: string;
  cleared: boolean; account: string; currency: string; amount: number;
  exchange_rate?: number | null; reconciled?: boolean;
  splits?: { category: string; amount: number }[];
  transfer_peer_id?: string | null;
  transfer_peer_account_id?: string | null;
}): Transaction {
  const major = t.amount / 100;
  return {
    id: t.id, date: t.date, payee: t.payee, category: t.category,
    memo: t.memo, cleared: t.cleared, account: t.account,
    currency: t.currency, exchange_rate: t.exchange_rate,
    outflow: major < 0 ? -major : 0,
    inflow: major > 0 ? major : 0,
    reconciled: t.reconciled ?? false,
    splits: (t.splits ?? []).map(s => ({ category: s.category, amount: s.amount / 100 })),
    transfer_peer_id: t.transfer_peer_id ?? null,
    transfer_peer_account_id: t.transfer_peer_account_id ?? null,
  };
}
```

- [ ] **Step 5: Update `fetchTransactionsPage` to pass `highlight_id` and map `highlight_page`**

In `fetchTransactionsPage`:

```ts
if (filter.highlight_id) params.set('highlight_id', filter.highlight_id);
```

Add alongside the existing `params.set(...)` calls (before the `apiFetch` call).

Update the return to include `highlight_page`:

```ts
const data = await apiFetch<{
  transactions: ApiTxn[];
  pagination: TxnPage['pagination'];
  summary: { total_inflow: number; total_outflow: number; cleared_balance: number; uncleared_balance: number };
  highlight_page?: number | null;
}>(`/accounts/${accountId}/transactions?${params}`);

return {
  transactions: (data.transactions ?? []).map(mapApiTxn),
  pagination: data.pagination,
  highlight_page: data.highlight_page ?? null,
  summary: {
    total_inflow: data.summary.total_inflow / 100,
    total_outflow: data.summary.total_outflow / 100,
    cleared_balance: data.summary.cleared_balance / 100,
    uncleared_balance: data.summary.uncleared_balance / 100,
  },
};
```

- [ ] **Step 6: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add transfer_peer_account_id and highlight_id/highlight_page to api.ts"
```

---

### Task 4: Frontend — `App.tsx` navigation handler + `Accounts` prop wiring

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Accounts.tsx` — Props interface and destructure only

**Context:** `App` holds `highlightTxnId` state and passes it plus `onNavigateToTransfer` to `Accounts`. The `Accounts` component receives two new props but the actual scroll/flash logic is in Task 6.

- [ ] **Step 1: Add state and handler to `App.tsx`**

In `frontend/src/App.tsx`, after the existing state declarations (near `const [accountId, setAccountId]`):

```ts
const [highlightTxnId, setHighlightTxnId] = useState<string | null>(null);
```

Add the handler after `navigate`:

```ts
const handleNavigateToTransfer = useCallback((peerId: string, peerAccountId: string) => {
  setHighlightTxnId(peerId);
  navigate('accounts', peerAccountId);
}, [navigate]);
```

- [ ] **Step 2: Pass new props to `<Accounts>`**

In `App.tsx`, update the `<Accounts>` JSX:

```tsx
{page === 'accounts' && (
  <Accounts
    accounts={accounts}
    accountId={accountId}
    categoryGroups={categoryGroups}
    fmt={fmtBound}
    density={tweaks.density}
    categoryIdByName={categoryIdByName}
    onAccountsChanged={reloadAccounts}
    onDeleted={(id) => {
      const remaining = [
        ...(accounts.budget ?? []),
        ...(accounts.tracking ?? []),
      ].filter(a => a.id !== id);
      navigate('accounts', remaining[0]?.id ?? '');
      reloadAccounts();
    }}
    highlightTxnId={highlightTxnId}
    onHighlightConsumed={() => setHighlightTxnId(null)}
    onNavigateToTransfer={handleNavigateToTransfer}
  />
)}
```

- [ ] **Step 3: Add new props to `Accounts` Props interface**

In `frontend/src/components/Accounts.tsx`, update `Props`:

```ts
interface Props {
  accounts: { budget: Account[]; tracking: Account[] };
  accountId: string;
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  density: string;
  categoryIdByName: Record<string, string>;
  onAccountsChanged: () => void;
  onDeleted: (deletedId: string) => void;
  highlightTxnId?: string | null;
  onHighlightConsumed: () => void;
  onNavigateToTransfer: (peerId: string, peerAccountId: string) => void;
}
```

Update the function signature to destructure the new props:

```ts
export function Accounts({ accounts, accountId, categoryGroups, fmt, density, categoryIdByName, onAccountsChanged, onDeleted, highlightTxnId, onHighlightConsumed, onNavigateToTransfer }: Props) {
```

- [ ] **Step 4: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors (new props are optional or will be used in later tasks — `onHighlightConsumed` and `onNavigateToTransfer` may show "declared but not used" linting warnings but `tsc --noEmit` only errors on type issues, not unused variables at this stage since they're parameters).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Accounts.tsx
git commit -m "feat: wire highlightTxnId and onNavigateToTransfer through App to Accounts"
```

---

### Task 5: Frontend — edit mode transfer display and read mode clickable badge

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

**Context:** `EditableRow` currently shows a category `<select>` in edit mode regardless of whether the transaction is a transfer. When `t.transfer_peer_id` is set, it should instead show the peer account name and a "→ View" button. In read mode, the `⇄ Transfer` span should become a clickable button.

`EditableRow` needs two new props: `onNavigateToTransfer` and `accountNameById`. The `accountNameById` map is built in `Accounts` from `allAccounts`.

- [ ] **Step 1: Add new props to `EditableRowProps` and `EditableRow`**

In `Accounts.tsx`, update `EditableRowProps`:

```ts
interface EditableRowProps {
  t: Transaction;
  categories: string[];
  catColor: (cat: string) => string;
  onSave: (t: Transaction) => void;
  onToggleSelect: (id: string) => void;
  selected: boolean;
  fmt: (n: number) => string;
  rowPad: string;
  onSplit: (t: Transaction) => void;
  onToggleCleared: (t: Transaction) => void;
  onDelete: (id: string) => void;
  onLink: (t: Transaction) => void;
  onNavigateToTransfer: (peerId: string, peerAccountId: string) => void;
  accountNameById: Record<string, string>;
}
```

Update `EditableRow` function signature:

```ts
function EditableRow({ t, categories, catColor, onSave, onToggleSelect, selected, fmt, rowPad, onSplit, onToggleCleared, onDelete, onLink, onNavigateToTransfer, accountNameById }: EditableRowProps) {
```

- [ ] **Step 2: Edit mode — replace category cell for transfer rows**

In the editing branch of `EditableRow`, the category `<td>` currently is:

```tsx
<td style={st.td}>
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
</td>
```

Replace with a conditional:

```tsx
<td style={st.td}>
  {t.transfer_peer_id
    ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '2px 6px' }}>
          ⇄ {accountNameById[t.transfer_peer_account_id ?? ''] ?? 'Transfer'}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onNavigateToTransfer(t.transfer_peer_id!, t.transfer_peer_account_id!); }}
          style={{ fontSize: 10, color: T.textFaint, background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
        >→ View</button>
      </div>
    )
    : (
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
    )
  }
</td>
```

- [ ] **Step 3: Read mode — make `⇄ Transfer` badge clickable**

In the read-mode branch of `EditableRow`, the category cell currently shows:

```tsx
{t.transfer_peer_id
  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', borderRadius: 4, padding: '2px 6px' }}>⇄ Transfer</span>
  : <>
      ...
    </>
}
```

Replace the `<span>` with a clickable `<button>`:

```tsx
{t.transfer_peer_id
  ? (
    <button
      onClick={e => { e.stopPropagation(); onNavigateToTransfer(t.transfer_peer_id!, t.transfer_peer_account_id!); }}
      style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', background: 'rgba(108,142,191,0.12)', border: 'none', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
      title={`Go to ${accountNameById[t.transfer_peer_account_id ?? ''] ?? 'linked account'}`}
    >
      ⇄ {accountNameById[t.transfer_peer_account_id ?? ''] ?? 'Transfer'}
    </button>
  )
  : <>
      ...
    </>
}
```

- [ ] **Step 4: Build `accountNameById` in `Accounts` and pass to rows**

In the `Accounts` component body, add after `allAccounts`:

```ts
const accountNameById = useMemo(
  () => Object.fromEntries(allAccounts.map(a => [a.id, a.name])),
  [allAccounts]
);
```

Update the `EditableRow` usage in the JSX (the `txns.map` call) to pass the two new props:

```tsx
{txns.map(t => (
  <EditableRow
    key={t.id}
    t={t}
    categories={categories}
    catColor={catColor}
    onSave={handleSave}
    onToggleSelect={toggleSelect}
    selected={selected.has(t.id)}
    fmt={fmt}
    rowPad={rowPad}
    onSplit={tx => setModal({ split: tx })}
    onToggleCleared={toggleCleared}
    onDelete={handleSingleDelete}
    onLink={openLinkModal}
    onNavigateToTransfer={onNavigateToTransfer}
    accountNameById={accountNameById}
  />
))}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: show transfer peer account in edit mode and clickable badge in read mode"
```

---

### Task 6: Frontend — highlight, scroll, and flash

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/Accounts.tsx`

**Context:** When `highlightTxnId` is set (passed from App), `Accounts` must:
1. Fetch with `highlight_id=highlightTxnId` so the backend returns the right page.
2. After the page loads, scroll to the target row and flash it.
3. Call `onHighlightConsumed()` to clear `highlightTxnId` in App so back-navigation doesn't re-flash.

The transactions are fetched in a `useCallback`-wrapped `reload` function driven by `useEffect` dependencies. The highlight fetch is a one-shot on mount (when `highlightTxnId` is set).

- [ ] **Step 1: Add flash keyframe to `index.css`**

Append to `frontend/src/index.css`:

```css
@keyframes txnFlash {
  0%   { background: rgba(255, 220, 50, 0.28); }
  100% { background: transparent; }
}
.txn-flash {
  animation: txnFlash 1.6s ease-out forwards;
}
```

- [ ] **Step 2: Add `data-txn-id` attribute to each row in `Accounts.tsx`**

In the `Accounts` JSX, in the `txns.map` call, add `data-txn-id={t.id}` to `EditableRow` — but since `EditableRow` renders `<tr>` elements internally, pass it as a prop or add it via a wrapper. The simplest approach: add `data-txn-id` directly to the `<tr>` elements inside `EditableRow`.

Add `highlightId?: string` to `EditableRowProps`:

```ts
highlightId?: string;
```

In `EditableRow`, pass `data-txn-id` and optionally `className` to both `<tr>` elements:

For the editing branch `<tr>`:
```tsx
<tr data-txn-id={t.id} style={{ background: T.accentDim }}>
```

For the read-mode `<tr>`:
```tsx
<tr
  data-txn-id={t.id}
  className={highlightId === t.id ? 'txn-flash' : undefined}
  onClick={() => setEditing(true)}
  style={{ cursor: 'pointer', background: selected ? T.accentDim : 'transparent', transition: 'background 0.1s' }}
  ...
>
```

Pass `highlightId` in the `txns.map` call in `Accounts`:

```tsx
<EditableRow
  ...
  highlightId={highlightTxnId ?? undefined}
/>
```

- [ ] **Step 3: Add highlight fetch logic to `Accounts`**

`Accounts` currently fetches via a `reload` function triggered by `useEffect` watching filter/sort/page params. The highlight needs to modify the initial fetch when the component mounts with `highlightTxnId` set.

Locate the fetch params construction in `Accounts` (the `useCallback` or `useEffect` that calls `fetchTransactionsPage`). It uses a `params` object derived from `filter`, `sort`, `pageNum`, and `perPage`. Add:

```ts
const highlightRef = useRef<string | null>(highlightTxnId ?? null);
```

In the fetch `useEffect`, when building params, include `highlight_id` on the first load:

```ts
const fetchParams: TxnFilterParams = {
  ...existingParams,
  ...(highlightRef.current ? { highlight_id: highlightRef.current } : {}),
};
```

After the fetch returns, if `highlight_page` is set and differs from `pageNum`, update `pageNum`:

```ts
if (result.highlight_page && result.highlight_page !== pageNum) {
  setPageNum(result.highlight_page);
}
```

Clear `highlightRef` after the first fetch (so subsequent page changes don't re-send `highlight_id`):

```ts
highlightRef.current = null;
```

- [ ] **Step 4: Scroll to highlighted row after render**

Add a `useEffect` that fires whenever transactions load and a highlight is active:

```ts
useEffect(() => {
  if (!highlightTxnId) return;
  const row = document.querySelector(`[data-txn-id="${highlightTxnId}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  onHighlightConsumed();
}, [page?.transactions, highlightTxnId, onHighlightConsumed]);
```

The `txn-flash` CSS class is applied via the `highlightId` prop already passed to `EditableRow` (Step 2). Since `onHighlightConsumed` clears `highlightTxnId` in App after scrolling, the flash class is applied only on the first render where the target is visible, then removed when the prop becomes null on the next render.

- [ ] **Step 5: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run Go tests**

```bash
cd /home/Berny/budgetapp-ai && make test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/components/Accounts.tsx
git commit -m "feat: scroll to and flash-highlight peer transaction on transfer navigation"
```

---

### Task 7: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start dev servers**

Terminal 1:
```bash
cd /home/Berny/budgetapp-ai && make server
```

Terminal 2:
```bash
cd /home/Berny/budgetapp-ai && make frontend
```

Open `http://localhost:5173`.

- [ ] **Step 2: Verify read-mode badge shows account name and is clickable**

Navigate to an account that has at least one linked transfer (a row showing `⇄ Transfer`). Confirm:
- The badge now reads `⇄ [Account Name]` (not just `⇄ Transfer`).
- Clicking it navigates to the other account.
- The peer transaction is visible and briefly flashes yellow.

- [ ] **Step 3: Verify edit-mode transfer display**

Click a linked transfer row to enter edit mode. Confirm:
- The category cell shows `⇄ [Account Name]` badge + `→ View` button instead of the category dropdown.
- Clicking `→ View` navigates to the peer account and highlights the peer transaction.

- [ ] **Step 4: Verify highlight lands on correct page**

If you have more transactions than fit on one page (>50), confirm that navigating via the transfer badge scrolls to the correct page and highlights the right row, not page 1.

- [ ] **Step 5: Verify unlinked rows are unaffected**

Non-transfer rows still show the category dropdown in edit mode and the category badge in read mode. The `Link` button still appears for non-transfer rows.
