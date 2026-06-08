# Account Currency Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small muted `USD` or `CRC` badge on each account row in the sidebar and next to the account name on the Accounts page.

**Architecture:** Two surgical edits — add a `currBadge` style entry to each component's `st` object, then render a `<span>` conditional on `acc.currency` being set. No new components, no prop changes.

**Tech Stack:** React + TypeScript inline styles, existing `T` theme tokens.

---

### Task 1: Add currency badge to sidebar account rows

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

The `AccountRow` component (lines 52–65) renders: dot · name · balance. Insert the badge between name and balance.

- [ ] **Step 1: Add `currBadge` to the `st` object**

In `frontend/src/components/Layout.tsx`, find the `st` object (around line 162) and add `currBadge` as a new entry after `accBal`:

```ts
accBal:      { fontSize: 11, fontFamily: T.mono, fontWeight: 500, flexShrink: 0 },
currBadge:   { fontSize: 9.5, fontWeight: 600, color: T.textFaint, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 },
```

- [ ] **Step 2: Render the badge in `AccountRow`**

In `AccountRow` (around line 61), add the badge between the name span and the balance span:

```tsx
<span style={{ ...st.accName, color: active ? T.text : T.textMid }}>{acc.name}</span>
{acc.currency && <span style={st.currBadge}>{acc.currency}</span>}
<span style={{ ...st.accBal, color: acc.balance < 0 ? T.neg : active ? T.text : T.textDim }}>{fmt(acc.balance)}</span>
```

- [ ] **Step 3: Verify visually**

Run the dev server (`make dev` or `cd frontend && npm run dev`) and check the sidebar. Each account row should show a small muted pill (`USD` or `CRC`) between the name and the balance.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: add currency badge to sidebar account rows"
```

---

### Task 2: Add currency badge to the Accounts page header

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

The account name `<h2>` lives at line 445 inside a plain `<div>`. Wrap the h2 and badge in a flex row so they sit inline.

- [ ] **Step 1: Add `currBadge` to the `st` object in Accounts.tsx**

In `frontend/src/components/Accounts.tsx`, find the `st` object (around line 791) and add `currBadge` after the `pageTitle` entry:

```ts
pageTitle:       { fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' },
currBadge:       { fontSize: 9.5, fontWeight: 600, color: T.textFaint, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 },
```

- [ ] **Step 2: Wrap the `<h2>` and badge in a flex container**

Replace the display-mode branch at line 444–446:

```tsx
// Before:
) : (
  <h2 style={{ ...st.pageTitle, cursor: 'text' }} onClick={() => setRenamingName(account.name)} title="Click to rename">{account.name}</h2>
)}

// After:
) : (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <h2 style={{ ...st.pageTitle, cursor: 'text' }} onClick={() => setRenamingName(account.name)} title="Click to rename">{account.name}</h2>
    {account.currency && <span style={st.currBadge}>{account.currency}</span>}
  </div>
)}
```

- [ ] **Step 3: Verify visually**

In the running app, click any account in the sidebar. The Accounts page header should show the account name with a small muted `USD` or `CRC` badge to its right.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: add currency badge to account page header"
```
