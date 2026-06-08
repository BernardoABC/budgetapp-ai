# Transfer Link in Category Picker — Design

## Summary

Add a sentinel option at the top of the category `<select>` in `EditableRow`'s inline edit mode that lets the user link a transaction as a transfer without leaving the row editor. The existing "Link" button in read mode is kept as-is.

## UI Change

### Category dropdown (edit mode only)

The category `<select>` in `EditableRow`'s editing branch gains a new first option:

```
↔ Transfer to account…   ← sentinel, value = "__transfer__"
— Uncategorized —
Groceries
Rent
…
```

The sentinel option is styled slightly dimmer than real categories to signal it is an action, not a category name.

### Behaviour on selection

When `onChange` fires with `__transfer__`:

1. `draft.category` is reset to `''` immediately — so clicking Save at any point from here saves the transaction as uncategorized.
2. `onLink(t)` is called — opens the existing 2-step link modal (pick target account → pick candidate transaction).

### On successful link

The modal closes and the transaction list reloads. The row exits editing mode and now displays the `⇄ Transfer` badge.

### On modal dismiss (no peer chosen)

Editing mode stays open. `draft.category` is `''`. The user can pick a real category or click Save to save as uncategorized. No transfer link is created.

## Existing "Link" button

The `Link` button that appears in read mode (on non-transfer rows) is unchanged. Both entry points coexist.

## Scope

- **Modify:** `frontend/src/components/Accounts.tsx` — inside `EditableRow`'s editing branch only
- No new props, no new state, no backend changes
