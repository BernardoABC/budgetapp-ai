# Multi-Currency Budget Design

**Date:** 2026-06-10

## Problem

The user operates in both CRC and USD. Some expenses are natively USD (rent: $1,500/month, always the same regardless of exchange rate). Some categories receive mixed-currency spending (Trips: assigned ₡300,000 CRC but charged $100 USD for Airbnb and ₡50,000 CRC for transportation). The existing budget model stores all assigned amounts in CRC centimos, making USD-denominated categories impossible and creating drift every time the exchange rate moves.

## Decisions

- Each category has a native currency (`CRC` or `USD`) that governs what denomination the `assigned` value is stored in.
- Activity is always multi-currency capable — any category can receive spending from accounts of any currency.
- RTA is a single CRC number (base currency), with a breakdown showing unassigned CRC account balances and USD account balances (converted) separately.
- Cross-currency linked transfers skip amount validation — each side records exactly what the bank reported.

## Data Model

### categories table

Add one column:

```sql
ALTER TABLE categories ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'CRC';
```

Existing categories default to `CRC`. The user sets a category's currency when creating it or via the category inspector.

### budgets table

No schema change. `assigned` continues to store minor units — but now they are minor units of **the category's native currency**. A USD category with `assigned = 150000` means $1,500.00. A CRC category with `assigned = 30000000` means ₡300,000.00.

### targets table

The `Target.Amount` field follows the same rule — stored in the category's native currency. No schema change needed if the target is always fetched alongside the category.

### transactions (cross-currency transfers)

No schema change. The existing `transfer_peer_id` link works as-is. The only behavioral change: when linking two transactions whose accounts have different currencies, skip the amount-equality check. Each side keeps its own amount in its own currency.

## RTA Calculation

```
CRC_RTA = SUM(CRC on-budget account balances)
        + SUM(USD on-budget account balances × current exchange rate)
        - SUM(all category available amounts, each converted to CRC)
```

The "current exchange rate" for the RTA display is today's rate (or nearest available).

USD category available amounts are converted to CRC using today's rate for this aggregation only — the stored values remain in USD.

## Category Available Calculation

For a given category and month:

```
activity_in_native = SUM(
    IF transaction.currency == category.currency:
        transaction.amount
    ELSE:
        transaction.amount × transaction.exchange_rate  -- converts to CRC
        (or divides, if category is USD and transaction is CRC)
)

available = carry_in + assigned + activity_in_native
```

Conversion direction:
- CRC transaction → USD category: `usd_amount = crc_amount / exchange_rate`
- USD transaction → CRC category: `crc_amount = usd_amount × exchange_rate`

Each transaction's own stamped `exchange_rate` is used, preserving historical accuracy.

## Budget API

`GET /api/budgets/:month` response adds `currency` per category and a split RTA breakdown:

```json
{
  "month": "2026-06",
  "ready_to_assign": 1234000,
  "rta_breakdown": {
    "crc_accounts": 750000,
    "usd_accounts_in_crc": 484000,
    "usd_accounts_native": 950
  },
  "category_groups": [
    {
      "categories": [
        {
          "id": "uuid",
          "name": "Rent",
          "currency": "USD",
          "assigned": 150000,
          "activity": -150000,
          "activity_breakdown": [
            { "currency": "USD", "amount": -150000 }
          ],
          "available": 0
        },
        {
          "id": "uuid",
          "name": "Trips",
          "currency": "CRC",
          "assigned": 30000000,
          "activity": -10100000,
          "activity_breakdown": [
            { "currency": "CRC", "amount": -5000000 },
            { "currency": "USD", "amount": -10000, "converted_amount": -5100000 }
          ],
          "available": 19900000
        }
      ]
    }
  ]
}
```

`PUT /api/budgets/:month/categories/:categoryId` is unchanged — `assigned` is already just an int64. The client sends the value in the category's native currency minor units.

## UI

### RTA Card

```
Ready to Assign   ₡1,234,000
  ├ CRC accounts  ₡750,000
  └ USD accounts  $950 (≈ ₡484,000)
```

Single RTA number in CRC. Breakdown rows are secondary/collapsible.

### Category Row

Columns: Category · Assigned · Activity · Available

- **Assigned cell**: shows amount in native currency. A small currency badge (`$` or `₡`) appears inline. When the global toggle is switched to USD, a CRC-native category shows the converted USD equivalent but the `₡` badge remains, indicating the value will fluctuate.
- **Activity cell**: shows total in native currency. On hover/expand, shows per-currency breakdown (e.g., `₡50,000 + $100`).
- **Available pill**: always in the category's native currency.

### Category Inspector

Shows native currency for assigned/target. When the global toggle is on the non-native currency, a note explains the displayed value is a conversion.

### Category Creation / Edit

A currency picker (`CRC` / `USD`) appears when creating a new category or in the category inspector. Changing currency on an existing category resets all `assigned` values in the budgets table for that category to 0 — the old minor units cannot be reinterpreted in the new currency. The user must re-enter their assignments. Historical transactions are not affected; they keep their own currency and are converted to the new category currency going forward. A confirmation dialog explains this before proceeding.

### Move Money Modal

Move money is only allowed between categories of the same currency. Attempting to move between currencies shows an error: "To move money between currencies, use a currency exchange transaction."

## Cross-Currency Transfers

### Exchange House (e.g., SINPE/DTR transactions)

The user manually links two imported transactions:
- CRC account: outflow with payee `DTR:ARI-DEBITO_EN_TIEMPO_REAL`
- USD account: inflow with payee `SINPE-PIN DE: Bernardo_Bonilla`

Both transactions have no budget category (they are transfers). The link is established via the existing link-or-create UI. Since the accounts have different currencies, amount validation is skipped.

### Direct Bank Transfers

Same mechanism. Two imported transactions are linked manually. Amounts differ because the bank applies its own rate. No validation.

### Effect on RTA

When a CRC outflow is linked to a USD inflow:
- CRC account balance drops → CRC portion of RTA drops
- USD account balance rises → USD portion of RTA rises

No additional accounting entries needed — account balance changes propagate automatically into the RTA formula.

## Edge Cases

1. **USD transaction categorized to a CRC category** — converted using the transaction's stamped exchange rate. Available drops by the CRC equivalent. This is correct and expected (e.g., Airbnb charge on trips budget).
2. **Category currency changed after history exists** — all `assigned` rows for that category are reset to 0; cannot be reinterpreted. User re-enters assignments. Historical transactions keep their own currency and are converted to the new category currency going forward.
3. **No exchange rate available for a transaction date** — use nearest available rate (existing fallback behavior). Flag in the activity breakdown.
4. **Move money between different-currency categories** — blocked in the UI. Requires a real currency exchange transaction.
5. **Target on a USD category** — target amount stored in USD minor units. Underfunded calculation is in USD.
