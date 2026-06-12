# PRD 01: Data Model & Database Design

## Overview
The database schema is the foundation of the entire application. It must support multi-currency transactions, the monthly spending plan (see PRD 04), and payee-based auto-categorization — all while remaining simple enough for a single-user personal finance app.

## Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────────┐       ┌──────────────┐
│   accounts   │       │     transactions     │       │  categories  │
├──────────────┤       ├──────────────────────┤       ├──────────────┤
│ id (PK)      │──1:N──│ id (PK)              │──N:1──│ id (PK)      │
│ name         │       │ account_id (FK)      │       │ name         │
│ currency     │       │ category_id (FK)     │       │ group_id(FK) │
│ balance      │       │ date                 │       │ currency     │
│ type         │       │ amount               │       │ hidden       │
│ closed       │       │ currency             │       │ is_system    │
│ on_budget    │       │ payee                │       │ rollover     │
│ note         │       │ memo                 │       │ flexibility  │
│ sort_order   │       │ check_number         │       └──────┬───────┘
│ created_at   │       │ exchange_rate        │              │ N:1
│ updated_at   │       │ cleared              │       ┌──────▼───────┐
└──────────────┘       │ reconciled           │       │cat_groups    │
                       │ transfer_peer_id(FK) │──┐    ├──────────────┤
                       │ import_id (FK)       │  │    │ id (PK)      │
                       │ created_at           │  │self│ name         │
                       │ updated_at           │◄─┘    │ sort_order   │
                       └──────────────────────┘       │ hidden       │
                                │ 1:N                 │ is_system    │
                                │                     └──────────────┘
                       ┌────────▼─────────────┐
                       │  transaction_splits  │
                       ├──────────────────────┤
                       │ id (PK)              │
                       │ transaction_id (FK)  │
                       │ category_id (FK)     │
                       │ amount               │
                       │ created_at           │
                       └──────────────────────┘

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

┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  budgets         │       │  imports         │       │  monthly_plans   │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │       │ month (PK)       │
│ category_id (FK) │       │ account_id (FK)  │       │ expected_income  │
│ month (YYYY-MM)  │       │ filename         │       │ flex_budget      │
│ assigned         │       │ imported_at      │       │ created_at       │
│ created_at       │       │ transaction_count│       │ updated_at       │
│ updated_at       │       │ status           │       └──────────────────┘
└──────────────────┘       └──────────────────┘       ┌──────────────────┐
                                                      │  app_settings    │
                                                      ├──────────────────┤
                                                      │ key (PK)         │
                                                      │ value            │
                                                      │ updated_at       │
                                                      └──────────────────┘
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
| reconciled | BOOLEAN | NOT NULL, DEFAULT false | Locked after account reconciliation |
| transfer_peer_id | UUID | FK → transactions(id) ON DELETE SET NULL, NULLABLE | Links the two legs of an account-to-account transfer |
| import_id | UUID | FK → imports, NULLABLE | Which import batch brought this in (NULL if manual entry) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Transfer semantics:** When a user transfers money between two accounts, two transaction rows are created atomically — one outflow (negative amount) on the source account, one inflow (positive amount) on the destination account. Each row's `transfer_peer_id` points at the other. Deleting one leg deletes both; editing the amount on one mirrors the sign-flipped amount to the peer.

**Indexes:**
- `idx_transactions_account_date` on (account_id, date DESC)
- `idx_transactions_category` on (category_id)
- `idx_transactions_payee` on (payee) — for auto-categorization lookups
- `idx_transactions_import` on (import_id)
- `idx_transactions_transfer_peer` on (transfer_peer_id) WHERE transfer_peer_id IS NOT NULL

### categories
Individual spending categories (e.g., "Groceries", "Restaurants", "Transportation").

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| group_id | UUID | FK → category_groups, NOT NULL | Parent group |
| name | VARCHAR(255) | NOT NULL | Category name |
| currency | VARCHAR(3) | NOT NULL, DEFAULT 'CRC' | Native currency for planned amounts and activity (`CRC` or `USD`) |
| hidden | BOOLEAN | NOT NULL, DEFAULT false | Hidden from active views |
| is_system | BOOLEAN | NOT NULL, DEFAULT false | System categories (e.g., "Income") are excluded from the plan table |
| rollover | BOOLEAN | NOT NULL, DEFAULT false | Opt-in: unspent/overspent balance accumulates across months (negative carry allowed) |
| flexibility | VARCHAR(20) | NOT NULL, DEFAULT 'flexible', CHECK | `fixed`, `flexible`, or `non_monthly` — drives the flex-budgeting view |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | Ordering within group |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Unique constraint:** (group_id, name)

**Note:** non-monthly categories accumulate a balance in the flex view regardless of the `rollover` flag; the flag governs accumulation in category mode.

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
Monthly **planned amounts** per category (the spending plan). One row per category per month. The column is named `assigned` for historical reasons; the API and UI call it *planned/budgeted*.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| category_id | UUID | FK → categories, NOT NULL | |
| month | DATE | NOT NULL | First day of the month (e.g., 2026-04-01) |
| assigned | BIGINT | NOT NULL, DEFAULT 0 | Planned amount for this category this month (minor units, in the **category's native currency**) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Unique constraint:** (category_id, month)

**Plan calculations** (computed, not stored — see PRD 04):
- **Activity** = SUM of transaction amounts for this category in this month (converted to the category's native currency)
- **Remaining** = planned + activity, month-scoped
- **Rollover balance** = Σ(planned + activity) across all months, for rollover and non-monthly categories; negative balances carry as-is
- **Left to budget** = `monthly_plans.expected_income` − Σ planned (USD categories converted to CRC at the current rate)

### transaction_splits
Breaks a single transaction into multiple category buckets. When splits are present, the parent transaction's `category_id` is ignored for budgeting purposes; the splits are used instead. All split amounts must sum to the parent transaction's amount.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| transaction_id | UUID | FK → transactions, NOT NULL, ON DELETE CASCADE | Parent transaction |
| category_id | UUID | FK → categories, NULLABLE | Category for this portion |
| amount | BIGINT | NOT NULL | Signed minor units (same sign convention as transactions.amount) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

**Index:** `idx_splits_transaction` on (transaction_id)

### monthly_plans
One row per month: the expected income and the flex-mode budget number. Missing row = zero values (not an error).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| month | DATE | PK | First day of the month |
| expected_income | BIGINT | NOT NULL, DEFAULT 0 | Expected income for the month, CRC centimos |
| flex_budget | BIGINT | NOT NULL, DEFAULT 0 | Flex-mode budget for all flexible categories combined, CRC centimos |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

### app_settings
Small key-value store for global app settings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| key | TEXT | PK | e.g., `budget_mode` |
| value | TEXT | NOT NULL | e.g., `category` or `flex` |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | |

> The former `category_targets` table (YNAB-style targets) was dropped in migration 010 — the planned amount per category *is* the plan.

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
- Migrations are managed as numbered SQL files in `server/internal/database/migrations/`
- Applied via a Go migration runner on server startup (`migrations.Run`); tracks applied files in `schema_migrations` table
- All migrations are idempotent (use `IF NOT EXISTS` etc.)

| File | Contents |
|------|----------|
| `001_initial_schema.sql` | All core tables (accounts, transactions, categories, payee_rules, exchange_rates, budgets, imports) |
| `002_seed_categories.sql` | Default category groups and categories for Costa Rica |
| `003_category_targets.sql` | `category_targets` table (dropped again in 010) |
| `004_splits_reconcile.sql` | `transaction_splits` table; `reconciled` column on transactions |
| `005_transfers.sql` | `transfer_peer_id` self-referential FK on transactions |
| `006_reseed_categories.sql` | Category reseed |
| `007_rename_yelp_to_alquiler.sql` | Category rename |
| `008_inflow_category.sql` | `is_system` flags; system Inflows group + inflow category |
| `009_category_currency.sql` | `categories.currency` column |
| `010_spending_plan.sql` | `categories.rollover`/`flexibility`; `monthly_plans` + `app_settings` tables; wipes `budgets`, drops `category_targets`, renames system category to "Income" |

## Seed Data
The initial migration should seed default category groups and categories relevant to Costa Rica:

**Immediate Obligations:** Rent/Mortgage, Electricity (ICE), Water (AyA), Internet, Phone, Insurance (INS)
**Food & Drink:** Groceries, Restaurants, Coffee Shops, Fast Food
**Transportation:** Gas, Parking, Tolls (GLOBALVIA), Public Transit, Uber/DiDi
**Personal:** Clothing, Personal Care, Medical/Pharmacy
**Entertainment:** Subscriptions, Entertainment, Hobbies
**Savings Goals:** Emergency Fund, Travel, Investments
**Debt Payments:** Credit Card Payment, Loans
