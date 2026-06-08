# Transfer Link in Category Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sentinel "↔ Transfer to account…" option at the top of the inline-edit category dropdown in `EditableRow` so users can initiate transfer linking without leaving the row editor.

**Architecture:** Single change inside `EditableRow`'s editing branch in `Accounts.tsx`. When the sentinel value `__transfer__` is selected, `draft.category` is reset to `''` and `onLink(t)` is called to open the existing 2-step link modal. If the modal is dismissed without completing, the row stays in edit mode with an uncategorized draft. No new props, no new state, no backend changes.

**Tech Stack:** React, TypeScript, inline styles (`T` theme tokens, `st` style object)

---

### Task 1: Add sentinel option and handler to the category dropdown in `EditableRow`

**Files:**
- Modify: `frontend/src/components/Accounts.tsx` — lines 42–46 (category `<select>` in editing branch)

**Context:** `EditableRow` is a local function component at the top of `Accounts.tsx`. It has two render paths: an editing branch (returned when `editing === true`, starting at line 36) and a read-mode branch. We're only touching the editing branch. `onLink` is already a prop (`onLink: (t: Transaction) => void`) — it is the same function called by the "Link" button in read mode.

- [ ] **Step 1: Replace the category `<select>` in the editing branch**

Find this block in `frontend/src/components/Accounts.tsx` (lines 42–46):

```tsx
        <td style={st.td}>
          <select value={draft.category ?? ''} onChange={e => setDraft(d => ({ ...d, category: e.target.value || null }))} style={st.inlineSelect}>
            <option value="">—</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
```

Replace it with:

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

Key points:
- The sentinel value `__transfer__` is never stored in `draft.category` — the handler immediately resets category to `null` and opens the link modal.
- If the modal is dismissed without completing a link, `draft.category` remains `null` (uncategorized). The user can pick a real category or Save as-is.
- The sentinel option sits between the blank "—" and the real categories, visually dimmed.

- [ ] **Step 2: Verify TypeScript compiles without errors**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add transfer link option to inline category picker"
```

---

### Task 2: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the dev servers**

In one terminal:
```bash
cd /home/Berny/budgetapp-ai && make server
```

In another:
```bash
cd /home/Berny/budgetapp-ai && make frontend
```

Open `http://localhost:5173`.

- [ ] **Step 2: Verify sentinel option appears**

Navigate to any account with at least two transactions that could be transfers (opposite amounts, different accounts). Click any non-transfer row to enter edit mode. Open the category dropdown. Confirm `↔ Transfer to account…` appears as the second item (below "—").

- [ ] **Step 3: Verify happy path — link completes**

Click `↔ Transfer to account…`. Confirm:
1. The 2-step link modal opens (step 1: pick target account).
2. Pick an account with a matching candidate.
3. Pick a candidate transaction.
4. The modal closes, the row exits editing mode, and now shows `⇄ Transfer`.
5. The linked transaction on the other account also shows `⇄ Transfer`.

- [ ] **Step 4: Verify abandon path — modal dismissed**

Click a non-transfer row to edit it. It should have a category set (e.g. "Groceries"). Open the category dropdown and choose `↔ Transfer to account…`. The link modal opens. Close the modal (✕ or click outside). Confirm:
1. The modal closes.
2. The row stays in edit mode.
3. The category dropdown shows "—" (uncategorized), not `↔ Transfer to account…` and not the original "Groceries".
4. Click Save. The transaction is saved as uncategorized.

- [ ] **Step 5: Verify existing "Link" button still works**

On a non-transfer row in read mode, confirm the "Link" button still appears and opens the same modal as before.
