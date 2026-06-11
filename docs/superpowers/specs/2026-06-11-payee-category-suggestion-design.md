# Payee Category Suggestion

**Date:** 2026-06-11

## Summary

When a user assigns a category to a transaction in the Accounts page, the app checks for other transactions with the same payee and presents two sequential prompts: one to retroactively apply the category to all matching transactions, and one (if the transaction previously had a different category) to create/update a payee rule for future imports.

---

## Trigger Conditions

After `updateTransaction()` succeeds in `handleSave()` (single transaction edit only — not bulk actions):

1. The saved transaction has a non-empty payee.
2. The app fetches all transactions with that payee (all pages, no cap), excludes the just-saved transaction.

**Q1 (retroactive):** Always shown if any matching transactions exist, regardless of their current category.

**Q2 (payee rule):** Only shown if the transaction previously had a category different from the newly assigned one. Appears after Q1 resolves regardless of the user's answer to Q1.

---

## Frontend State

A new `payeeSuggestionModal` state in `Accounts.tsx`:

```ts
type PayeeSuggestionModal = {
  step: 1 | 2;
  payee: string;
  transactions: Transaction[];   // other txns with same payee
  categoryId: string;
  categoryName: string;
  hadPreviousCategory: boolean;  // whether Q2 should appear after Q1
} | null;
```

---

## Flow

### 1. After successful save

- Capture `previousCategory` from the transaction before calling `updateTransaction()`.
- On success, fetch all transactions for the account filtered by the payee (`search` param), paginating until exhausted.
- Filter client-side to exact payee match (the search is fuzzy) and exclude the current transaction ID.
- If any remain, set `payeeSuggestionModal` to `{ step: 1, ... }`.

### 2. Q1 Modal — Retroactive

**Text:** "X other transactions have '[payee]' as payee. Apply '[category]' to all of them?"  
**Actions:** Yes / No

- **Yes:** Call `PATCH /api/transactions/batch` with `action: 'categorize'`, `category_id`, and the IDs of all matching transactions.
- **No:** Dismiss.
- **After either answer:** If `hadPreviousCategory` is true, advance `step` to 2.

### 3. Q2 Modal — Payee Rule

**Text:** "Create a rule so future '[payee]' imports are automatically categorized as '[category]'?"  
**Actions:** Yes / No

- **Yes:** Check existing payee rules for an exact match on the payee string. If found, PUT to update it; if not, POST to create it.
- **No / after either answer:** Close modal.

---

## Components

- **`Accounts.tsx`:** Add `payeeSuggestionModal` state; modify `handleSave()` to populate it post-save; add pagination helper to fetch all payee transactions.
- **`AccountsModals.tsx`:** Add `PayeeSuggestionModal` component rendering Q1 and Q2 steps, following existing modal patterns.

---

## API Usage

| Operation | Endpoint | Notes |
|---|---|---|
| Fetch payee transactions | `GET /api/accounts/:id/transactions?search=:payee&page=:n` | Paginate until results < per_page |
| Batch categorize | `PATCH /api/transactions/batch` | Existing endpoint, no changes |
| List payee rules | `GET /api/payee-rules` | Check for existing rule before create/update |
| Create payee rule | `POST /api/payee-rules` | Match pattern = exact payee string |
| Update payee rule | `PUT /api/payee-rules/:id` | Only when rule already exists for payee |

**No backend changes required.**

---

## Out of Scope

- Bulk action categorization (the checkbox "Apply to all selected") does not trigger these prompts.
- Split transactions are not affected.
- The feature only fires on the Accounts page transaction row edit, not on the Add Transaction form.
