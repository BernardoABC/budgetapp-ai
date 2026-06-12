# Undo (Ctrl+Z) — Design Spec

**Date:** 2026-06-11  
**Scope:** Session-only undo for all budget mutations — assignment changes, structural changes, and target changes.

---

## Overview

YNAB-style Ctrl+Z undo covering every user action in the Budget view. Session-only (history is cleared on page reload). No redo. Max history depth: 50 entries.

---

## Core Data Structure

```typescript
interface UndoEntry {
  label: string;   // human-readable description shown in toast
  undo: () => void; // reverses the action, including any API call
}
```

---

## New File: `frontend/src/hooks/useUndoStack.ts`

A generic hook with no budget domain knowledge:

- `stack: UndoEntry[]` held in `useState` (not `useRef`) so consumers can react to changes
- `push(entry: UndoEntry)`: prepends to stack, caps at 50 entries (oldest dropped)
- `pop()`: pops the top entry, calls `entry.undo()`, returns the label (caller shows toast)
- `canUndo: boolean`: derived from `stack.length > 0`

The invariant that `undo()` functions never push to the stack is enforced by the "raw handler" pattern (see Architecture section).

---

## Keyboard Handler

A `useEffect` in `Budget` registers a `keydown` listener on `document`:

- Fires on `Ctrl+Z` (Windows/Linux) and `Cmd+Z` (Mac)
- Skips if `document.activeElement` is an `<input>` or `<textarea>` — native text undo is preserved inside cells
- Calls `undoStack.pop()` and shows a toast: `"Undone: [label]"`
- Cleaned up on unmount

No undo button in the toolbar — keyboard-only, matching YNAB UX.

---

## Architecture: Raw + Public Handler Pattern

Each handler is split into two versions:

```typescript
// raw — executes the action, no undo push
const rawSaveAssigned = (cat: string, value: number) => { /* existing logic */ };

// public — captures snapshot, pushes UndoEntry, calls raw
const handleSaveAssigned = (cat: string, value: number) => {
  const prev = localBudget[currentDisplayMonth]?.[cat]?.assigned ?? 0;
  undoStack.push({ label: `Assign ${cat}`, undo: () => rawSaveAssigned(cat, prev) });
  rawSaveAssigned(cat, value);
};
```

Undo functions call raw versions directly, so they never push a new entry.

---

## Per-Action Inverse Operations

### Assignment changes

| Action | Undo |
|--------|------|
| `handleSaveAssigned(cat, value)` | Restore previous `assigned` for cat + `apiSetAssigned(month, catId, prev)` |
| `doQuickAssign('underfunded' \| 'reset')` | Snapshot entire `localBudget[currentMonth]`; undo restores snapshot + `apiSetAssigned` for every changed cat |
| `doQuickAssign('lastMonth')` | Snapshot `localBudget[currentMonth]` before calling `copyPreviousBudget`; undo bulk-restores each category via `apiSetAssigned` and re-applies the snapshot to `localBudget` |
| `handleMove(fromCat, toCat, amount)` | Call `moveBudgetMoney(toId, fromId, amount)` + reverse `localBudget` delta |

### Structural changes

| Action | Undo |
|--------|------|
| `renameCat(gid, old, new)` | `rawRenameCat(gid, new, old)` |
| `reorderCat(gid, idx, dir)` (arrow buttons, local-only) | `rawReorderCat(gid, idx + dir, -dir)` |
| `handleReorderCat(gid, from, to)` (drag-drop) | `rawHandleReorderCat(gid, to, from)` |
| `hideCat(name)` | `rawHideCat(name)` (toggle — same function) |
| `addCat(gid, name, currency)` | `rawDeleteCat(gid, name)` |
| `deleteCat(gid, name)` | Snapshot `{ currency, assigned, sortIndex }`; undo: `createCategory(...)` → use the new category ID from the API response directly → `apiSetAssigned(month, newId, assigned)` → `onCategoriesChanged()` to sync local state |
| `renameGroup(gid, name)` | `rawRenameGroup(gid, previousName)` (local-only, no API) |
| `moveGroup(idx, dir)` | `rawMoveGroup(idx + dir, -dir)` (local-only) |
| `addGroup()` | `rawDeleteGroup(newGroupId)` — ID captured from server response in `.then()` |
| `deleteGroup(gid)` | Snapshot group name + all `{ name, currency, assigned }` per cat; undo: `createCategoryGroup` → `createCategory` for each → `apiSetAssigned` for each. If any step fails, show error toast and abort. |

### Target changes

| Action | Undo |
|--------|------|
| `setTarget(cat, target)` (set or delete) | Snapshot previous `targets[cat]`; undo: `rawSetTarget(cat, prevTarget)` |

---

## Error Handling

- Simple actions (assign, rename, hide): undo failures show an error toast via `useToast`, matching existing error handling style.
- Complex async undos (`deleteCat`, `deleteGroup`): if the server re-create fails partway, show error toast and abort — do not leave partial state.

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useUndoStack.ts` | **New** — generic undo stack hook |
| `frontend/src/components/Budget.tsx` | Add `useUndoStack`, Ctrl+Z listener, raw/public handler split for all 14 action types |

No changes to `engine.ts`, `api.ts`, or any other file.

---

## Out of Scope

- Redo
- Persistence across page reloads
- Undo in non-Budget views (Accounts, Reports, Import)
