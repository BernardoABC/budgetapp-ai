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
| PUT | /api/categories/:id | Update a category |
| DELETE | /api/categories/:id | Delete (only if no transactions reference it) |
| GET | /api/category-groups | List category groups |
| POST | /api/category-groups | Create category group |
| PUT | /api/category-groups/:id | Update category group |
| DELETE | /api/category-groups/:id | Delete group (only if empty) |

### Payee Rules
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/payee-rules | List all payee rules |
| PUT | /api/payee-rules/:id | Update a rule's category |
| DELETE | /api/payee-rules/:id | Delete a rule |

### Budgets
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/budgets/:month | Get budget for a month (YYYY-MM) |
| PUT | /api/budgets/:month/categories/:id | Set assigned amount |
| POST | /api/budgets/:month/copy-previous | Copy from previous month |
| POST | /api/budgets/:month/move | Move money between categories |

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
| GET | /api/reports/spending-by-category | Spending breakdown |
| GET | /api/reports/spending-trend | Monthly spending trend |
| GET | /api/reports/income-vs-expense | Income vs expense |
| GET | /api/reports/payee-spending | Spending by payee |
| GET | /api/reports/net-worth | Net worth over time |

## Go Project Structure

```
server/
├── main.go                    # Entry point, server setup
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
│   │       └── 002_seed_categories.sql
│   ├── handler/
│   │   ├── accounts.go
│   │   ├── transactions.go
│   │   ├── categories.go
│   │   ├── budgets.go
│   │   ├── imports.go
│   │   ├── exchange_rates.go
│   │   ├── dashboard.go
│   │   ├── reports.go
│   │   └── payee_rules.go
│   ├── model/
│   │   ├── account.go
│   │   ├── transaction.go
│   │   ├── category.go
│   │   ├── budget.go
│   │   ├── import.go
│   │   ├── exchange_rate.go
│   │   └── payee_rule.go
│   ├── repository/
│   │   ├── account_repo.go
│   │   ├── transaction_repo.go
│   │   ├── category_repo.go
│   │   ├── budget_repo.go
│   │   ├── import_repo.go
│   │   ├── exchange_rate_repo.go
│   │   └── payee_rule_repo.go
│   ├── service/
│   │   ├── budget_service.go  # Budget calculation logic
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
