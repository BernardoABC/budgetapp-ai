# Category Inline Rename Design

**Date:** 2026-06-11
**Status:** Approved

## Summary

Allow users to rename a category directly from the normal budget view without entering edit mode. Uses a click-to-select, click-again-to-rename pattern (Finder-style).

## Interaction Model

**First click** on a category name: opens the inspector (existing behavior) and marks that category as "selected."

**Second click** on the already-selected category name: enters inline rename mode. The inspector remains open.

**Clicking a different category** clears the previous selection by opening the inspector for the new category.

## State

- **Selection state:** reuse the existing `inspectorCat` state in `Budget` as the selection indicator. A category is selected when `inspectorCat === cat`. No new state added to `Budget`.
- **Rename state:** add `renamingCat: string | null` as local state in `GroupBlock`. Cleared on commit or cancel.
- **Rename input value:** managed as local state in `GroupBlock` alongside `renamingCat`.

## Component Changes

### `GroupBlock` (`Budget.tsx`)

- Add `inspectorCat: string | null` prop.
- Add `renamingCat: string | null` local state.
- Add `renameVal: string` local state.
- Click handler on the category name button:
  - If `inspectorCat !== cat`: call `onOpenInspector(cat)` (unchanged behavior).
  - If `inspectorCat === cat`: set `renamingCat = cat`, `renameVal = cat`.
- When `renamingCat === cat`: render an auto-focused `<input>` styled with `st.renameInput` in place of the name button.
  - On blur or Enter: if `renameVal.trim()` is non-empty and differs from current name, call `onRenameCat(group.id, cat, renameVal.trim())`; then clear `renamingCat`.
  - On Escape: clear `renamingCat` without saving.
- Visual selection indicator: when `inspectorCat === cat` and not renaming, apply a slightly brighter color to the category name text to signal it is selected and a second click will rename.

### `Budget` (`Budget.tsx`)

- Pass `inspectorCat` down to each `GroupBlock` as a new prop.

## What Does Not Change

- Edit mode rename behavior (`InlineRename` in edit mode) is untouched.
- Inspector open/close logic is untouched.
- No API or backend changes — `onRenameCat` already handles the backend call.
- No new files.
