# PRD 05: Transaction Management

## Overview
Transactions are the atomic unit of the app. Users need to view, search, filter, edit, and manually create transactions. The transaction list is the most frequently visited screen.

## Transaction Properties

| Field | Source | Editable | Description |
|-------|--------|----------|-------------|
| Date | CSV import / manual | Yes | Transaction date |
| Payee | CSV description / manual | Yes | Who the money went to/from |
| Category | Auto/manual | Yes | Budget category |
| Amount | CSV debit-credit / manual | Yes | Positive = inflow, negative = outflow |
| Account | CSV import target / manual | Yes (move) | Which account |
| Memo | Manual | Yes | User notes |
| Cleared | Manual | Yes | User confirmation toggle |
| Check # | CSV reference | Yes | Reference number |

## Transaction List View

### Layout
```
┌───────────────────────────────────────────────────────────────┐
│  BAC Checking                    Balance: ₡1,234,567          │
│  [Search...] [Filter ▼] [+ Add Transaction]                  │
├───────────────────────────────────────────────────────────────┤
│  ☐  DATE        PAYEE                CATEGORY     OUTFLOW    INFLOW  │
├───────────────────────────────────────────────────────────────┤
│  ☐  14 Apr      ZARA                 Clothing     ₡43,980           │
│  ☐  14 Apr      PULL Y BEAR          Clothing     ₡82,950           │
│  ☐  14 Apr      OLD NAVY             Clothing     ₡34,986           │
│  ☐  14 Apr      HYM CURRIDABAT       Clothing     ₡141,260          │
│  ☐  14 Apr      NIKE RISE            Clothing     ₡36,900           │
│  ☐  14 Apr      DELMONICOS STEAK     Restaurants  ₡19,050           │
│  ☐  14 Apr      SHOT SHOT            Restaurants  ₡10,500           │
│  ✓  13 Apr      MULTIMERCADO AM PM   Groceries    ₡17,400           │
│  ✓  13 Apr      NOVEX                Supplies     ₡15,065           │
│  ☐  13 Apr      TEATRO POPULAR       Entertainment ₡16,000          │
│  ☐  13 Apr      MINISUPER LA PERLA   Groceries    ₡3,350            │
│  ☐  12 Apr      BK PINARES           Fast Food    ₡5,050            │
│  ☐  11 Apr      TEF DE: 953435013    Transfer              ₡200,000 │
│  ...                                                                 │
├───────────────────────────────────────────────────────────────┤
│  Showing 50 of 332 transactions         Cleared: ₡245,000           │
│  [◀ Prev] [Next ▶]                     Uncleared: ₡989,567          │
└───────────────────────────────────────────────────────────────┘
```

### Features
- **Sorted by date** (newest first by default)
- **Split outflow/inflow columns** — Easier to scan than signed amounts
- **Inline editing** — Click any cell to edit it directly
- **Cleared toggle** — Click checkbox to mark as cleared
- **Bulk actions** — Select multiple transactions → categorize, delete, clear
- **Running balance** — Optional column showing cumulative balance
- **Pagination** — 50 transactions per page

### Filtering
Accessible via filter dropdown:

| Filter | Options |
|--------|---------|
| Date range | This month / Last month / Last 3 months / Custom range |
| Category | Any / Specific category / Uncategorized |
| Amount | Min / Max / Range |
| Payee | Text search |
| Cleared | All / Cleared only / Uncleared only |
| Type | All / Inflows only / Outflows only |

### Search
Full-text search across payee and memo fields. Searches are case-insensitive and support partial matches.

## Manual Transaction Entry

### Add Transaction Form
```
┌──────────────────────────────────────┐
│  New Transaction                     │
├──────────────────────────────────────┤
│  Account:   [BAC Checking     ▼]    │
│  Date:      [2026-04-14       📅]    │
│  Payee:     [_________________]      │
│  Category:  [Select category  ▼]    │
│  Memo:      [_________________]      │
│  Outflow:   [₡_______________ ]      │
│  Inflow:    [₡_______________ ]      │
│                                      │
│  [Cancel]              [Save]        │
└──────────────────────────────────────┘
```

- **Payee autocomplete** — As user types, suggest matching payees from history
- **Auto-categorize on payee selection** — When user selects a known payee, auto-fill category from payee_rules
- **Amount input** — Separate outflow/inflow fields. User fills one or the other.
- **Quick entry** — Keyboard-friendly: Tab through fields, Enter to save

## Transaction Editing

### Inline Edit
Click any cell in the transaction list to edit it. Changes save on blur or Enter.

### Batch Operations
Select multiple transactions via checkboxes, then:
- **Categorize** — Assign all selected to a category
- **Clear/Unclear** — Toggle cleared status
- **Delete** — Remove selected transactions (with confirmation)
- **Move** — Move to a different account

## API Endpoints

### GET /api/accounts/:id/transactions
List transactions for an account.

**Query params:**
- `page` (default: 1)
- `per_page` (default: 50, max: 200)
- `from_date`, `to_date`
- `category_id`
- `search` (payee/memo text search)
- `cleared` (true/false)
- `min_amount`, `max_amount`
- `sort` (date_asc, date_desc, amount_asc, amount_desc)

**Response:**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "date": "2026-04-14",
      "payee": "ZARA",
      "category": { "id": "uuid", "name": "Clothing" },
      "amount": -4398000,
      "currency": "CRC",
      "exchange_rate": 510.75,
      "memo": null,
      "cleared": false,
      "check_number": "41300000"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 332,
    "total_pages": 7
  },
  "summary": {
    "total_inflow": 96800000,
    "total_outflow": -107484931,
    "cleared_balance": 24500000,
    "uncleared_balance": 98956700
  }
}
```

### POST /api/accounts/:id/transactions
Create a new transaction.

### PUT /api/transactions/:id
Update a transaction. When category changes, update payee_rules.

### DELETE /api/transactions/:id
Delete a transaction. Recalculate account balance.

### PATCH /api/transactions/batch
Batch operations on multiple transactions.

```json
{
  "transaction_ids": ["uuid1", "uuid2"],
  "action": "categorize",
  "category_id": "uuid"
}
```

## Account Balance Updates

Account balances are recalculated when transactions change:
- **Import** — Add all imported transaction amounts to balance
- **Create** — Add transaction amount to balance
- **Update amount** — Adjust balance by difference (new - old)
- **Delete** — Subtract transaction amount from balance
- **Move to different account** — Subtract from old, add to new

This is done within a database transaction to ensure consistency.

## Performance Considerations

- Transaction list queries are the most frequent — ensure proper indexing on (account_id, date)
- Use cursor-based pagination for large datasets (>10k transactions)
- Precompute monthly summary aggregations if needed
- Search uses PostgreSQL `ILIKE` for v1; consider `pg_trgm` extension for fuzzy search if performance is an issue
