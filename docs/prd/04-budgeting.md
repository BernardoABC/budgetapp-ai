# PRD 04: Zero-Based Budgeting

## Overview
The budgeting system follows YNAB's core philosophy: **give every colon a job**. Each month, the user allocates their available money across categories. Spending is tracked against these allocations in real time.

## Core Concepts

### Ready to Assign (formerly "To Be Budgeted")
The total amount of money available to allocate. Calculated as:

```
Ready to Assign = Total on-budget account balances
                - Total assigned across all categories for current and prior months
                + Total net category activity that reduced assigned amounts
```

In simpler terms: it's the money that hasn't been given a job yet.

### Budget Month
A budget is organized by calendar month. Each month has:
- **Assigned** — How much money is allocated to each category
- **Activity** — How much was actually spent (sum of transactions) in each category
- **Available** — Assigned + Activity (activity is negative for spending)

### Category Rollover
Available balances roll forward month to month:
- If you budget ₡50,000 for Groceries in April and only spend ₡40,000, the remaining ₡10,000 carries into May
- If you overspend (available goes negative), the negative amount carries forward too
- The user can choose to cover overspending from Ready to Assign or from other categories

## Data Model

### budgets table (per-category, per-month)
```sql
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id),
    month DATE NOT NULL,  -- always the 1st of the month
    assigned BIGINT NOT NULL DEFAULT 0,  -- in CRC centimos
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(category_id, month)
);
```

### Computed Values (not stored)
These are calculated on the fly or via a materialized view:

| Value | Calculation |
|-------|-------------|
| **Activity** | `SUM(transactions.amount) WHERE category_id = X AND date WITHIN month` |
| **Available** | `assigned + activity + available_from_previous_month` |
| **Ready to Assign** | `SUM(on_budget_account_balances) - SUM(all_assigned_ever)` |

## Budget Calculation Engine

### Monthly Budget Summary
For a given month (e.g., April 2026), for each category:

```
previous_available = calculate_available(category, previous_month)
assigned = budgets.assigned WHERE category_id AND month
activity = SUM(transactions.amount) WHERE category_id AND date IN month AND account.on_budget = true
available = previous_available + assigned + activity
```

### Ready to Assign Calculation

```sql
-- Total inflows to on-budget accounts (all time up to and including this month)
total_inflows = SUM(amount) FROM transactions 
    WHERE amount > 0 AND account.on_budget = true AND date <= end_of_month

-- Total assigned across all categories (all time up to and including this month)
total_assigned = SUM(assigned) FROM budgets 
    WHERE month <= this_month

-- Total outflows from on-budget accounts to off-budget accounts or external
-- (This is implicitly handled — spending reduces account balances which reduces inflows)

ready_to_assign = total_inflows - total_assigned + total_outflow_adjustments
```

For simplicity in v1, Ready to Assign can be calculated as:
```
ready_to_assign = SUM(on_budget_account.balance) - SUM(all_categories.available)
```

## Category Targets

Categories can have a target that drives the underfunded calculation:

| Target type | Behavior |
|------------|----------|
| `monthly` | Must assign X each month; underfunded = X − assigned |
| `refill` | Must keep available at X; underfunded = X − available |
| `savings` | Save X by a deadline; distributes remaining need across remaining months |

Targets are shown as a chip on the category row (e.g., "₡450,000 / month") and as a funded percentage bar in the Category Inspector.

## Quick Assign Strategies

Three one-click bulk actions operate on the current month:

| Action | Behavior |
|--------|---------|
| Auto-assign underfunded | For each category with a target, adds the underfunded amount to assigned |
| Last month | Copies every category's assigned value from the previous month |
| Reset | Sets all assigned values to 0 |

## Age of Money

Displayed in the RTA card. Source: `AppData.ageOfMoney` (monthly snapshot). Represents how many days old the money you spend today is — higher is better.

## Budget UI

### Top Bar
- Month navigator (‹ prev | MONTH YEAR | next ›)
- **RTA card**: Ready to Assign (green when positive, amber at 0, red when negative) · Underfunded total · Age of Money
- Action buttons: Auto-assign underfunded, Last month, Reset, Edit (toggle edit mode)

### Category Table (per month)
Columns: Category · Assigned · Activity · Available

Each category row has two sub-rows:
1. Main row — name, assigned cell (click to edit), activity, available pill
2. Progress bar row — thin bar showing `|activity| / assigned` as a percentage
   - Color: group color when healthy, amber when >85% spent, red when overspent

Available pill colors:
- Green (neutral) — funds available
- Amber — nearly depleted (<15% remaining)
- Red — overspent

Click the Available pill to open **Move Money** modal. Click the category name to open **Category Inspector**.

### Edit Mode
Toggle with the Edit button. While active:
- Category names become inline-editable text inputs
- Reorder arrows appear for categories and groups
- Hide / Delete buttons per category
- Add category button per group
- Add group button in the edit bar

### Move Money Modal
Transfers assigned amount between two categories. Shows before/after balance for both sides. If the source category is overspent, shows a "Cover {amount}" shortcut.

### Category Inspector (slide-in drawer, right side)
- Available balance (large, colored by sign)
- Stats: Assigned · Activity · Underfunded
- Target editor: set/change target type and amount
- Funded progress bar + percentage
- Actions: Move money · Hide · Delete

## API Endpoints

### GET /api/budgets/:month
Get budget data for a month (e.g., `2026-04`).

```json
{
  "month": "2026-04",
  "ready_to_assign": 14500000,
  "category_groups": [
    {
      "id": "uuid",
      "name": "Food & Drink",
      "assigned": 21000000,
      "activity": -14459700,
      "available": 6540300,
      "categories": [
        {
          "id": "uuid",
          "name": "Groceries",
          "assigned": 12000000,
          "activity": -7472200,
          "available": 4527800
        }
      ]
    }
  ]
}
```

### PUT /api/budgets/:month/categories/:categoryId
Set the assigned amount for a category in a month.

```json
{ "assigned": 12000000 }
```

### POST /api/budgets/:month/copy-previous
Copy all assignments from the previous month.

### POST /api/budgets/:month/move
Move money between categories.

```json
{
  "from_category_id": "uuid",
  "to_category_id": "uuid",
  "amount": 1000000
}
```

## Edge Cases

1. **First month ever** — No rollover, no previous data. Ready to Assign equals total on-budget account balances.
2. **No budget set for a category** — Assigned = 0 for that month. Activity still tracked. Available = rollover + 0 + activity.
3. **Overspent category** — Available goes negative (red). The negative rolls into next month unless the user covers it.
4. **Income categorization** — Inflows (positive transactions) that aren't transfers increase Ready to Assign. They don't get categorized to budget categories (they go to "Inflow: Ready to Assign" special category).
5. **Off-budget accounts** — Transactions in off-budget accounts (tracking accounts) don't appear in budget calculations.
6. **Mid-month account addition** — When adding a new on-budget account, its balance immediately flows into Ready to Assign.
