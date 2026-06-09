# Inflow: Ready to Assign Category

**Date:** 2026-06-08
**Status:** Approved

## Summary

Add a system-level "Inflow: Ready to Assign" category so that income transactions (salary, etc.) can be explicitly categorized as flowing into the RTA pool, matching YNAB's model. A shared `CategorySelect` component replaces all inline category `<select>` elements, rendering system categories distinctly at the top and regular categories grouped under their expense groups.

---

## Data Model

### Migration `008_inflow_category.sql`

1. Add `is_system BOOLEAN NOT NULL DEFAULT false` to `categories`.
2. Add `is_system BOOLEAN NOT NULL DEFAULT false` to `category_groups`.
3. Insert system group `"Inflows"` with `is_system = true`, `sort_order = 0`, `hidden = false`.
4. Insert category `"Inflow: Ready to Assign"` under the Inflows group with `is_system = true`, `sort_order = 0`.
5. Migrate existing uncategorized inflows using a CTE that captures the new category ID:
   ```sql
   WITH rta AS (
     SELECT id FROM categories WHERE name = 'Inflow: Ready to Assign' AND is_system = true
   )
   UPDATE transactions
   SET category_id = rta.id
   FROM rta
   WHERE transactions.amount > 0 AND transactions.category_id IS NULL;
   ```

No existing migrations are modified.

---

## Backend

### `model/category.go`
- Add `IsSystem bool \`json:"is_system"\`` to `Category` and `CategoryGroup` structs.

### `repository/category_repo.go` — `ListGroups`
- Existing query already returns all groups and categories. No change needed; `is_system` column is scanned into the new struct field automatically.

### `service/budget_service.go` — RTA & available calculation
- In the rollover loop and the `groupBudgets` builder, **skip categories where `is_system = true`**.
- System categories' activity never enters `totalAvailable`, so `rta = balance - totalAvailable` correctly increases when an inflow hits "Inflow: Ready to Assign".
- System groups are excluded from the `CategoryGroups` array in the `BudgetMonth` response (not rendered in the budget table).

### `handler/budget.go`
- When serialising `category_groups` in the month response, filter out groups where `is_system = true`. The categories endpoint is unaffected and returns all groups including system ones (for the picker).

---

## Frontend

### New component: `src/components/CategorySelect.tsx`
Props:
```ts
interface CategorySelectProps {
  value: string;           // category ID or ''
  onChange: (id: string | null) => void;
  categoryGroups: CategoryGroup[];
  style?: React.CSSProperties;
}
```

Render order:
1. `<option value="">— Uncategorized —</option>`
2. For each system group (sorted by `sort_order`): `<optgroup label="━━ INFLOWS ━━">` containing its system categories.
3. For each non-system group (sorted by `sort_order`): `<optgroup label={group.name}>` containing its categories.

The system optgroup label uses em-dashes and uppercase to visually distinguish it from regular expense groups. No inline styles beyond what's already on the existing `<select>` elements.

### `Accounts.tsx`
- Replace inline `<select>` for category (in the edit row) with `<CategorySelect>`.
- Replace inline `<select>` in the filter bar with `<CategorySelect>`. The filter bar variant adds an extra `<option value="__uncategorized__">Uncategorized</option>` before the group options to preserve the existing filter sentinel.

### `Import.tsx`
- Replace inline `<select>` in Step 2 transaction rows with `<CategorySelect>`.
- Replace inline `<select>` in `RulesManager` with `<CategorySelect>`.

### `api.ts` / `types`
- Add `is_system: boolean` to the `Category` and `CategoryGroup` TypeScript interfaces.

---

## Edge Cases

1. **Payee rules targeting "Inflow: Ready to Assign"** — allowed; the category is a normal FK target from `payee_rules`. The auto-categorizer can learn to apply it.
2. **Transfers** — Transfer legs are already linked via `transfer_peer_id` and bypass the category picker entirely. No interaction with this feature.
3. **Negative amount + "Inflow: Ready to Assign"** — Technically possible if a user selects it manually on an outflow. The budget engine simply ignores this category in `totalAvailable` regardless of sign, so it would reduce the account balance without affecting RTA — a minor UX oddity. No validation is added in v1 (YAGNI).
4. **Future system categories** — The `is_system` flag on both table levels accommodates additions (e.g., "Inflow: Starting Balance") with no schema changes.
