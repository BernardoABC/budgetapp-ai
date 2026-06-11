# Budget Summary Pane — Design Spec

**Date:** 2026-06-11
**Status:** Approved

## Overview

Add a persistent right-side summary panel to the Budget page. It shows four aggregate stats (left over from last month, assigned this month, activity this month, available) for either a user-defined selection of categories/groups or the entire budget when nothing is selected.

---

## Layout

The budget page content area splits into two columns:

- **Left**: the existing category table (shrinks to fill remaining width)
- **Right**: a fixed-width summary pane (~240px), separated by a 1px vertical divider

The pane is always visible — no toggle. It uses the same dark surface color as the rest of the page (`T.surface` / `#0d1117`).

---

## Selection Mechanism

A checkbox column is added as the first column of the budget table (before the Category column). It appears on both group header rows and category rows.

**Behavior:**
- Checking a group header checks all categories in that group; unchecking it unchecks all.
- Categories can be checked individually regardless of their group's state (partial group selection is valid).
- If a group has some but not all categories checked, its checkbox shows an indeterminate state.
- When zero checkboxes are checked, the pane defaults to totals across all categories and the selection label reads "All categories."
- A "Clear selection" button inside the pane unchecks everything and returns to all-categories mode.

Selection state is local UI state (not persisted). It resets when navigating away or changing months.

---

## Summary Pane Content

Four stat cards stacked vertically, each showing a label and a value:

| Stat | Source field | Color |
|------|-------------|-------|
| Left over from last month | `sum(carryIn)` for selected cats | green |
| Assigned this month | `sum(assigned)` | neutral (white) |
| Activity this month | `sum(activity)` | red if negative, green if positive |
| Available | `sum(available)` | green if ≥ 0, red if negative |

Above the stats: a short selection summary line ("Housing + Groceries · 3 categories" or "All categories · N categories").

Below the stats: a "✕ Clear selection" button (only visible when something is selected).

All values are formatted with `fmtMonth` — the same formatter used by the table — so they automatically display in CRC or USD depending on the user's currency setting.

---

## Data Flow

All required data (`carryIn`, `assigned`, `activity`, `available`) is already present in `MonthState.cats` computed by the `compute()` engine. No new API calls or backend changes are needed.

The selected set of category names is held in a `Set<string>` state in the `Budget` component. When empty, the pane iterates over all categories in `state.cats`. When non-empty, it iterates only over the selected category names.

---

## Component Structure

Changes are contained entirely within the frontend:

- **`Budget.tsx`**:
  - Add `selectedCats: Set<string>` state
  - Add `toggleCatSelection(name)` and `toggleGroupSelection(gid)` handlers (distinct from the existing `toggleGroup` collapse handler)
  - Compute `summaryStats` (the four sums) from `selectedCats` + `state.cats`
  - Wrap existing table in a flex row alongside the new `BudgetSummaryPane` component
  - Pass checkbox props down to `GroupBlock`

- **`GroupBlock`** (in `Budget.tsx`):
  - Render a checkbox as first column in group header row and each category row
  - Checkbox `onChange` calls `toggleGroupSelection` / `toggleCatSelection`
  - Indeterminate state on group checkbox when partially selected

- **`BudgetSummaryPane`** (new component, added to `Budget.tsx` or extracted to `BudgetSummaryPane.tsx`):
  - Props: `stats`, `selectionLabel`, `hasSelection`, `onClear`, `fmt`
  - Pure display component — no internal state

---

## Out of Scope

- Persisting selection across month changes or page navigation
- Exporting/copying the summary stats
- Additional stats beyond the four listed
