# Phase 1 Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Phase 1 items so the app is fully functional: create accounts, add/edit/delete transactions, and manage categories — all persisted to the API.

**Architecture:** Six gaps remain: (1) starting balance transaction on account create (backend), (2) a category-ID lookup map so write operations can send UUIDs, (3) an Add Account modal, (4) transaction write operations (save/delete/create) wired to the API, (5) a simple Add Transaction form, and (6) Budget.tsx category operations persisted. All frontend changes follow the existing inline-style pattern with no new dependencies.

**Tech Stack:** Go/pgx (backend), React 19 + TypeScript + fetch() (frontend), existing `T`/theme design tokens.

---

## Money / ID reminder

- **Amounts in the frontend are colones** (e.g., 42500 = ₡42,500). The API and DB convert internally.
- **Category names → UUIDs**: The frontend stores `categoryIdByName: Record<string, string>` (populated at category fetch time). Pass it to any component that needs to send `category_id` to the API.
- **Account/Group IDs** are already UUIDs in all state — they come from the API.

---

## File map

```
server/internal/repository/account_repo.go   modify — wrap Create in pgx tx, add starting-balance txn
frontend/src/api.ts                          modify — add fetchCategoryGroupsRaw + category CRUD helpers
frontend/src/App.tsx                         modify — categoryIdByName state, reload callbacks, modal state
frontend/src/components/AccountFormModal.tsx create — Add Account form modal
frontend/src/components/Layout.tsx           modify — wire Add Account button with onAddAccount prop
frontend/src/components/Accounts.tsx         modify — wire handleSave/delete/add to API
frontend/src/components/Budget.tsx           modify — wire addGroup/addCat/deleteCat/etc. to API
```

---

## Task 1: Backend — fix JSON tags on category models

**Files:**
- Modify: `server/internal/model/category.go`

The category mutation handlers (`CreateGroup`, `UpdateGroup`, `CreateCategory`, `UpdateCategory`) return model structs directly as JSON. Without tags, Go serializes them as `{"ID":"...","Name":"..."}` (uppercase), which the frontend can't read. Fix by adding JSON tags.

- [ ] **Step 1.1: Add JSON tags to model/category.go**

Replace the entire file at `server/internal/model/category.go`:

```go
package model

type Category struct {
	ID        string     `json:"id"`
	GroupID   string     `json:"group_id"`
	Name      string     `json:"name"`
	Hidden    bool       `json:"hidden"`
	SortOrder int        `json:"sort_order"`
}

type CategoryGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SortOrder  int        `json:"sort_order"`
	Hidden     bool       `json:"hidden"`
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

- [ ] **Step 1.2: Verify build**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: exits 0.

- [ ] **Step 1.3: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add server/internal/model/category.go
git commit -m "fix: add JSON tags to category model structs so mutation endpoints return lowercase keys"
```

---

## Task 2: Backend — starting balance transaction on account create

**Files:**
- Modify: `server/internal/repository/account_repo.go`

When a user creates an account with a non-zero starting balance, automatically insert a "Starting Balance" transaction so the balance is properly tracked.

- [ ] **Step 2.1: Rewrite `AccountRepo.Create` to use a DB transaction**

Replace the `Create` method (lines 53–70) in `server/internal/repository/account_repo.go` with:

```go
func (r *AccountRepo) Create(ctx context.Context, req model.CreateAccountReq) (model.Account, error) {
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	balanceCentimos := req.Balance * 100

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return model.Account{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var a model.Account
	err = tx.QueryRow(ctx, `
		INSERT INTO accounts (name, type, currency, balance, on_budget, note, sort_order)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), $7)
		RETURNING id::text, name, type, currency, balance, on_budget, closed,
		          COALESCE(note,''), sort_order
	`, req.Name, req.Type, currency, balanceCentimos, req.OnBudget, req.Note, req.SortOrder,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
		&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder)
	if err != nil {
		return a, fmt.Errorf("create account: %w", err)
	}

	if balanceCentimos != 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO transactions (account_id, date, amount, currency, payee, memo, cleared)
			VALUES ($1, CURRENT_DATE, $2, $3, 'Starting Balance', '', true)
		`, a.ID, balanceCentimos, currency); err != nil {
			return a, fmt.Errorf("insert starting balance: %w", err)
		}
	}

	return a, tx.Commit(ctx)
}
```

- [ ] **Step 2.2: Verify build**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: exits 0.

- [ ] **Step 2.3: Smoke test**

```bash
cd /home/Berny/budgetapp-ai && podman-compose up -d postgres && sleep 3
cd server && DATABASE_URL="postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" go run . &
sleep 2
ACCT=$(curl -s -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","type":"checking","currency":"CRC","balance":500000,"on_budget":true}')
ID=$(echo $ACCT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s "http://localhost:8080/api/accounts/$ID/transactions" | python3 -c "import sys,json; d=json.load(sys.stdin); print('txns:', d['total'], 'payee:', d['transactions'][0]['payee'] if d['transactions'] else 'none')"
kill %1; podman-compose down
```

Expected: `txns: 1 payee: Starting Balance`

- [ ] **Step 2.4: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add server/internal/repository/account_repo.go
git commit -m "feat: auto-create Starting Balance transaction on account create"
```

---

## Task 3: API client — add raw category fetch + category CRUD

**Files:**
- Modify: `frontend/src/api.ts`

Add these functions after the existing `fetchCategoryGroups` export:

```ts
export async function fetchCategoryGroupsRaw(): Promise<CategoryGroupAPI[]> {
  return apiFetch('/category-groups');
}

// ─── Category group CRUD ───────────────────────────────────────────────────────

export async function createCategoryGroup(body: { name: string; sort_order?: number }): Promise<CategoryGroupAPI> {
  return apiFetch('/category-groups', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateCategoryGroup(id: string, body: { name: string; sort_order?: number; hidden?: boolean }): Promise<CategoryGroupAPI> {
  return apiFetch(`/category-groups/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteCategoryGroup(id: string): Promise<void> {
  return apiFetch(`/category-groups/${id}`, { method: 'DELETE' });
}

// ─── Category CRUD ─────────────────────────────────────────────────────────────

export async function createCategory(body: { group_id: string; name: string; sort_order?: number }): Promise<CategoryItemAPI> {
  return apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateCategory(id: string, body: { name: string; hidden?: boolean; sort_order?: number }): Promise<CategoryItemAPI> {
  return apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteCategory(id: string): Promise<void> {
  return apiFetch(`/categories/${id}`, { method: 'DELETE' });
}
```

Also add `CategoryItemAPI` to the import at the top of api.ts:

```ts
import type {
  Account,
  Transaction,
  CategoryGroup,
  CategoryGroupAPI,
  CategoryItemAPI,
} from './data';
```

- [ ] **Step 2.1: Apply the changes above to `/home/Berny/budgetapp-ai/frontend/src/api.ts`**

- [ ] **Step 2.2: Verify TypeScript**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep "api.ts"
```

Expected: no output (zero errors).

- [ ] **Step 2.3: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/api.ts
git commit -m "feat: add raw category fetch and category/group CRUD to API client"
```

---

## Task 4: App.tsx — categoryIdByName + reload callbacks

**Files:**
- Modify: `frontend/src/App.tsx`

Three additions: (1) a `categoryIdByName` map derived from the raw API data, (2) reload callbacks so child components can trigger a refresh, (3) modal state for the Add Account flow.

- [ ] **Step 3.1: Update imports in App.tsx**

Add `fetchCategoryGroupsRaw` to the api import line:

```ts
import { fetchAccounts, fetchCategoryGroupsRaw } from './api';
```

Remove `fetchCategoryGroups` from that import (we no longer call it directly).

- [ ] **Step 3.2: Add state + update useEffect inside the `App` function**

After the existing `categoryGroups` useState line, add:

```ts
const [categoryIdByName, setCategoryIdByName] = useState<Record<string, string>>({});
const [showAddAccount, setShowAddAccount] = useState(false);
```

Replace the existing `useEffect` (the one that calls `fetchAccounts` + `fetchCategoryGroups`) with:

```ts
const reloadCategories = useCallback(() => {
  fetchCategoryGroupsRaw()
    .then(rawGroups => {
      const idMap: Record<string, string> = {};
      rawGroups.forEach(g => g.categories.forEach(c => { idMap[c.name] = c.id; }));
      setCategoryIdByName(idMap);
      setCategoryGroups(rawGroups.map(g => ({
        id: g.id,
        name: g.name,
        categories: g.categories.map(c => c.name),
      })));
    })
    .catch(err => console.warn('Failed to load categories:', err.message));
}, []);

const reloadAccounts = useCallback(() => {
  fetchAccounts()
    .then(setAccounts)
    .catch(err => console.warn('Failed to load accounts:', err.message));
}, []);

useEffect(() => {
  Promise.all([fetchAccounts(), fetchCategoryGroupsRaw()])
    .then(([accs, rawGroups]) => {
      setAccounts(accs);
      const idMap: Record<string, string> = {};
      rawGroups.forEach(g => g.categories.forEach(c => { idMap[c.name] = c.id; }));
      setCategoryIdByName(idMap);
      setCategoryGroups(rawGroups.map(g => ({
        id: g.id,
        name: g.name,
        categories: g.categories.map(c => c.name),
      })));
    })
    .catch(err => console.warn('API unavailable, using static data:', err.message));
}, []);
```

- [ ] **Step 3.3: Update JSX — pass new props + import modal**

Add the import at the top:
```ts
import { AccountFormModal } from './components/AccountFormModal';
```

Update the JSX to pass the new props and render the modal. Change these lines:

```tsx
// Change Layout to add onAddAccount:
<Layout ... onAddAccount={() => setShowAddAccount(true)}>

// Change Budget to pass categoryIdByName + onCategoriesChanged:
{page === 'budget' && <Budget categoryGroups={categoryGroups} budgetData={budget} fmt={fmtBound} density={tweaks.density} categoryIdByName={categoryIdByName} onCategoriesChanged={reloadCategories} />}

// Change Accounts to pass categoryIdByName + onAccountsChanged:
{page === 'accounts' && <Accounts accounts={accounts} accountId={accountId} categoryGroups={categoryGroups} fmt={fmtBound} density={tweaks.density} categoryIdByName={categoryIdByName} onAccountsChanged={reloadAccounts} />}
```

Add the modal just before the closing `</div>` of the root element:
```tsx
{showAddAccount && (
  <AccountFormModal
    onClose={() => setShowAddAccount(false)}
    onCreated={acc => {
      setAccounts(prev => ({
        ...prev,
        budget:   acc.on_budget ? [...prev.budget, acc]   : prev.budget,
        tracking: acc.on_budget ? prev.tracking : [...prev.tracking, acc],
      }));
      setShowAddAccount(false);
    }}
  />
)}
```

- [ ] **Step 3.4: Verify TypeScript (expect errors about AccountFormModal not existing yet — that's OK)**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep "App.tsx"
```

The only errors should be about `AccountFormModal` (not found yet) and the new props on Layout/Budget/Accounts (not added yet). All other App.tsx errors should be zero.

- [ ] **Step 3.5: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/App.tsx
git commit -m "feat: add categoryIdByName map and account/category reload callbacks in App"
```

---

## Task 5: AccountFormModal component

**Files:**
- Create: `frontend/src/components/AccountFormModal.tsx`

- [ ] **Step 4.1: Create the file**

Create `/home/Berny/budgetapp-ai/frontend/src/components/AccountFormModal.tsx`:

```tsx
import { useState } from 'react';
import { T } from '../theme';
import { createAccount } from '../api';
import type { Account } from '../data';

interface Props {
  onClose: () => void;
  onCreated: (account: Account) => void;
}

export function AccountFormModal({ onClose, onCreated }: Props) {
  const [name,      setName]      = useState('');
  const [type,      setType]      = useState('checking');
  const [currency,  setCurrency]  = useState('CRC');
  const [balance,   setBalance]   = useState('');
  const [onBudget,  setOnBudget]  = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const acc = await createAccount({
        name: name.trim(),
        type,
        currency,
        balance: parseFloat(balance) || 0,
        on_budget: onBudget,
      });
      onCreated(acc);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={st.panel}>
        <div style={st.header}>
          <span style={st.title}>New Account</span>
          <button onClick={onClose} style={st.closeBtn}>✕</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={st.field}>
            <label style={st.label}>Account Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. BAC Checking"
              style={st.input}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={st.field}>
              <label style={st.label}>Type</label>
              <select value={type} onChange={e => setType(e.target.value)} style={st.select}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Currency</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['CRC', 'USD'] as const).map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => setCurrency(c)}
                    style={{ ...st.pill, ...(currency === c ? st.pillOn : {}) }}
                  >
                    {c === 'CRC' ? '₡ CRC' : '$ USD'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={st.field}>
            <label style={st.label}>Starting Balance</label>
            <input
              type="number"
              value={balance}
              onChange={e => setBalance(e.target.value)}
              placeholder="0"
              style={st.input}
            />
            <span style={st.hint}>Leave 0 if you'll import transactions instead</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              id="onBudget"
              checked={onBudget}
              onChange={e => setOnBudget(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
            />
            <label htmlFor="onBudget" style={{ fontSize: 13, color: T.textMid, cursor: 'pointer' }}>
              Include in budget
            </label>
          </div>

          {error && <div style={st.errorMsg}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={st.cancelBtn}>Cancel</button>
            <button type="submit" disabled={saving} style={st.submitBtn}>
              {saving ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const st = {
  overlay:   { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)' },
  panel:     { background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, padding: 28, width: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.85)' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title:     { fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  closeBtn:  { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  field:     { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  label:     { fontSize: 11, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  input:     { padding: '9px 12px', fontSize: 13.5, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, outline: 'none' },
  select:    { padding: '9px 12px', fontSize: 13.5, border: `1px solid ${T.border}`, borderRadius: 8, background: T.surface, color: T.text, cursor: 'pointer' },
  pill:      { flex: 1, padding: '8px 10px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.textMid, cursor: 'pointer' },
  pillOn:    { background: T.accentDim, borderColor: 'var(--accent)', color: 'var(--accent)' },
  hint:      { fontSize: 11, color: T.textFaint, marginTop: 2 },
  errorMsg:  { fontSize: 12.5, color: T.neg, background: T.negDim, border: `1px solid ${T.neg}`, borderRadius: 7, padding: '8px 12px' },
  cancelBtn: { padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, color: T.textMid, cursor: 'pointer' },
  submitBtn: { padding: '9px 20px', fontSize: 13, fontWeight: 700, background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#06140d', cursor: 'pointer' },
};
```

- [ ] **Step 4.2: Verify TypeScript**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep "AccountFormModal"
```

Expected: no errors on AccountFormModal.tsx.

- [ ] **Step 4.3: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/AccountFormModal.tsx
git commit -m "feat: add AccountFormModal component"
```

---

## Task 6: Layout.tsx — wire Add Account button

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 5.1: Add `onAddAccount` to SidebarProps**

In `Layout.tsx`, update the `SidebarProps` interface:

```ts
interface SidebarProps {
  currentPage: string;
  currentAccountId: string;
  onNavigate: (page: string, accountId?: string) => void;
  accounts: { budget: Account[]; tracking: Account[] };
  exchangeRate: number;
  exchangeRateDate: string;
  fmt: (n: number) => string;
  onAddAccount?: () => void;
}
```

- [ ] **Step 5.2: Add `onAddAccount` to the `Sidebar` function signature**

Change:
```ts
function Sidebar({ currentPage, currentAccountId, onNavigate, accounts, exchangeRate, exchangeRateDate, fmt }: SidebarProps) {
```
To:
```ts
function Sidebar({ currentPage, currentAccountId, onNavigate, accounts, exchangeRate, exchangeRateDate, fmt, onAddAccount }: SidebarProps) {
```

- [ ] **Step 5.3: Wire the button**

Find the `+ Add Account` button (around line 87) and add an `onClick`:

```tsx
<button
  onClick={onAddAccount}
  onMouseEnter={() => setHovered('add')}
  onMouseLeave={() => setHovered(null)}
  style={{ ...st.addBtn, color: hovered === 'add' ? 'var(--accent)' : T.textDim, borderColor: hovered === 'add' ? T.borderHi : T.border }}>
  + Add Account
</button>
```

- [ ] **Step 5.4: Add `onAddAccount` to `LayoutProps` and pass it through**

In the `LayoutProps` interface, add:
```ts
onAddAccount?: () => void;
```

In the `Layout` function signature, add `onAddAccount` and pass it to `<Sidebar>`:
```tsx
export function Layout({ ..., onAddAccount, ... }: LayoutProps) {
  return (
    ...
    <Sidebar ... onAddAccount={onAddAccount} />
    ...
  );
}
```

- [ ] **Step 5.5: Verify TypeScript**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep "Layout.tsx"
```

Expected: zero errors.

- [ ] **Step 5.6: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/Layout.tsx
git commit -m "feat: wire Add Account button in sidebar"
```

---

## Task 7: Accounts.tsx — wire save / delete / add-transaction to API

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

Three changes: (1) `handleSave` calls `PUT /api/transactions/:id`, (2) the Delete button calls `DELETE`, (3) a new "New Transaction" modal.

- [ ] **Step 6.1: Update imports**

Add to the existing import block at the top:
```ts
import { updateTransaction, deleteTransaction, createTransaction } from '../api';
```

- [ ] **Step 7.2: Add `categoryIdByName` and `onAccountsChanged` to Props interface**

```ts
interface Props {
  accounts: { budget: Account[]; tracking: Account[] };
  accountId: string;
  categoryGroups: CategoryGroup[];
  fmt: (n: number) => string;
  density: string;
  categoryIdByName: Record<string, string>;
  onAccountsChanged: () => void;
}
```

And update the component signature:
```ts
export function Accounts({ accounts, accountId, categoryGroups, fmt, density, categoryIdByName, onAccountsChanged }: Props) {
```

- [ ] **Step 6.3: Add `showAddTxn` state + AddTransactionModal state**

After the existing `useState` declarations, add:
```ts
const [showAddTxn, setShowAddTxn] = useState(false);
const [addForm, setAddForm] = useState({
  date: new Date().toISOString().slice(0, 10),
  payee: '',
  category: '',
  outflow: '',
  inflow: '',
  memo: '',
  cleared: false,
});
const [addSaving, setAddSaving] = useState(false);
```

- [ ] **Step 6.4: Replace `handleSave` with an API-wired version**

Replace:
```ts
const handleSave = (updated: Transaction) => setTxns(ts => ts.map(t => t.id === updated.id ? updated : t));
```

With:
```ts
const handleSave = (updated: Transaction) => {
  // Optimistic update
  setTxns(ts => ts.map(t => t.id === updated.id ? updated : t));
  const amount = updated.inflow > 0 ? updated.inflow : -updated.outflow;
  const category_id = updated.category ? (categoryIdByName[updated.category] ?? undefined) : undefined;
  updateTransaction(updated.id, {
    date: updated.date,
    payee: updated.payee,
    category_id,
    amount,
    memo: updated.memo,
    cleared: updated.cleared,
  })
    .then(() => onAccountsChanged())
    .catch(err => {
      console.error('save transaction failed:', err);
      fetchAccountTransactions(accountId).then(setTxns);
    });
};
```

(Also add `fetchAccountTransactions` to the import from `../api`.)

- [ ] **Step 6.5: Wire the Delete button**

Find the Delete button in the JSX (the `{selected.size > 0 && ...}` block) and add `onClick`:

```tsx
{selected.size > 0 && (
  <button
    onClick={() => {
      const ids = [...selected];
      // Optimistic remove
      setTxns(ts => ts.filter(t => !selected.has(t.id)));
      setSelected(new Set());
      // Delete in background
      Promise.all(ids.map(id => deleteTransaction(id)))
        .then(() => onAccountsChanged())
        .catch(err => {
          console.error('delete failed:', err);
          fetchAccountTransactions(accountId).then(setTxns);
        });
    }}
    style={{ ...st.clearBtn, color: T.neg, borderColor: T.negDim, background: T.negDim, marginLeft: 'auto' }}
  >
    Delete {selected.size}
  </button>
)}
```

- [ ] **Step 6.6: Add "New Transaction" button above the filter bar**

Find the `<div style={st.filterBar}>` block. Just before it, add:

```tsx
<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
  <button onClick={() => setShowAddTxn(true)} style={st.headerBtnAccent}>+ New Transaction</button>
</div>
```

- [ ] **Step 6.7: Add the AddTransaction modal**

Add a `handleAddTxn` function inside the component body:
```ts
const handleAddTxn = async (e: React.FormEvent) => {
  e.preventDefault();
  setAddSaving(true);
  const amount = parseFloat(addForm.inflow) > 0
    ? parseFloat(addForm.inflow)
    : -(parseFloat(addForm.outflow) || 0);
  const category_id = addForm.category ? (categoryIdByName[addForm.category] ?? undefined) : undefined;
  try {
    const newTxn = await createTransaction(accountId, {
      date: addForm.date,
      payee: addForm.payee,
      category_id,
      amount,
      memo: addForm.memo,
      cleared: addForm.cleared,
    });
    setTxns(ts => [newTxn, ...ts]);
    setShowAddTxn(false);
    setAddForm({ date: new Date().toISOString().slice(0, 10), payee: '', category: '', outflow: '', inflow: '', memo: '', cleared: false });
    onAccountsChanged();
  } catch (err) {
    console.error('create transaction failed:', err);
  } finally {
    setAddSaving(false);
  }
};
```

Add the modal JSX at the bottom of the return, alongside the other modals:
```tsx
{showAddTxn && (
  <div style={stModal.overlay} onClick={e => e.target === e.currentTarget && setShowAddTxn(false)}>
    <div style={stModal.panel}>
      <div style={stModal.header}>
        <span style={stModal.title}>New Transaction</span>
        <button onClick={() => setShowAddTxn(false)} style={stModal.closeBtn}>✕</button>
      </div>
      <form onSubmit={handleAddTxn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={stModal.field}>
            <label style={stModal.label}>Date</label>
            <input type="date" value={addForm.date}
              onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))}
              style={stModal.input} />
          </div>
          <div style={stModal.field}>
            <label style={stModal.label}>Category</label>
            <select value={addForm.category}
              onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
              style={stModal.select}>
              <option value="">— Uncategorized —</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div style={stModal.field}>
          <label style={stModal.label}>Payee</label>
          <input autoFocus value={addForm.payee}
            onChange={e => setAddForm(f => ({ ...f, payee: e.target.value }))}
            placeholder="Payee name" style={stModal.input} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={stModal.field}>
            <label style={stModal.label}>Outflow</label>
            <input type="number" value={addForm.outflow}
              onChange={e => setAddForm(f => ({ ...f, outflow: e.target.value, inflow: '' }))}
              placeholder="0" style={stModal.input} />
          </div>
          <div style={stModal.field}>
            <label style={stModal.label}>Inflow</label>
            <input type="number" value={addForm.inflow}
              onChange={e => setAddForm(f => ({ ...f, inflow: e.target.value, outflow: '' }))}
              placeholder="0" style={stModal.input} />
          </div>
        </div>
        <div style={stModal.field}>
          <label style={stModal.label}>Memo</label>
          <input value={addForm.memo}
            onChange={e => setAddForm(f => ({ ...f, memo: e.target.value }))}
            placeholder="Optional note" style={stModal.input} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="addCleared" checked={addForm.cleared}
            onChange={e => setAddForm(f => ({ ...f, cleared: e.target.checked }))}
            style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
          <label htmlFor="addCleared" style={{ fontSize: 13, color: T.textMid, cursor: 'pointer' }}>Cleared</label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" onClick={() => setShowAddTxn(false)} style={stModal.cancelBtn}>Cancel</button>
          <button type="submit" disabled={addSaving} style={stModal.submitBtn}>
            {addSaving ? 'Saving…' : 'Add Transaction'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
```

Add the `stModal` style object at the end of the file alongside the existing `st` object:
```ts
const stModal = {
  overlay:   { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, backdropFilter: 'blur(4px)' },
  panel:     { background: T.surface2, border: `1px solid ${T.borderHi}`, borderRadius: T.radius, padding: 28, width: 460, boxShadow: '0 24px 60px rgba(0,0,0,0.85)' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title:     { fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.02em' },
  closeBtn:  { background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: 4 },
  field:     { display: 'flex', flexDirection: 'column' as const, gap: 5 },
  label:     { fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  input:     { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, outline: 'none' },
  select:    { padding: '8px 11px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 7, background: T.surface, color: T.text, cursor: 'pointer' },
  cancelBtn: { padding: '8px 15px', fontSize: 12.5, fontWeight: 600, background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, color: T.textMid, cursor: 'pointer' },
  submitBtn: { padding: '8px 20px', fontSize: 12.5, fontWeight: 700, background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#06140d', cursor: 'pointer' },
};
```

- [ ] **Step 6.8: Verify TypeScript**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | grep "Accounts.tsx"
```

Expected: zero errors.

- [ ] **Step 6.9: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/Accounts.tsx
git commit -m "feat: wire transaction save/delete/create to API in Accounts view"
```

---

## Task 8: Budget.tsx — wire category operations to API

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 8.1: Add new imports to Budget.tsx**

Add at the top:
```ts
import { createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory } from '../api';
```

- [ ] **Step 8.2: Add new props to the Budget component's Props interface**

Find the interface near line 193:
```ts
interface BudgetProps { // or just the inline destructure
  categoryGroups: CategoryGroup[];
  budgetData: Record<string, Record<string, BudgetEntry>>;
  fmt: (n: number) => string;
  density: string;
}
```

Add the two new props (find and update the actual interface name in the file):
```ts
  categoryIdByName: Record<string, string>;
  onCategoriesChanged: () => void;
```

And add them to the component function signature destructure.

- [ ] **Step 7.3: Wire `addGroup` to the API**

Find `const addGroup = () => setGroups(...)` and replace with:

```ts
const addGroup = () => {
  createCategoryGroup({ name: 'New Group', sort_order: groups.length })
    .then(g => {
      setGroups(gs => [...gs, { id: g.id, name: g.name, categories: [] }]);
      onCategoriesChanged();
    })
    .catch(err => console.error('create group failed:', err));
};
```

- [ ] **Step 7.4: Wire `deleteGroup` to the API**

Find `const deleteGroup = (gid: string) => setGroups(...)` and replace with:

```ts
const deleteGroup = (gid: string) => {
  setGroups(gs => gs.filter(g => g.id !== gid)); // optimistic
  deleteCategoryGroup(gid)
    .then(() => onCategoriesChanged())
    .catch(err => {
      console.error('delete group failed:', err);
      onCategoriesChanged(); // reload to restore
    });
};
```

- [ ] **Step 7.5: Wire `addCat` to the API**

Find `const addCat = (gid: string, name: string) => setGroups(...)` and replace with:

```ts
const addCat = (gid: string, name: string) => {
  setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: [...g.categories, name] } : g)); // optimistic
  createCategory({ group_id: gid, name, sort_order: 0 })
    .then(() => onCategoriesChanged())
    .catch(err => {
      console.error('create category failed:', err);
      setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g));
    });
};
```

- [ ] **Step 7.6: Wire `deleteCat` to the API**

Find `const deleteCat = (gid: string, name: string) => setGroups(...)` and replace with:

```ts
const deleteCat = (gid: string, name: string) => {
  const catId = categoryIdByName[name];
  setGroups(gs => gs.map(g => g.id === gid ? { ...g, categories: g.categories.filter(c => c !== name) } : g)); // optimistic
  if (catId) {
    deleteCategory(catId)
      .then(() => onCategoriesChanged())
      .catch(err => {
        console.error('delete category failed:', err);
        onCategoriesChanged(); // reload to restore
      });
  }
};
```

- [ ] **Step 8.7: Wire `renameCat` to the API**

Find `const renameCat = (gid: string, oldName: string, newName: string) => {` and replace the entire function with:

```ts
const renameCat = (gid: string, oldName: string, newName: string) => {
  setGroups(gs => gs.map(g =>
    g.id === gid
      ? { ...g, categories: g.categories.map(c => c === oldName ? newName : c) }
      : g
  ));
  const catId = categoryIdByName[oldName];
  if (catId) {
    updateCategory(catId, { name: newName, hidden: false, sort_order: 0 })
      .then(() => onCategoriesChanged())
      .catch(err => console.error('rename category failed:', err));
  }
};
```

- [ ] **Step 8.8: Verify TypeScript**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 8.9: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/Budget.tsx
git commit -m "feat: wire category add/delete/rename operations to API in Budget view"
```

---

## Task 9: Final build verification

- [ ] **Step 8.1: Full frontend build**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -8
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 8.2: Backend build**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```

Expected: exits 0.

- [ ] **Step 8.3: Manual smoke test**

```bash
cd /home/Berny/budgetapp-ai && podman-compose up -d postgres && sleep 3
cd server && DATABASE_URL="postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" go run . &
sleep 2
# Create account
ACCT=$(curl -s -X POST http://localhost:8080/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","type":"checking","currency":"CRC","balance":500000,"on_budget":true}')
ID=$(echo $ACCT | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
# Verify starting balance transaction exists
echo "Starting txn count:"
curl -s "http://localhost:8080/api/accounts/$ID/transactions" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'])"
# Add a transaction
curl -s -X POST "http://localhost:8080/api/accounts/$ID/transactions" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-02","payee":"AutoMercado","amount":-42500,"cleared":true}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('outflow:', d['outflow'])"
# Check categories seeded
curl -s http://localhost:8080/api/category-groups | python3 -c "import sys,json; data=json.load(sys.stdin); print('groups:', len(data))"
kill %1; podman-compose down
```

Expected:
```
Starting txn count: 1
outflow: 42500
groups: 7
```

- [ ] **Step 8.4: Push to GitHub**

```bash
cd /home/Berny/budgetapp-ai && git push origin main
```

- [ ] **Step 8.5: Commit if anything was fixed during verification**

If any final fixes were needed, commit them:
```bash
git add -A && git commit -m "fix: phase 1 completion fixes"
git push origin main
```

---

## Spec Coverage Check

| Requirement | Task |
|---|---|
| Starting balance transaction on account create | Task 1 |
| Add Account modal with Name/Type/Currency/Balance/OnBudget | Task 4 |
| Sidebar Add Account button wired | Task 5 |
| categoryIdByName map for category-ID lookups | Task 3 |
| Transaction inline edit saves to PUT /api/transactions/:id | Task 6 |
| Multi-select delete calls DELETE /api/transactions/:id | Task 6 |
| New Transaction form with all fields | Task 6 |
| Category add/delete/rename persisted via API | Task 7 |
| Category group add/delete persisted via API | Task 7 |
| Full frontend build passes | Task 8 |
| Backend build passes | Task 8 |
