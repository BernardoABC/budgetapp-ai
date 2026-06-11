# Budget Summary Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent right-side summary pane to the Budget page that shows leftover, assigned, activity, and available totals for either a checkbox-selected subset of categories/groups or the entire budget.

**Architecture:** All required data (`carryIn`, `assigned`, `activity`, `available`) already lives in `MonthState.cats` from the existing `compute()` engine — no API changes needed. Selection state is a `Set<string>` of category names held in `Budget`. A new `BudgetSummaryPane` component handles the display; checkbox props are threaded through `GroupBlock`.

**Tech Stack:** React 19, TypeScript 6, no test framework (verification via `tsc --noEmit` + browser)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/BudgetSummaryPane.tsx` | **Create** | Pure display pane: 4 stat cards + selection label + clear button |
| `frontend/src/components/Budget.tsx` | **Modify** | Selection state, handlers, summaryStats, selectionLabel, layout wiring, pass new props to GroupBlock |

---

### Task 1: Create `BudgetSummaryPane` component

**Files:**
- Create: `frontend/src/components/BudgetSummaryPane.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { T } from '../theme';

export interface SummaryStats {
  carryIn: number;
  assigned: number;
  activity: number;
  available: number;
  count: number;
}

interface Props {
  stats: SummaryStats;
  selectionLabel: string;
  hasSelection: boolean;
  onClear: () => void;
  fmt: (n: number) => string;
}

export function BudgetSummaryPane({ stats, selectionLabel, hasSelection, onClear, fmt }: Props) {
  return (
    <div style={sp.pane}>
      <div style={sp.labelRow}>
        <span style={sp.label}>SUMMARY</span>
      </div>
      <div style={sp.selLine}>{selectionLabel}</div>

      <StatCard label="Left over from last month" value={fmt(stats.carryIn)} color={stats.carryIn < 0 ? T.neg : T.pos} />
      <StatCard label="Assigned this month"       value={fmt(stats.assigned)} color={T.text} />
      <StatCard label="Activity this month"       value={fmt(stats.activity)} color={stats.activity < 0 ? T.neg : T.pos} />
      <StatCard label="Available"                 value={fmt(stats.available)} color={stats.available < 0 ? T.neg : T.pos} />

      {hasSelection && (
        <button onClick={onClear} style={sp.clearBtn}>✕ Clear selection</button>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={sp.card}>
      <div style={sp.cardLabel}>{label}</div>
      <div style={{ ...sp.cardValue, color }}>{value}</div>
    </div>
  );
}

const sp = {
  pane:      { width: 220, flexShrink: 0, padding: '16px 14px', display: 'flex', flexDirection: 'column' as const, gap: 10, borderLeft: `1px solid ${T.border}` },
  labelRow:  { marginBottom: 2 },
  label:     { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.08em', textTransform: 'uppercase' as const },
  selLine:   { fontSize: 11, color: T.textMid, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 },
  card:      { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' },
  cardLabel: { fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono, monospace)', letterSpacing: '-.02em' },
  clearBtn:  { background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, color: T.textDim, fontSize: 11, padding: '6px 10px', cursor: 'pointer', width: '100%', marginTop: 4 },
};
```

- [ ] **Step 2: Type-check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

---

### Task 2: Add selection state, handlers, and computed values to `Budget`

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Import `BudgetSummaryPane` and `SummaryStats`**

At the top of `Budget.tsx`, add to the existing imports:

```tsx
import { BudgetSummaryPane } from './BudgetSummaryPane';
import type { SummaryStats } from './BudgetSummaryPane';
```

- [ ] **Step 2: Add `selectedCats` state inside the `Budget` function**

After the existing `const [rtaBreakdown, ...]` line (around line 293), add:

```tsx
const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Add `toggleCatSelection` handler**

After the `handleSaveAssigned` callback (around line 400), add:

```tsx
const toggleCatSelection = useCallback((name: string) => {
  setSelectedCats(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
}, []);
```

- [ ] **Step 4: Add `toggleGroupSelection` handler**

Directly after `toggleCatSelection`:

```tsx
const toggleGroupSelection = useCallback((gid: string) => {
  const group = groups.find(g => g.id === gid);
  if (!group) return;
  setSelectedCats(prev => {
    const next = new Set(prev);
    const allSelected = group.categories.every(c => next.has(c));
    if (allSelected) group.categories.forEach(c => next.delete(c));
    else group.categories.forEach(c => next.add(c));
    return next;
  });
}, [groups]);
```

- [ ] **Step 5: Add `summaryStats` memo**

After `toggleGroupSelection`:

```tsx
const summaryStats = useMemo<SummaryStats>(() => {
  const cats = selectedCats.size === 0
    ? Object.values(state.cats)
    : ([...selectedCats].map(n => state.cats[n]).filter(Boolean) as CatState[]);
  return {
    carryIn:  cats.reduce((s, c) => s + c.carryIn,  0),
    assigned: cats.reduce((s, c) => s + c.assigned, 0),
    activity: cats.reduce((s, c) => s + c.activity, 0),
    available:cats.reduce((s, c) => s + c.available,0),
    count:    cats.length,
  };
}, [selectedCats, state.cats]);
```

- [ ] **Step 6: Add `selectionLabel` memo**

After `summaryStats`:

```tsx
const selectionLabel = useMemo(() => {
  const totalCount = Object.keys(state.cats).length;
  if (selectedCats.size === 0) return `All categories · ${totalCount}`;
  const parts: string[] = [];
  const handledCats = new Set<string>();
  for (const g of groups) {
    const inGroup = g.categories.filter(c => selectedCats.has(c));
    if (inGroup.length > 0 && inGroup.length === g.categories.length) {
      parts.push(g.name);
      inGroup.forEach(c => handledCats.add(c));
    }
  }
  for (const c of selectedCats) {
    if (!handledCats.has(c)) parts.push(c);
  }
  const label = parts.length <= 2
    ? parts.join(' + ')
    : `${parts.slice(0, 2).join(' + ')} +${parts.length - 2} more`;
  return `${label} · ${selectedCats.size} ${selectedCats.size === 1 ? 'category' : 'categories'}`;
}, [selectedCats, state.cats, groups]);
```

- [ ] **Step 7: Type-check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

---

### Task 3: Add checkbox column to `GroupBlock`

**Files:**
- Modify: `frontend/src/components/Budget.tsx` (the `GroupBlockProps` interface and `GroupBlock` component)

- [ ] **Step 1: Add new props to `GroupBlockProps` interface**

Find the `GroupBlockProps` interface (around line 72) and add three new props at the end, before the closing `}`:

```tsx
  selectedCats: Set<string>;
  onToggleCatSelection: (name: string) => void;
  onToggleGroupSelection: (gid: string) => void;
```

- [ ] **Step 2: Destructure new props in `GroupBlock`**

In the `GroupBlock` function body, find the destructuring line and add the three new props:

```tsx
  const { group, gidx, color, catState, collapsed, onToggle, fmt, onSaveAssigned, onOpenMove, onOpenInspector,
    rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat, onRenameGroup,
    onMoveGroup, onDeleteGroup, onReorderCat, catCurrencies, toDisplay, toRaw,
    selectedCats, onToggleCatSelection, onToggleGroupSelection } = props;
```

- [ ] **Step 3: Add group checkbox ref and computed state**

After the existing `dragHappened` ref (around line 111), add:

```tsx
  const groupCheckRef = useRef<HTMLInputElement>(null);
  const groupCheckedCount = group.categories.filter(c => selectedCats.has(c)).length;
  const groupChecked = groupCheckedCount === group.categories.length && group.categories.length > 0;
  const groupIndeterminate = groupCheckedCount > 0 && !groupChecked;

  useEffect(() => {
    if (groupCheckRef.current) groupCheckRef.current.indeterminate = groupIndeterminate;
  }, [groupIndeterminate]);
```

- [ ] **Step 4: Add checkbox `<td>` to the group header row**

Find the group header `<tr>` (the one with `style={st.groupRow}`). Change it to add a new first `<td>` for the checkbox, and stop checkbox clicks from triggering the group collapse:

```tsx
      <tr style={st.groupRow}>
        <td style={st.checkCell}>
          <input
            ref={groupCheckRef}
            type="checkbox"
            checked={groupChecked}
            onChange={() => onToggleGroupSelection(group.id)}
            onClick={e => e.stopPropagation()}
            style={st.check}
          />
        </td>
        <td style={st.groupCell} onClick={editMode ? undefined : onToggle}>
```

(The rest of the group header `<td>` and the three number `<td>`s remain unchanged.)

- [ ] **Step 5: Add checkbox `<td>` to each category row**

Find the first `<tr>` for each category (the one with `style={{ ...st.catRow, ... }}`). Add a new first `<td>` after the opening `<tr>`:

```tsx
            <td style={{ ...st.checkCell, padding: rowPad + ' 0 5px 8px', borderBottom: 'none', verticalAlign: 'top' }}>
              <input
                type="checkbox"
                checked={selectedCats.has(cat)}
                onChange={() => onToggleCatSelection(cat)}
                onClick={e => e.stopPropagation()}
                style={st.check}
              />
            </td>
```

Place this `<td>` as the first child inside the `<tr>`, before the existing `<td style={{ ...st.catCell, ... }}>`.

- [ ] **Step 6: Fix `colSpan` on bar row and add-category row**

There are two `colSpan={4}` references in `GroupBlock`. Change both to `colSpan={5}`:

1. The bar row: `<td colSpan={4}` → `<td colSpan={5}`
2. The edit-mode add-category row: `<td colSpan={4}` → `<td colSpan={5}`

- [ ] **Step 7: Add new style entries**

In the `st` styles object at the bottom of `Budget.tsx`, add:

```tsx
  checkCell: { width: 28, padding: '0 4px 0 12px', verticalAlign: 'middle' as const },
  check:     { accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer', display: 'block' },
```

- [ ] **Step 8: Type-check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

---

### Task 4: Wire layout — table header, flex container, GroupBlock props, BudgetSummaryPane

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add checkbox `<th>` to the table header**

Find the `<thead>` section (around line 622). Add a checkbox column header as the first `<th>`:

```tsx
              <thead>
                <tr>
                  <th style={{ ...st.th, width: 28, padding: '12px 4px 12px 12px' }}></th>
                  <th style={{ ...st.th, textAlign: 'left', width: '46%' }}>Category</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Assigned</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Activity</th>
                  <th style={{ ...st.th, textAlign: 'right' }}>Available</th>
                </tr>
              </thead>
```

- [ ] **Step 2: Change outer content div max-width**

Find `maxWidth: 1180` in the content wrapper div and change it to `maxWidth: 1400` to give room for the pane:

```tsx
          <div style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
```

- [ ] **Step 3: Wrap the table and pane in a flex container**

Find the `<div style={st.tableWrap}>` and replace that section so it's wrapped in a flex row alongside `BudgetSummaryPane`. The `BudgetSummaryPane` lives inside the same `tableWrap` container so it inherits the same border and background:

```tsx
          <div style={{ ...st.tableWrap, display: 'flex', alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
              <table style={st.table}>
                <thead>
                  ... (unchanged)
                </thead>
                <tbody>
                  ... (unchanged)
                </tbody>
              </table>
            </div>
            <BudgetSummaryPane
              stats={summaryStats}
              selectionLabel={selectionLabel}
              hasSelection={selectedCats.size > 0}
              onClear={() => setSelectedCats(new Set())}
              fmt={fmtMonth}
            />
          </div>
```

- [ ] **Step 4: Pass selection props to each `GroupBlock`**

Find the `groups.map((g, gi) => <GroupBlock ... />)` call inside `<tbody>`. Add the three new props to every `GroupBlock`:

```tsx
                    selectedCats={selectedCats}
                    onToggleCatSelection={toggleCatSelection}
                    onToggleGroupSelection={toggleGroupSelection}
```

- [ ] **Step 5: Type-check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

---

### Task 5: Manual verification and commit

**Files:** none new

- [ ] **Step 1: Start the dev server**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run dev
```

- [ ] **Step 2: Verify default state (nothing selected)**

Open the Budget page. Confirm:
- Summary pane is visible on the right, inside the same bordered container as the table
- Label reads "All categories · N" where N is the total category count
- The 4 stat cards show values that match the sum across the whole budget
- "Clear selection" button is NOT visible

- [ ] **Step 3: Verify group selection**

Click a group header checkbox. Confirm:
- All category rows in that group become checked
- Summary pane label updates (e.g. "Housing · 2 categories")
- The 4 stat values update to reflect only that group's categories
- "Clear selection" button appears

- [ ] **Step 4: Verify partial group selection**

Uncheck one category within a checked group. Confirm:
- Group header checkbox shows indeterminate state (dash/mixed)
- Summary pane reflects only the still-checked categories

- [ ] **Step 5: Verify individual category selection**

Uncheck everything, then check two individual categories from different groups. Confirm:
- Label reads e.g. "Rent + Groceries · 2 categories"
- Stats reflect only those two categories

- [ ] **Step 6: Verify clear button**

Click "Clear selection". Confirm:
- All checkboxes uncheck
- Pane reverts to all-categories totals
- Clear button disappears

- [ ] **Step 7: Commit**

```bash
cd /home/Berny/budgetapp-ai && git add frontend/src/components/BudgetSummaryPane.tsx frontend/src/components/Budget.tsx && git commit -m "feat: add budget summary pane with category/group selection"
```
