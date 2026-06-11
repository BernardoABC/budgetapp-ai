# Payee Category Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user assigns a category to a transaction, show two sequential modals: one to retroactively apply the category to all transactions with the same payee, and one (if the transaction previously had a different category) to create/update a payee rule for future imports.

**Architecture:** After `handleSave` in `Accounts.tsx` succeeds, we fetch all transactions with the same payee (paginating through all pages), then drive a two-step modal (`payeeSuggestionModal` state). `PayeeSuggestionModal` is added to `AccountsModals.tsx`. No backend changes.

**Tech Stack:** React, TypeScript — existing `batchTransactions`, `fetchTransactionsPage`, `fetchPayeeRules`, `createPayeeRule`, `updatePayeeRule` from `api.ts`.

---

### Task 1: Add `PayeeSuggestionModal` component to `AccountsModals.tsx`

**Files:**
- Modify: `frontend/src/components/AccountsModals.tsx`

This task adds the visual component. The parent wires up logic in Task 2.

- [ ] **Step 1: Add the `PayeeSuggestionModal` export at the end of `AccountsModals.tsx`, before the `am` style object**

  Add this block after the `SplitModal` function closing brace (line 156) and before `const am = {`:

  ```tsx
  // ── Payee Category Suggestion ──────────────────────────────

  export interface PayeeSuggestionState {
    step: 1 | 2;
    payee: string;
    transactions: Transaction[];
    categoryId: string;
    categoryName: string;
    hadPreviousCategory: boolean;
  }

  interface PayeeSuggestionProps {
    state: PayeeSuggestionState;
    onQ1Yes: () => void;
    onQ1No: () => void;
    onQ2Yes: () => void;
    onQ2No: () => void;
  }

  export function PayeeSuggestionModal({ state, onQ1Yes, onQ1No, onQ2Yes, onQ2No }: PayeeSuggestionProps) {
    return (
      <div style={am.overlay}>
        <div style={{ ...am.card, width: 440 }} onClick={e => e.stopPropagation()}>
          <div style={am.header}>
            <span style={am.title}>
              {state.step === 1 ? 'Apply to existing transactions?' : 'Create payee rule?'}
            </span>
          </div>
          <div style={am.body}>
            {state.step === 1 && (
              <>
                <p style={{ ...am.lead, fontSize: 13.5, color: 'var(--text, #e8e8e8)', marginBottom: 8 }}>
                  <strong>{state.transactions.length}</strong> other transaction{state.transactions.length !== 1 ? 's' : ''} {state.transactions.length !== 1 ? 'have' : 'has'} <strong>"{state.payee}"</strong> as payee.
                </p>
                <p style={am.help}>Apply <strong style={{ color: 'var(--accent)' }}>{state.categoryName}</strong> to all of them?</p>
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <button onClick={onQ1Yes} style={am.primaryBtn}>Yes, apply to all</button>
                  <button onClick={onQ1No} style={am.ghostBtn}>No, just this one</button>
                </div>
              </>
            )}
            {state.step === 2 && (
              <>
                <p style={{ ...am.lead, fontSize: 13.5, color: 'var(--text, #e8e8e8)', marginBottom: 8 }}>
                  Create a rule so future <strong>"{state.payee}"</strong> imports are automatically categorized?
                </p>
                <p style={am.help}>Category: <strong style={{ color: 'var(--accent)' }}>{state.categoryName}</strong></p>
                <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                  <button onClick={onQ2Yes} style={am.primaryBtn}>Yes, create rule</button>
                  <button onClick={onQ2No} style={am.ghostBtn}>No thanks</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit 2>&1 | head -30`

  Expected: no errors related to `AccountsModals.tsx`.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/AccountsModals.tsx
  git commit -m "feat: add PayeeSuggestionModal component"
  ```

---

### Task 2: Add state, helper, and modified `handleSave` to `Accounts.tsx`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Update the import line at the top of `Accounts.tsx`**

  The first import line (line 2) currently reads:
  ```typescript
  import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkOrCreateBatch, updateAccount, deleteAccount, type TxnPage, type TxnFilterParams, type LinkOrCreatePair } from '../api';
  ```

  Replace it with:
  ```typescript
  import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkOrCreateBatch, updateAccount, deleteAccount, fetchPayeeRules, createPayeeRule, updatePayeeRule, type TxnPage, type TxnFilterParams, type LinkOrCreatePair } from '../api';
  ```

- [ ] **Step 2: Update the `AccountsModals` import on line 5**

  Currently:
  ```typescript
  import { ReconcileModal, RulesManager, SplitModal } from './AccountsModals';
  ```

  Replace with:
  ```typescript
  import { ReconcileModal, RulesManager, SplitModal, PayeeSuggestionModal, type PayeeSuggestionState } from './AccountsModals';
  ```

- [ ] **Step 3: Add `payeeSuggestionModal` state**

  Find the `batchReview` state declaration (around line 362):
  ```typescript
  const [batchReview, setBatchReview] = useState<{
  ```

  Add the new state directly after the closing `} | null>(null);` of `batchReview`:
  ```typescript
  const [payeeSuggestionModal, setPayeeSuggestionModal] = useState<PayeeSuggestionState | null>(null);
  ```

- [ ] **Step 4: Add `fetchAllPayeeTxns` helper function**

  Add this async function directly before the `handleSave` function (before line 461):

  ```typescript
  const fetchAllPayeeTxns = async (payee: string, excludeId: string): Promise<Transaction[]> => {
    const all: Transaction[] = [];
    let p = 1;
    const perPage = 100;
    while (true) {
      const result = await fetchTransactionsPage(accountId, { search: payee, page: p, per_page: perPage });
      all.push(...result.transactions.filter(t => t.payee === payee && t.id !== excludeId));
      if (p >= result.pagination.total_pages) break;
      p++;
    }
    return all;
  };
  ```

- [ ] **Step 5: Replace `handleSave` with the new version**

  Replace the current `handleSave` (lines 461–470):
  ```typescript
  const handleSave = (updated: Transaction) => {
    const amount = updated.inflow > 0 ? updated.inflow : -updated.outflow;
    const category_id = updated.category ? (categoryIdByName[updated.category] ?? undefined) : undefined;
    updateTransaction(updated.id, {
      date: updated.date, payee: updated.payee, category_id, amount,
      memo: updated.memo, cleared: updated.cleared,
    })
      .then(() => { toast.success('Transaction updated'); onAccountsChanged(); reload(); })
      .catch(err => { console.error('save transaction failed:', err); toast.error('Save failed: ' + err.message); reload(); });
  };
  ```

  With:
  ```typescript
  const handleSave = (updated: Transaction) => {
    const previousCategory = page?.transactions.find(t => t.id === updated.id)?.category ?? null;
    const amount = updated.inflow > 0 ? updated.inflow : -updated.outflow;
    const category_id = updated.category ? (categoryIdByName[updated.category] ?? undefined) : undefined;
    updateTransaction(updated.id, {
      date: updated.date, payee: updated.payee, category_id, amount,
      memo: updated.memo, cleared: updated.cleared,
    })
      .then(async () => {
        toast.success('Transaction updated');
        onAccountsChanged();
        reload();
        if (!updated.payee || !updated.category || !category_id) return;
        const others = await fetchAllPayeeTxns(updated.payee, updated.id);
        if (others.length === 0) return;
        setPayeeSuggestionModal({
          step: 1,
          payee: updated.payee,
          transactions: others,
          categoryId: category_id,
          categoryName: updated.category,
          hadPreviousCategory: previousCategory !== null && previousCategory !== updated.category,
        });
      })
      .catch(err => { console.error('save transaction failed:', err); toast.error('Save failed: ' + err.message); reload(); });
  };
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  Run: `cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit 2>&1 | head -30`

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/components/Accounts.tsx
  git commit -m "feat: add payee suggestion state and modified handleSave"
  ```

---

### Task 3: Add Q1/Q2 handlers and render the modal in `Accounts.tsx`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

- [ ] **Step 1: Add `handlePayeeSuggestionQ1Yes` handler**

  Add these handlers directly after `handleSave` ends (after the closing `};` of the new `handleSave`):

  ```typescript
  const handlePayeeSuggestionQ1Yes = async () => {
    if (!payeeSuggestionModal) return;
    try {
      const ids = payeeSuggestionModal.transactions.map(t => t.id);
      await batchTransactions(ids, 'categorize', payeeSuggestionModal.categoryId);
      toast.success(`Applied to ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
      onAccountsChanged();
      reload();
    } catch (err) {
      toast.error('Batch update failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    if (payeeSuggestionModal.hadPreviousCategory) {
      setPayeeSuggestionModal(m => m ? { ...m, step: 2 } : null);
    } else {
      setPayeeSuggestionModal(null);
    }
  };

  const handlePayeeSuggestionQ1No = () => {
    if (!payeeSuggestionModal) return;
    if (payeeSuggestionModal.hadPreviousCategory) {
      setPayeeSuggestionModal(m => m ? { ...m, step: 2 } : null);
    } else {
      setPayeeSuggestionModal(null);
    }
  };

  const handlePayeeSuggestionQ2Yes = async () => {
    if (!payeeSuggestionModal) return;
    try {
      const existingRules = await fetchPayeeRules();
      const existing = existingRules.find(r => r.pattern === payeeSuggestionModal.payee);
      if (existing) {
        await updatePayeeRule(existing.id, payeeSuggestionModal.payee, payeeSuggestionModal.categoryId);
      } else {
        await createPayeeRule(payeeSuggestionModal.payee, payeeSuggestionModal.categoryId);
      }
      toast.success('Payee rule saved');
    } catch (err) {
      toast.error('Rule save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    setPayeeSuggestionModal(null);
  };

  const handlePayeeSuggestionQ2No = () => setPayeeSuggestionModal(null);
  ```

- [ ] **Step 2: Render the modal**

  Find where the other modals are rendered in the return JSX. Look for where `batchReview &&` is rendered (around line 956). Add the new modal render just after the closing of the `batchReview` block and before the final closing `</div>` of the component:

  ```tsx
  {payeeSuggestionModal && (
    <PayeeSuggestionModal
      state={payeeSuggestionModal}
      onQ1Yes={handlePayeeSuggestionQ1Yes}
      onQ1No={handlePayeeSuggestionQ1No}
      onQ2Yes={handlePayeeSuggestionQ2Yes}
      onQ2No={handlePayeeSuggestionQ2No}
    />
  )}
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  Run: `cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit 2>&1 | head -30`

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/Accounts.tsx
  git commit -m "feat: wire up payee category suggestion modal handlers and render"
  ```

---

### Task 4: Manual verification

**Files:** none (read-only verification)

- [ ] **Step 1: Start the dev server**

  Run: `cd /home/Berny/budgetapp-ai && make dev` (or whatever starts the server+frontend)

  Alternatively: start backend (`go run ./server/cmd/server`) and frontend (`cd frontend && npm run dev`) in separate terminals.

- [ ] **Step 2: Test Q1 — retroactive categorization**

  1. Open the Accounts page for any account that has multiple transactions from the same payee, where at least one has no category.
  2. Click a transaction from that payee to edit it, assign a category, and click Save.
  3. Expected: A modal appears saying "X other transactions have '[payee]' as payee. Apply '[category]' to all of them?"
  4. Click "Yes, apply to all". Expected: toast "Applied to X transaction(s)", other transactions updated.
  5. Verify those transactions now show the category.

- [ ] **Step 3: Test Q2 — payee rule creation**

  1. Find a transaction that **already has a category assigned**.
  2. Edit it and change the category to something different, then Save.
  3. After Q1 modal resolves (click Yes or No), Q2 modal should appear: "Create a rule so future '[payee]' imports are automatically categorized?"
  4. Click "Yes, create rule". Expected: toast "Payee rule saved".
  5. Open the Rules Manager (the rules icon/button). Verify the new rule appears for that payee.

- [ ] **Step 4: Test Q2 skipped when no previous category**

  1. Find a transaction with **no category** and a non-empty payee.
  2. Edit it, assign a category, Save.
  3. Q1 appears (if other transactions exist). After dismissing Q1, Q2 should NOT appear (no previous category).

- [ ] **Step 5: Test with no other transactions for same payee**

  1. Find a transaction whose payee is unique (no other transactions share it).
  2. Edit it, assign a category, Save.
  3. Neither modal should appear.
