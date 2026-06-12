# Number-Dominant Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make financial numbers visually larger than their labels throughout the app, following the Monarch Money pattern where data is the primary visual anchor.

**Architecture:** Pure font-size edits — no structural, layout, color, or weight changes except `groupNum` which gets weight 700 (up from 600). Changes live in two style objects (`st = {...}` at the bottom of each component file) plus a handful of inline JSX overrides in the same files.

**Tech Stack:** React + TypeScript inline styles, Vite dev server (`npm run dev` in `frontend/`)

---

### Task 1: Update Budget.tsx typography

**Files:**
- Modify: `frontend/src/components/Budget.tsx:1030-1085` (style object) + lines 186, 362, 942, 953 (inline JSX)

No automated test exists for font sizes — verification is visual. Steps: edit, run dev server, confirm numbers are larger than labels, commit.

- [ ] **Step 1: Update the `st` style object in Budget.tsx**

In the `st = { ... }` block starting at line ~1030, apply these exact changes:

```typescript
// line ~1038 — headerStatLabel
headerStatLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },

// line ~1039 — headerStatValue
headerStatValue: { fontSize: 21, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1.1, color: T.text },

// line ~1049 — th
th: { padding: '12px 16px', fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.09em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.015)' },

// line ~1051 — groupCell
groupCell: { padding: '11px 16px', fontSize: 12, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' },

// line ~1052 — groupNum (weight also changes: 600 → 700)
groupNum: { padding: '11px 16px', fontSize: 16, fontWeight: 700, textAlign: 'right' as const, fontFamily: T.mono, color: T.text, borderBottom: `1px solid ${T.border}` },

// line ~1055 — catCell
catCell: { fontSize: 12, fontWeight: 500, borderBottom: `1px solid ${T.borderSoft}`, verticalAlign: 'middle' as const },

// line ~1056 — catName
catName: { background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: T.sans, textAlign: 'left' as const },

// line ~1057 — rolloverChip
rolloverChip: { fontSize: 10, fontWeight: 600, color: 'var(--accent)', fontFamily: T.mono, background: T.accentDim, padding: '1px 7px', borderRadius: 5 },

// line ~1061 — barPct
barPct: { fontSize: 10, fontFamily: T.mono, color: T.textDim, fontWeight: 500, flexShrink: 0, width: 36, textAlign: 'right' as const },

// line ~1062 — numCell
numCell: { fontSize: 15, textAlign: 'right' as const, fontFamily: T.mono, borderBottom: `1px solid ${T.borderSoft}`, color: T.textMid },

// line ~1066 — cellInput
cellInput: { width: 96, textAlign: 'right' as const, border: `1px solid var(--accent)`, borderRadius: 6, padding: '4px 8px', fontSize: 14, fontFamily: T.mono, background: T.surface2, color: T.text, boxShadow: '0 0 0 3px var(--accent-dim)' },

// line ~1078 — flexSectionTitle
flexSectionTitle: { fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: '-0.01em' },

// line ~1079 — flexSectionSums
flexSectionSums: { fontSize: 14, fontFamily: T.mono, color: T.textMid },

// line ~1082 — flexRowName
flexRowName: { fontSize: 12, fontWeight: 500, color: T.textMid },

// line ~1083 — flexAccrued
flexAccrued: { fontSize: 13, fontWeight: 600, color: 'var(--accent)', fontFamily: T.mono, minWidth: 70, textAlign: 'right' as const },
```

- [ ] **Step 2: Update inline fontSize overrides in Budget.tsx JSX**

Four inline `style={{ ... }}` fragments need updating. Search by the surrounding code to locate each one precisely:

**Line ~186** — `InlineRename` for group name (inside the group row render):
```tsx
// Before:
<InlineRename value={group.name} onCommit={v => onRenameGroup(group.id, v)} style={{ fontWeight: 700, fontSize: 13 }} />
// After:
<InlineRename value={group.name} onCommit={v => onRenameGroup(group.id, v)} style={{ fontWeight: 700, fontSize: 12 }} />
```

**Line ~362** — spent amount span in `FlexEditRow` component:
```tsx
// Before:
<span style={{ fontSize: 12.5, fontFamily: T.mono, color: spent > 0 ? T.neg : T.textDim, minWidth: 70, textAlign: 'right' as const }}>{fmt(spent)}</span>
// After:
<span style={{ fontSize: 15, fontFamily: T.mono, color: spent > 0 ? T.neg : T.textDim, minWidth: 70, textAlign: 'right' as const }}>{fmt(spent)}</span>
```

**Line ~942** — flexible section actual spend number:
```tsx
// Before:
<span style={{ fontSize: 12, fontFamily: T.mono, color: flexOver ? T.neg : T.textMid }}>{fmt(server?.flexible_actual ?? 0)} <span style={{ color: T.textFaint }}>spent</span></span>
// After:
<span style={{ fontSize: 14, fontFamily: T.mono, color: flexOver ? T.neg : T.textMid }}>{fmt(server?.flexible_actual ?? 0)} <span style={{ color: T.textFaint }}>spent</span></span>
```

**Line ~953** — flex row activity amount:
```tsx
// Before:
<span style={{ fontSize: 12.5, fontFamily: T.mono, color: c.activity < 0 ? T.neg : T.textDim }}>{fmtMonth(-c.activity)}</span>
// After:
<span style={{ fontSize: 15, fontFamily: T.mono, color: c.activity < 0 ? T.neg : T.textDim }}>{fmtMonth(-c.activity)}</span>
```

- [ ] **Step 3: Verify visually**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run dev
```

Open `http://localhost:5173` and navigate to the Budget view. Confirm:
- Row numbers (Planned / Activity / Remaining columns) are visibly larger than category names
- Group total numbers are larger than group name text
- Header bar stat values (Expected income, Planned, Left to budget, Savings) are the visually dominant element
- No text overflows its cell or wraps unexpectedly in the table

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "feat(ui): number-dominant typography in budget table"
```

---

### Task 2: Update Dashboard.tsx typography

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx:219-246` (style object) + line 205 (inline JSX)

- [ ] **Step 1: Update the `st` style object in Dashboard.tsx**

In the `st = { ... }` block starting at line ~219, apply these exact changes:

```typescript
// line ~224 — cardLabel
cardLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' as const },

// line ~225 — cardValue
cardValue: { fontSize: 30, fontWeight: 700, fontFamily: T.mono, letterSpacing: '-0.02em', lineHeight: 1 },

// line ~226 — cardSub
cardSub: { fontSize: 11, marginTop: 8, fontWeight: 500 },

// line ~229 — panelHeader
panelHeader: { padding: '14px 18px', fontSize: 12, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}`, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },

// line ~230 — panelMeta
panelMeta: { fontSize: 10, fontWeight: 500, color: T.textDim, fontFamily: T.mono },

// line ~235 — barLabel
barLabel: { fontSize: 12, color: T.textMid, fontWeight: 600 },

// line ~238 — barAmt
barAmt: { fontSize: 13, fontFamily: T.mono, fontWeight: 500 },

// line ~240 — monthLabel
monthLabel: { fontSize: 11, color: T.textMid, fontWeight: 500 },

// line ~241 — monthVal
monthVal: { fontSize: 14, fontFamily: T.mono, fontWeight: 600, color: T.text },

// line ~243 — th
th: { padding: '9px 18px', fontSize: 9, fontWeight: 700, color: T.textDim, textAlign: 'left' as const, letterSpacing: '0.08em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}` },

// line ~245 — td
td: { padding: '10px 18px', fontSize: 12, color: T.textMid, borderBottom: `1px solid ${T.borderSoft}` },

// line ~246 — catTag
catTag: { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '3px 9px', fontSize: 10.5, fontWeight: 600 },
```

- [ ] **Step 2: Update inline fontSize override in Dashboard.tsx JSX**

One inline override — the transaction amount cell (line ~205) overrides `st.td` and must be bumped to 14px so the amount is larger than the transaction name (which inherits `st.td` at 12px):

```tsx
// Before:
<td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 13, fontWeight: 500 }}>
// After:
<td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 14, fontWeight: 500 }}>
```

- [ ] **Step 3: Verify visually**

Dev server should still be running from Task 1. Navigate to the Dashboard view. Confirm:
- Summary card hero values (top 3 cards) are visibly larger than their label
- Transaction amounts (`−$89.40`, `+$2,100`) are larger than transaction names
- Spending bar amounts are larger than bar category labels
- Month values in the trend section are larger than month labels
- No layout breaks in the two-column panel grid

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Dashboard.tsx
git commit -m "feat(ui): number-dominant typography in dashboard"
```
