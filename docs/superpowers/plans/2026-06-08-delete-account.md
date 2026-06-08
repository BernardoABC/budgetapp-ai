# Delete Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hard-delete button in the account header that prompts for confirmation before permanently deleting the account and all its transactions.

**Architecture:** Add a `deleteConfirm` boolean state and `onDeleted` prop to `Accounts.tsx`; render a Delete button in the header and a confirmation modal. In `App.tsx`, pass `onDeleted` to navigate away to the first remaining account after deletion.

**Tech Stack:** React (inline styles), TypeScript, existing `deleteAccount` from `api.ts`

---

### Task 1: Add `onDeleted` prop to `Accounts` and wire it in `App.tsx`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx` — extend `Props` interface
- Modify: `frontend/src/App.tsx` — pass `onDeleted` prop

- [ ] **Step 1: Add `onDeleted` to the `Props` interface in `Accounts.tsx`**

In `frontend/src/components/Accounts.tsx`, find the `Props` interface (line ~100) and add the new prop:

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
}
```

Also destructure it in the function signature (line ~111):

```ts
export function Accounts({ accounts, accountId, categoryGroups, fmt, density, categoryIdByName, onAccountsChanged, onDeleted }: Props) {
```

- [ ] **Step 2: Pass `onDeleted` in `App.tsx`**

In `frontend/src/App.tsx`, find the `<Accounts ...>` JSX (line ~147) and add the prop:

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
  />
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Accounts.tsx frontend/src/App.tsx
git commit -m "feat: add onDeleted prop to Accounts"
```

---

### Task 2: Add Delete button and confirmation modal to `Accounts.tsx`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add `deleteConfirm` and `deleting` state**

In `Accounts.tsx`, near the other state declarations (around line ~154 where `renamingName` is declared), add:

```ts
const [deleteConfirm, setDeleteConfirm] = useState(false);
const [deleting, setDeleting] = useState(false);
```

- [ ] **Step 2: Add the `handleDeleteAccount` function**

After the existing handler functions (e.g. after `reconcile`, around line ~260), add:

```ts
const handleDeleteAccount = async () => {
  if (!account) return;
  setDeleting(true);
  try {
    await deleteAccount(account.id);
    setDeleteConfirm(false);
    onDeleted(account.id);
  } catch (err: unknown) {
    toast.error('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
  } finally {
    setDeleting(false);
  }
};
```

- [ ] **Step 3: Import `deleteAccount` from api**

At the top of `Accounts.tsx`, the import from `'../api'` currently reads:

```ts
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkTransferBatch, updateAccount, type TxnPage, type TxnFilterParams } from '../api';
```

Add `deleteAccount` to that import list:

```ts
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkTransferBatch, updateAccount, deleteAccount, type TxnPage, type TxnFilterParams } from '../api';
```

- [ ] **Step 4: Add the Delete button to the header**

In the header button group (line ~420–422), which currently reads:

```tsx
<div style={{ display: 'flex', gap: 8 }}>
  <button onClick={() => setModal('rules')} style={st.headerBtn}>Rules</button>
  <button onClick={() => setModal('reconcile')} style={st.headerBtnAccent}>Reconcile</button>
</div>
```

Change to:

```tsx
<div style={{ display: 'flex', gap: 8 }}>
  <button onClick={() => setDeleteConfirm(true)} style={st.headerBtnNeg}>Delete</button>
  <button onClick={() => setModal('rules')} style={st.headerBtn}>Rules</button>
  <button onClick={() => setModal('reconcile')} style={st.headerBtnAccent}>Reconcile</button>
</div>
```

- [ ] **Step 5: Add `headerBtnNeg` to the `st` styles object**

In the `st` styles object at the bottom of `Accounts.tsx` (around line ~758 where `headerBtn` and `headerBtnAccent` are defined), add:

```ts
headerBtnNeg:    { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, background: T.negDim, border: `1px solid ${T.neg}`, borderRadius: 8, color: T.neg, cursor: 'pointer' },
```

- [ ] **Step 6: Add the confirmation modal JSX**

After the existing modals at the bottom of the JSX (around line ~519–521, after the `SplitModal` line), add:

```tsx
{deleteConfirm && (
  <div style={stModal.overlay} onClick={e => { if (e.target === e.currentTarget) setDeleteConfirm(false); }}>
    <div style={{ ...stModal.panel, width: 400 }}>
      <div style={stModal.header}>
        <span style={stModal.title}>Delete Account</span>
        <button onClick={() => setDeleteConfirm(false)} style={stModal.closeBtn}>✕</button>
      </div>
      <p style={{ fontSize: 13.5, color: T.textMid, margin: '0 0 8px' }}>
        Delete <strong style={{ color: T.text }}>{account.name}</strong>?
      </p>
      <p style={{ fontSize: 12.5, color: T.textFaint, margin: '0 0 22px' }}>
        This will permanently delete all transactions for this account and cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setDeleteConfirm(false)} style={stModal.cancelBtn} disabled={deleting}>Cancel</button>
        <button
          onClick={handleDeleteAccount}
          disabled={deleting}
          style={{ ...stModal.submitBtn, background: T.neg, color: '#fff', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Account'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add delete account button and confirmation modal"
```

---

### Task 3: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
cd /home/Berny/budgetapp-ai && make dev
```

Open the app in the browser (default: `http://localhost:5173`).

- [ ] **Step 2: Verify the Delete button appears**

Navigate to any account. Confirm a red "Delete" button appears to the left of "Rules" in the header.

- [ ] **Step 3: Verify the confirmation modal**

Click "Delete". Confirm the modal appears with the account name, the warning text, and the two buttons (Cancel / Delete Account).

- [ ] **Step 4: Verify Cancel dismisses without side effects**

Click "Cancel". Confirm the modal closes and the account is still present.

- [ ] **Step 5: Verify hard delete and navigation**

Create a throwaway account (via "Add Account"), then delete it. Confirm:
- The modal closes
- The app navigates to another account (or dashboard if none remain)
- The deleted account no longer appears in the sidebar
