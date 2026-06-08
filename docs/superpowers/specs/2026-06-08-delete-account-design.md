# Delete Account — Design

## Summary

Add a hard-delete action for accounts. The backend (`DELETE /accounts/{id}`) and frontend `deleteAccount()` already exist. This is a pure UI change: surface a Delete button and a confirmation modal.

## UI Changes

### Header button (`Accounts.tsx`)

Add a "Delete" button to the account header, to the left of the Rules/Reconcile buttons. Style it with `T.neg` text color and a `T.neg`-tinted border so it reads as a destructive action at a glance — visually distinct from the neutral and accent buttons.

### Confirmation modal

A small inline modal (same pattern as the existing add-transaction modal in `Accounts.tsx`) triggered by clicking Delete. Contents:

- Account name displayed prominently
- Warning: "This will permanently delete all transactions for this account and cannot be undone."
- "Cancel" button (neutral style)
- "Delete Account" button (red, disabled + shows "Deleting…" while in flight)

State: `deleteConfirm: boolean` added to existing component state.

## Post-deletion Navigation

After the API call succeeds:

1. Call `onAccountsChanged()` (triggers account list reload in App.tsx).
2. Call `onDeleted(accountId)` — a new prop added to `Accounts`.

In `App.tsx`, `onDeleted` is wired to navigate to the first remaining account (budget first, then tracking, excluding the deleted ID). If no accounts remain, navigate to `'dashboard'`.

## Prop Changes

`Accounts` gains one new prop:

```ts
onDeleted: (deletedId: string) => void
```

`App.tsx` passes:

```ts
onDeleted={(id) => {
  const remaining = [
    ...(accounts.budget ?? []),
    ...(accounts.tracking ?? []),
  ].filter(a => a.id !== id);
  navigate('accounts', remaining[0]?.id ?? '');
}}
```

(If `remaining` is empty, `navigate('accounts', '')` lands on dashboard or an empty state — same behaviour as today when no accounts exist.)

## Scope

- `frontend/src/components/Accounts.tsx` — button + modal + `onDeleted` prop
- `frontend/src/App.tsx` — pass `onDeleted` prop
- No new files, no backend changes
