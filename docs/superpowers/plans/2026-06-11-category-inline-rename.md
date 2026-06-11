# Category Inline Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to rename a category inline from the normal budget view by clicking the name once to select it, then clicking again to enter rename mode.

**Architecture:** Pass `inspectorCat` down to `GroupBlock` as a new prop to serve as the selection indicator. Add `renamingCat` and `renameVal` local state to `GroupBlock`. The category name button's click handler checks whether that category is already selected (i.e., `inspectorCat === cat`) and enters rename mode instead of re-opening the inspector.

**Tech Stack:** React 18, TypeScript, inline styles (no CSS files)

---

## File Map

- Modify: `frontend/src/components/Budget.tsx`
  - `GroupBlockProps` interface — add `inspectorCat: string | null`
  - `GroupBlock` function — add local state + updated click/render logic
  - `Budget` JSX — pass `inspectorCat` to each `GroupBlock`

---

### Task 1: Add `inspectorCat` prop to `GroupBlockProps` and pass it from `Budget`

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add `inspectorCat` to `GroupBlockProps`**

In `frontend/src/components/Budget.tsx`, find the `GroupBlockProps` interface (line ~72). Add one line after `onOpenInspector`:

```typescript
interface GroupBlockProps {
  group: CategoryGroup;
  gidx: number;
  color: string;
  catState: MonthState['cats'];
  collapsed: boolean;
  onToggle: () => void;
  fmt: (n: number) => string;
  onSaveAssigned: (cat: string, v: number) => void;
  onOpenMove: (cat: string) => void;
  onOpenInspector: (cat: string) => void;
  inspectorCat: string | null;          // <-- add this line
  rowPad: string;
  editMode: boolean;
  hidden: Set<string>;
  showHidden: boolean;
  onRenameCat: (gid: string, old: string, nw: string) => void;
  onMoveCat: (gid: string, idx: number, dir: number) => void;
  onHideCat: (cat: string) => void;
  onDeleteCat: (gid: string, cat: string) => void;
  onAddCat: (gid: string, name: string, currency: 'CRC' | 'USD') => void;
  onRenameGroup: (gid: string, name: string) => void;
  catCurrencies: Record<string, string>;
  onMoveGroup: (idx: number, dir: number) => void;
  onDeleteGroup: (gid: string) => void;
  onReorderCat: (gid: string, fromIdx: number, toIdx: number) => void;
  toDisplay?: (raw: number) => number;
  toRaw?: (display: number) => number;
}
```

- [ ] **Step 2: Destructure `inspectorCat` in `GroupBlock`**

Find the destructure line at the top of `GroupBlock` (line ~102). Add `inspectorCat` to it:

```typescript
function GroupBlock(props: GroupBlockProps) {
  const { group, gidx, color, catState, collapsed, onToggle, fmt, onSaveAssigned, onOpenMove, onOpenInspector,
    inspectorCat, rowPad, editMode, hidden, showHidden, onRenameCat, onMoveCat, onHideCat, onDeleteCat, onAddCat,
    onRenameGroup, onMoveGroup, onDeleteGroup, onReorderCat, catCurrencies, toDisplay, toRaw } = props;
```

- [ ] **Step 3: Pass `inspectorCat` from `Budget` to each `GroupBlock`**

Find the `GroupBlock` JSX in `Budget`'s render (line ~644). Add `inspectorCat={inspectorCat}` to the props:

```tsx
{groups.map((g, gi) => (
  <GroupBlock key={g.id} group={g} gidx={gi} color={colorFor(g.name, gi)} catState={state.cats}
    collapsed={!!collapsed[g.id]} onToggle={() => toggleGroup(g.id)} fmt={fmtMonth} onSaveAssigned={handleSaveAssigned}
    onOpenMove={setMoveCat} onOpenInspector={setInspectorCat} inspectorCat={inspectorCat} rowPad={rowPad}
    editMode={editMode} hidden={hidden} showHidden={showHidden}
    onRenameCat={renameCat} onMoveCat={reorderCat} onHideCat={hideCat} onDeleteCat={deleteCat} onAddCat={addCat}
    onRenameGroup={renameGroup} onMoveGroup={moveGroup} onDeleteGroup={deleteGroup} onReorderCat={handleReorderCat}
    catCurrencies={catCurrencies} toDisplay={toDisplayFn} toRaw={toRawFn} />
))}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "refactor: pass inspectorCat to GroupBlock as selection indicator"
```

---

### Task 2: Add rename state to `GroupBlock` and update click logic

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add `renamingCat` and `renameVal` state to `GroupBlock`**

Find the existing state declarations in `GroupBlock` (line ~104, after the props destructure). Add two new state variables:

```typescript
const [hovCat, setHovCat] = useState<string | null>(null);
const [adding, setAdding] = useState(false);
const [newCat, setNewCat] = useState('');
const [newCatCurrency, setNewCatCurrency] = useState<'CRC' | 'USD'>('CRC');
const [renamingCat, setRenamingCat] = useState<string | null>(null);  // <-- add
const [renameVal, setRenameVal] = useState('');                        // <-- add
const cellRefs = useRef<Record<string, BudgetCellHandle | null>>({});
const [dragCat, setDragCat] = useState<string | null>(null);
const [dragOverCat, setDragOverCat] = useState<string | null>(null);
const dragHappened = useRef(false);
```

- [ ] **Step 2: Update the category name button click handler**

Find the category name button in the non-editMode branch (line ~200):

```tsx
<button onClick={e => { e.stopPropagation(); onOpenInspector(cat); }} style={{ ...st.catName, color: over ? T.neg : T.textMid }}>{cat}</button>
```

Replace it with logic that opens the inspector on first click, and enters rename mode on second click (when already selected):

```tsx
<button
  onClick={e => {
    e.stopPropagation();
    if (inspectorCat === cat) {
      setRenamingCat(cat);
      setRenameVal(cat);
    } else {
      onOpenInspector(cat);
    }
  }}
  style={{ ...st.catName, color: over ? T.neg : inspectorCat === cat ? T.text : T.textMid }}
>
  {cat}
</button>
```

The `color` change from `T.textMid` to `T.text` when selected gives a subtle brightness boost as the selection indicator.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "feat: track rename state in GroupBlock, click selected name to rename"
```

---

### Task 3: Render inline rename input and wire up commit/cancel

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Wrap the category name area in a rename-or-display conditional**

Find the non-editMode category name area (the `<div>` containing the drag handle, name button, target chip, and underfunded badge, line ~198). Replace the name button with a conditional that renders an input when renaming:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
  <span style={{ ...st.dragHandle, opacity: hovCat === cat ? 0.35 : 0 }}>⠿</span>
  {renamingCat === cat ? (
    <input
      autoFocus
      value={renameVal}
      onChange={e => setRenameVal(e.target.value)}
      onClick={e => e.stopPropagation()}
      onBlur={() => {
        const trimmed = renameVal.trim();
        if (trimmed && trimmed !== cat) onRenameCat(group.id, cat, trimmed);
        setRenamingCat(null);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setRenameVal(cat); setRenamingCat(null); }
      }}
      style={st.renameInput}
    />
  ) : (
    <button
      onClick={e => {
        e.stopPropagation();
        if (inspectorCat === cat) {
          setRenamingCat(cat);
          setRenameVal(cat);
        } else {
          onOpenInspector(cat);
        }
      }}
      style={{ ...st.catName, color: over ? T.neg : inspectorCat === cat ? T.text : T.textMid }}
    >
      {cat}
    </button>
  )}
  {tLabel && <span style={st.targetChip} title="Target">◎ {tLabel}</span>}
  {c.underfunded > 0 && <span style={st.underBadge}>−{fmt(c.underfunded)}</span>}
</div>
```

Note: `onClick={e => e.stopPropagation()}` on the input prevents the row's click handler (which starts editing the assigned cell) from firing while renaming.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Start the dev server:
```bash
cd /home/Berny/budgetapp-ai/frontend && npm run dev
```

Open the budget view and verify:
1. Clicking a category name opens the inspector and the name becomes slightly brighter (selected state).
2. Clicking the same name again replaces it with a focused input pre-filled with the current name.
3. Typing a new name and pressing Enter (or clicking away) renames the category. The inspector remains open.
4. Pressing Escape cancels without renaming.
5. Clicking a different category clears the previous selection and opens the new inspector.
6. The row's assigned-cell edit (clicking elsewhere on the row) still works normally.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "feat: inline category rename on click-select, click-again pattern"
```
