# PRD 06: Accounts & Dashboard

## Overview
Accounts represent bank accounts, credit cards, and cash wallets. The dashboard provides a high-level financial overview.

## Account Types

| Type | Description | Example |
|------|-------------|---------|
| `checking` | Bank checking/savings | BAC Cuenta Corriente |
| `savings` | Savings account | BCR Ahorro |
| `credit_card` | Credit card | BAC Visa |
| `cash` | Physical cash | Efectivo |
| `other` | Anything else | Investment account |

## On-Budget vs. Off-Budget

- **On-Budget** — Included in budget calculations. Typical: checking, cash, credit cards. These are the accounts where daily spending happens.
- **Off-Budget** — Tracking only. Typical: investment accounts, mortgages, long-term savings. Transactions in these accounts don't affect budget categories.

## Account Management

### Account List (Sidebar)
```
┌─────────────────────────┐
│  BUDGET ACCOUNTS        │
│  ┌─────────────────────┐│
│  │ BAC Checking  ₡1.2M ││
│  │ Cash          ₡45K  ││
│  │ BAC Visa     -₡120K ││
│  └─────────────────────┘│
│  Net: ₡1,125,000        │
│                          │
│  TRACKING ACCOUNTS       │
│  ┌─────────────────────┐│
│  │ Investments   $5.2K ││
│  └─────────────────────┘│
│                          │
│  [+ Add Account]         │
└─────────────────────────┘
```

### Create Account
```json
{
  "name": "BAC Checking",
  "type": "checking",
  "currency": "CRC",
  "on_budget": true,
  "balance": 1200000  // Starting balance in minor units
}
```

When creating an account with a starting balance, an automatic "Starting Balance" transaction is created.

### Edit Account
- Rename
- Change type
- Toggle on-budget/off-budget (with warning about budget impact)
- Close account (soft delete — hidden from sidebar, balance preserved)
- Reopen closed account

### Delete Account
Hard delete with confirmation. All transactions in the account are also deleted. This is destructive and irreversible.

## Transaction Register (Accounts page)

Clicking an account in the sidebar opens the Accounts page for that account.

### Account Header
- Account name + type badge (Budget Account / Tracking Account)
- Working balance (large monospaced, red if negative)
- Reconcile button (opens Reconcile modal)
- Rules button (opens Payee Rules manager)

### Upcoming Scheduled Transactions Panel
If the selected account has scheduled transactions due, a panel appears above the register with:
- Amber-dot indicator + "Upcoming · N scheduled"
- Per-transaction: next date, payee, frequency chip, amount, Enter / Skip buttons
- Enter: creates an actual transaction and dismisses from the panel
- Skip: dismisses without creating a transaction

### Stats Strip
Three quick stats computed from the current filter: transaction count · total outflow · total inflow

### Filter Bar
- Payee text search
- Category dropdown (all categories option)
- From / To date pickers
- Clear button (appears when any filter is active)
- Bulk delete button (appears when rows are selected)

### Transaction Table

Columns: ☐ · Date · Payee · Category · Memo · Outflow · Inflow · C · ⑂

- All columns sortable by clicking header
- Click a row to expand inline editing
- Cleared column (C): glowing green dot = cleared; hollow ring = uncleared; click to toggle
- Split chip: shows "⑂ Split · N" with a tooltip listing splits; categories shown in group color chips
- Inline edit mode: all fields become inputs; Save / Cancel buttons appear

### Reconcile Modal
1. Shows cleared balance and asks if it matches the bank
2. If no: enter actual balance; calculates diff; creates adjustment transaction and marks all cleared

### Payee Rules Manager
Lists current payee → category auto-assign rules. Add new rule (match text → category) or delete existing.

### Split Modal
Divide a transaction's outflow across multiple categories. A "Remaining to allocate" counter helps balance the split.

## Dashboard

The dashboard is the landing page. It shows a high-level financial summary.

### Stat Cards (top row, 3 columns)

| Card | Content |
|------|---------|
| Net Worth | Total value (on-budget + tracking), sparkline, month-over-month delta |
| Spent · April | Total outflows for current month, sparkline, date range label |
| Ready to Assign | Unallocated amount, subtitle |

Net Worth card has an accent-gradient background and glowing value color.

### Spending by Category Panel (left, 2-col layout)
- One progress bar per category group
- Bar color = group color, turns amber >88% spent, red when overspent
- "spent / assigned" amounts on the right, spent amount turns red when overspent

### Budget Alerts Panel (right)
- Badge with overspent count
- List of overspent categories with "!" icon and overspent amount
- "Everything on track" empty state with checkmark when none
- "Review budget →" CTA at the bottom

### Recent Transactions Table
Last 7 transactions. Columns: Date · Payee · Category · Amount. "View all →" link navigates to that account.

## API Endpoints

### Accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/accounts | List all accounts |
| POST | /api/accounts | Create account |
| GET | /api/accounts/:id | Get account details |
| PUT | /api/accounts/:id | Update account |
| DELETE | /api/accounts/:id | Delete account |
| PATCH | /api/accounts/:id/close | Close/reopen account |
| PATCH | /api/accounts/:id/reorder | Update sort order |

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/dashboard | Get dashboard summary data |

**GET /api/dashboard response:**
```json
{
  "net_worth": {
    "current": 112500000,
    "previous_month": 110000000,
    "change_pct": 2.27
  },
  "monthly_spending": {
    "month": "2026-04",
    "total_outflow": -48500000,
    "total_inflow": 96800000
  },
  "ready_to_assign": 14500000,
  "spending_by_category": [
    { "category": "Clothing", "amount": -21512600, "pct": 44.3 },
    { "category": "Food & Drink", "amount": -8735200, "pct": 18.0 }
  ],
  "recent_transactions": [],
  "budget_alerts": [
    {
      "category": "Clothing",
      "assigned": 10000000,
      "available": -11512600,
      "severity": "overspent"
    }
  ]
}
```
