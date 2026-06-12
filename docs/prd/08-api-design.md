# PRD 08: API Design

## Overview
RESTful JSON API built in Go. Single-user, no authentication for v1 (localhost access only). All monetary amounts are in minor units (centimos/cents) as BIGINT.

## Conventions

| Convention | Value |
|-----------|-------|
| Base path | `/api` |
| Content type | `application/json` |
| Date format | `YYYY-MM-DD` (ISO 8601) |
| Month format | `YYYY-MM` |
| Money | BIGINT (minor units) — ₡25,000.00 = `2500000` |
| IDs | UUID v4 |

Note: Responses include the resource's `currency` field so the client can format; the API never sends pre-divided major units.
| Pagination | `?page=1&per_page=50` |
| Sorting | `?sort=field_asc` or `?sort=field_desc` |
| Errors | `{ "error": { "code": "NOT_FOUND", "message": "..." } }` |

## Error Responses

```json
// 400 Bad Request
{ "error": { "code": "VALIDATION_ERROR", "message": "Amount is required", "field": "amount" } }

// 404 Not Found
{ "error": { "code": "NOT_FOUND", "message": "Transaction not found" } }

// 500 Internal Server Error
{ "error": { "code": "INTERNAL_ERROR", "message": "An unexpected error occurred" } }
```

## Complete Endpoint Reference

### Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/accounts | List all accounts (ordered by sort_order) |
| POST | /api/accounts | Create a new account |
| GET | /api/accounts/:id | Get account by ID |
| PUT | /api/accounts/:id | Update account |
| DELETE | /api/accounts/:id | Delete account and all its transactions |
| PATCH | /api/accounts/:id/close | Toggle closed status |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/accounts/:id/transactions | List transactions for an account |
| POST | /api/accounts/:id/transactions | Create transaction in an account |
| GET | /api/transactions/:id | Get transaction by ID |
| PUT | /api/transactions/:id | Update transaction |
| DELETE | /api/transactions/:id | Delete transaction |
| PATCH | /api/transactions/batch | Batch update (categorize, clear, delete) |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/category-groups | List category groups (each with nested categories) |
| POST | /api/categories | Create a category |
| PUT | /api/categories/:id | Update a category (accepts `rollover`, `flexibility`) |
| PUT | /api/categories/:id/currency | Change category currency (clears planned rows) |
| DELETE | /api/categories/:id | Delete (only if no transactions reference it) |
| POST | /api/category-groups | Create category group |
| PUT | /api/category-groups/:id | Update category group |
| DELETE | /api/category-groups/:id | Delete group (only if empty) |

### Payee Rules
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/payee-rules | List all payee rules |
| PUT | /api/payee-rules/:id | Update a rule's category |
| DELETE | /api/payee-rules/:id | Delete a rule |

### Spending Plan
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/plan/:month | Get spending plan for a month (YYYY-MM) |
| PUT | /api/plan/:month/categories/:categoryId | Set planned amount; body `{"planned": <bigint>}` |
| POST | /api/plan/:month/copy-previous | Copy planned amounts from previous month |
| PUT | /api/plan/:month/income | Set expected income; body `{"amount": <bigint>}` |
| PUT | /api/plan/:month/flex-budget | Set flex budget; body `{"amount": <bigint>}` |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/settings/budget-mode | Get current mode (`category` or `flex`) |
| PUT | /api/settings/budget-mode | Set mode; body `{"mode": "category"\|"flex"}` |

### Import
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/imports/preview | Upload CSV and get preview |
| POST | /api/imports/confirm | Confirm and commit import |
| GET | /api/imports | List import history |

`POST /api/imports/confirm` is stateless — the client re-sends the reviewed transactions; the server does not persist preview state between requests.

### Exchange Rates
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/exchange-rates | List rates for date range |
| GET | /api/exchange-rates/current | Get today's rate |
| PUT | /api/exchange-rates/:date | Set/override rate for a date |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/dashboard | Get dashboard summary |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports/spending | Spending breakdown by category group |
| GET | /api/reports/income-expense | Income vs expense per month |
| GET | /api/reports/savings | Savings rate series; params `from`, `to` (YYYY-MM) |
| GET | /api/reports/net-worth | Net worth over time |

## Go Project Structure

```
server/
├── main.go                    # Entry point, route registration
├── go.mod
├── go.sum
├── internal/
│   ├── config/
│   │   └── config.go          # Environment config
│   ├── database/
│   │   ├── db.go              # Connection pool
│   │   └── migrations/
│   │       ├── runner.go      # Migration runner
│   │       ├── 001_initial_schema.sql
│   │       ├── ...
│   │       └── 010_spending_plan.sql
│   ├── handler/
│   │   ├── accounts.go
│   │   ├── transactions.go
│   │   ├── categories.go
│   │   ├── budget.go          # Plan + category-currency handlers
│   │   ├── settings.go        # Budget-mode setting handler
│   │   ├── imports.go
│   │   ├── exchange_rates.go
│   │   ├── reports.go
│   │   └── payee_rules.go
│   ├── model/
│   │   ├── account.go
│   │   ├── transaction.go
│   │   ├── category.go
│   │   ├── budget.go          # PlanMonth, PlanCategory, PlanGroup
│   │   ├── import.go
│   │   ├── exchange_rate.go
│   │   └── payee_rule.go
│   ├── repository/
│   │   ├── account_repo.go
│   │   ├── transaction_repo.go
│   │   ├── category_repo.go
│   │   ├── budget_repo.go
│   │   ├── monthly_plan_repo.go
│   │   ├── settings_repo.go
│   │   ├── import_repo.go
│   │   ├── exchange_rate_repo.go
│   │   └── payee_rule_repo.go
│   ├── service/
│   │   ├── budget_service.go  # Spending plan calculation logic
│   │   ├── import_service.go  # CSV parsing + categorization
│   │   ├── exchange_service.go # Rate fetching
│   │   └── categorizer.go    # Payee matching engine
│   └── csvparser/
│       └── parser.go          # Bank CSV file parser
└── Dockerfile
```

## CORS
For development, allow all origins. In Podman production, the Go server serves the React build as static files, so CORS is not needed.

## Request/Response Examples

### Create Account
```http
POST /api/accounts
Content-Type: application/json

{
  "name": "BAC Checking",
  "type": "checking",
  "currency": "CRC",
  "on_budget": true,
  "balance": 120000000
}
```

```json
// 201 Created
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "BAC Checking",
  "type": "checking",
  "currency": "CRC",
  "on_budget": true,
  "balance": 120000000,
  "closed": false,
  "sort_order": 0,
  "created_at": "2026-04-14T10:00:00Z",
  "updated_at": "2026-04-14T10:00:00Z"
}
```

### Create Transaction
```http
POST /api/accounts/550e8400-.../transactions
Content-Type: application/json

{
  "date": "2026-04-14",
  "payee": "Automercado",
  "category_id": "uuid-groceries",
  "amount": -4500000,
  "memo": "Weekly groceries"
}
```
