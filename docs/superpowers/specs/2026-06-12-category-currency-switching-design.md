# Category Currency Switching

**Date:** 2026-06-12

## Summary

Allow users to change a budget category's currency (CRC ↔ USD) from the category inspector panel. Historical planned amounts are preserved in their original currency (tracked per budget row). New planned amounts use the category's updated currency going forward.

## Data Model

### Migration

Add `currency TEXT NOT NULL DEFAULT 'CRC'` to the `budgets` table. Existing rows default to `'CRC'`. Each row now records the currency the planned amount was entered in, independent of the category's current currency setting.

The `categories.currency` column continues to serve as the "current default" for new planned entries.

## Backend

### Repository (`budget_repo.go`)

- Introduce `PlannedRow` struct: `{ Amount int64; Currency string }`.
- `GetAllPlannedUpToMonth` return type changes from `map[catID][month]int64` to `map[catID][month]PlannedRow`.
- `UpsertPlanned(ctx, catID, month, amount, currency string)` gains a `currency` parameter.
- `BulkInsertPlannedIfAbsent` carries `currency` from source rows (called by CopyPrevious).

### Service (`plan_service.go`)

- `SetPlanned` looks up the category's current `currency` from `catRepo` and passes it to `UpsertPlanned`. The handler signature is unchanged.
- `GetMonth` uses each row's `PlannedRow.Currency` (not category-level `Currency`) when calling `toCRC` for planned-amount conversion and rollover balance accumulation.
- `ChangeCategoryCurrency` updates only `categories.currency`. No `budgets` rows are modified. The previous `ClearAllPlanned` call is removed.

### Handler

No changes needed. `ChangeCategoryCurrency` handler already exists at `PUT /api/categories/{id}/currency`.

## Frontend

### `BudgetModals.tsx` — `CategoryInspector`

- Add `currency: 'CRC' | 'USD'` prop and local state initialized from it.
- Add a new "Currency" section below "Flexibility", using the same two-button toggle grid style.
- On toggle, call `onChangeCurrency(catId, newCurrency)` immediately (same commit-on-change pattern as `commitFlexibility`).
- New prop: `onChangeCurrency: (catId: string, currency: 'CRC' | 'USD') => void`.

### `Budget.tsx`

- Add `handleChangeCurrency` callback: calls `changeCategoryCurrency(id, currency)` (already in `api.ts`), then calls `onCategoriesChanged()` and increments `fetchCounter`.
- Pass `handleChangeCurrency` to `CategoryInspector` as `onChangeCurrency`.
- Pass `c.currency` to `CategoryInspector` as `currency`.

### Currency badge in budget table rows

Each category row shows a colored pill badge next to the planned amount.

- Badge text: `"USD"` or `"CRC"`.
- USD badge color: `ACCENTS[tweaks.usdBadge]` (background = dim, text = accent color, border = accent with opacity).
- CRC badge color: `ACCENTS[tweaks.crcBadge]` (same pattern).
- Badge receives `usdBadge` and `crcBadge` as props passed from `App` through `Budget`.

### `App.tsx` — Tweaks panel

- `Tweaks` interface gains `usdBadge: AccentKey` (default `'indigo'`) and `crcBadge: AccentKey` (default `'amber'`).
- `TweaksPanel` gains two new swatch rows ("USD Badge", "CRC Badge") using the same circle-swatch pattern as the existing Accent row.
- `updateTweak` already handles arbitrary `keyof Tweaks` — no logic change needed.
- `Budget` receives `usdBadge` and `crcBadge` as additional props.

## Behavior on Currency Change

1. User opens `CategoryInspector` for a category.
2. User toggles the currency from CRC to USD (or vice versa).
3. `handleChangeCurrency` fires → `PUT /api/categories/{id}/currency` → updates `categories.currency`.
4. Past `budgets` rows are untouched; they retain their original `currency` value.
5. The next time the user enters a planned amount for this category, `SetPlanned` looks up the category's (now updated) currency and stores it on the new/updated row.
6. `GetMonth` renders each month's planned amount using its row-level currency for conversion, so historical months display in their original currency while the current month reflects the new one.

## Out of Scope

- Converting existing planned amounts on currency change (user chose to preserve originals).
- Supporting currencies beyond CRC and USD.
- Showing per-month currency history in the UI.
