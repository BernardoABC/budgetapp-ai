# PRD 01: Data Model & Database Design

## Overview
The database schema is the foundation of the entire application. It must support multi-currency transactions, zero-based budgeting, and payee-based auto-categorization — all while remaining simple enough for a single-user personal finance app.

## Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│   accounts   │       │   transactions   │       │  categories  │
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (PK)      │──1:N──│ id (PK)          │──N:1──│ id (PK)      │
│ name         │       │ account_id (FK)  │       │ name         │
│ currency     │       │ category_id (FK) │       │ group_id(FK) │
│ balance      │       │ date             │       │ hidden       │
│ type         │       │ amount           │       └──────┬───────┘
│ closed       │       │ currency         │              │ N:1
│ on_budget    │       │ payee            │       ┌──────▼───────┐
│ note         │       │ memo             │       │cat_groups    │
│ sort_order   │       │ check_number     │       ├──────────────┤
│ created_at   │       │ exchange_rate    │       │ id (PK)      │
│ updated_at   │       │ cleared          │       │ name         │
└──────────────┘       │ import_id        │       │ sort_order   │
                       │ created_at       │       │ hidden       │
                       │ updated_at       │       └──────────────┘
                       └──────────────────┘
                       
┌──────────────────┐       ┌──────────────────┐
│  payee_rules     │       │  exchange_rates  │
├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │
│ payee_pattern    │       │ date             │
│ category_id (FK) │       │ usd_to_crc       │
│ match_count      │       │ source           │
│ last_used_at     │       │ created_at       │
│ created_at       │       └──────────────────┘
│ updated_at       │
└──────────────────┘

┌──────────────────┐       ┌──────────────────┐
│  budgets         │       │  imports         │
├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │
│ category_id (FK) │       │ account_id (FK)  │
│ month (YYYY-MM)  │       │ filename         │
│ assigned         │       │ imported_at      │
│ created_at       │       │ transaction_count│
│ updated_at       │       │ status           │
└──────────────────┘       └──────────────────┘
```

## Detailed Table Definitions

### accounts
Represents a bank account, credit card, or cash wallet.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Unique identifier |
| name | VARCHAR(255) | NOT NULL | Display name (e.g., "BAC Checking") |
| type | VARCHAR(50) | NOT NULL, CHECK | One of: `checking`, `savings`, `credit_card`, `cash`, `other` |
| currency | VARCHAR(3) | NOT NULL, DEFAULT 'CRC' | ISO 4217 code: `CRC` or `USD` |
| balance | BIGINT | NOT NULL, DEFAULT 0 | Current balance in minor units (centimos for CRC, cents for USD) |
| on_budget | BOOLEAN | NOT NULL, DEFAULT true | Whether this account is included in budget calculations |
| closed | BOOLEAN | NOT NULL, DEFAULT false | Soft-close: hidden from active views |
| note | TEXT | | Optional note |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | UI ordering |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Notes on balance storage:** All monetary amounts are stored as BIGINT in minor units (centimos/cents). CRC amounts are multiplied by 100 (e.g., 25,000.00 CRC = 2500000). USD amounts by 100 (e.g., $15.50 = 1550). This avoids floating-point precision issues entirely.

### transactions
The core table. Every financial event is a row here.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Unique identifier |
| account_id | UUID | FK → accounts, NOT NULL | Which account this belongs to |
| category_id | UUID | FK → categories, NULLABLE | Category assignment (NULL = uncategorized) |
| date | DATE | NOT NULL | Transaction date |
| amount | BIGINT | NOT NULL | Amount in minor units. Negative = outflow, positive = inflow |
| currency | VARCHAR(3) | NOT NULL | Currency of this specific transaction |
| payee | VARCHAR(500) | | Raw payee string from bank |
| memo | TEXT | | User-editable memo |
| check_number | VARCHAR(50) | | Reference number from bank CSV export |
| exchange_rate | NUMERIC(12,4) | | USD→CRC rate at time of transaction. NULL if same currency as account |
| cleared | BOOLEAN | NOT NULL, DEFAULT false | Whether user has confirmed this transaction |
| import_id | UUID | FK → imports, NULLABLE | Which import batch brought this in (NULL if manual entry) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Indexes:**
- `idx_transactions_account_date` on (account_id, date DESC)
- `idx_transactions_category` on (category_id)
- `idx_transactions_payee` on (payee) — for auto-categorization lookups
- `idx_transactions_import` on (import_id)

### categories
Individual budget categories (e.g., "Groceries", "Restaurants", "Transportation").

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| group_id | UUID | FK → category_groups, NOT NULL | Parent group |
| name | VARCHAR(255) | NOT NULL | Category name |
| hidden | BOOLEAN | NOT NULL, DEFAULT false | Hidden from active views |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | Ordering within group |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Unique constraint:** (group_id, name)

### category_groups
Logical groupings of categories (e.g., "Food & Drink", "Bills", "Fun Money").

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL, UNIQUE | Group name |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | |
| hidden | BOOLEAN | NOT NULL, DEFAULT false | |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

### payee_rules
The auto-categorization engine. When a payee string matches a known pattern, the system suggests or auto-assigns a category.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| payee_pattern | VARCHAR(500) | NOT NULL, UNIQUE | Normalized payee string to match against |
| category_id | UUID | FK → categories, NOT NULL | Category to assign when matched |
| match_count | INTEGER | NOT NULL, DEFAULT 1 | How many times this rule has been applied |
| last_used_at | TIMESTAMPTZ | | Last time this rule was triggered |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**How matching works:** Payee/description strings are normalized (trimmed, uppercased, extra whitespace collapsed) before comparison. A fuzzy/prefix match is used so "WALMART CURRIDABAT OCN00P" and "WALMART CURRIDABAT" map to the same rule. See PRD 02 for details.

### exchange_rates
Daily exchange rate snapshots for CRC↔USD conversion.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| date | DATE | NOT NULL, UNIQUE | The date this rate applies to |
| usd_to_crc | NUMERIC(12,4) | NOT NULL | How many CRC per 1 USD (e.g., 510.2500) |
| source | VARCHAR(100) | NOT NULL | Where this rate came from (e.g., "BCCR", "manual") |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

### budgets
Monthly budget allocations per category. One row per category per month.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| category_id | UUID | FK → categories, NOT NULL | |
| month | DATE | NOT NULL | First day of the month (e.g., 2026-04-01) |
| assigned | BIGINT | NOT NULL, DEFAULT 0 | Amount assigned to this category for this month (minor units, in CRC) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Unique constraint:** (category_id, month)

**Budget calculations** (computed, not stored):
- **Activity** = SUM of transaction amounts for this category in this month
- **Available** = assigned + activity + rollover from previous month (if implementing rollover)

### imports
Tracks CSV file import history for auditing and duplicate detection.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| account_id | UUID | FK → accounts, NOT NULL | Target account |
| filename | VARCHAR(500) | NOT NULL | Original filename |
| imported_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| transaction_count | INTEGER | NOT NULL | Number of transactions imported |
| status | VARCHAR(50) | NOT NULL, DEFAULT 'completed' | `pending`, `completed`, `failed` |

## Currency Strategy

Each account has its own `currency`. Every monetary value — `accounts.balance`
and `transactions.amount` — is stored in **minor units of that account's own
currency** (CRC centimos for a CRC account, USD cents for a USD account). This
keeps imported data 1:1 with the bank statement, with no conversion at import
and no accumulating rounding.

CRC is canonical **only at the aggregation layer** (net worth across accounts,
budget activity that pools accounts of different currencies). There, USD amounts
are converted to CRC using each transaction's stamped `exchange_rate`, as a
read-time computation — never written back to storage.

- A CRC transaction of −25,000.00 CRC is stored as `amount = -2500000` in a CRC account.
- A USD transaction of −$15.50 is stored as `amount = -1550` in a USD account.
- `transactions.exchange_rate` records the USD↔CRC rate for the transaction's
  date, enabling display in the other currency without re-deriving it.

## Migration Strategy
- Migrations are managed as numbered SQL files: `001_initial_schema.sql`, `002_seed_categories.sql`, etc.
- Applied via a simple Go migration runner on server startup
- All migrations are idempotent (use `IF NOT EXISTS` etc.)

## Seed Data
The initial migration should seed default category groups and categories relevant to Costa Rica:

**Immediate Obligations:** Rent/Mortgage, Electricity (ICE), Water (AyA), Internet, Phone, Insurance (INS)
**Food & Drink:** Groceries, Restaurants, Coffee Shops, Fast Food
**Transportation:** Gas, Parking, Tolls (GLOBALVIA), Public Transit, Uber/DiDi
**Personal:** Clothing, Personal Care, Medical/Pharmacy
**Entertainment:** Subscriptions, Entertainment, Hobbies
**Savings Goals:** Emergency Fund, Travel, Investments
**Debt Payments:** Credit Card Payment, Loans
