# AGENTS.md — budgetapp Project Conventions

This file is the authoritative guide for any AI agent (Claude Code or otherwise) working on this codebase. Read it before writing a single line of code.

---

## Project Context

A self-hosted personal finance tracker for a single user in Costa Rica. Key differentiators: CSV import from CR banks, automatic payee-based categorization, dual CRC/USD view with historically accurate exchange rates, Monarch-style spending plan (expected income, planned amounts per category, left-to-budget, opt-in rollover, flex budgeting), and a Cash Flow page.

**Tech stack:** React + TypeScript (Vite), Go (net/http + Chi), PostgreSQL 16, Podman Compose.

**The PRDs in `docs/prd/` are the source of truth for all design decisions.** Before implementing any feature, read the relevant PRD. Do not invent architecture that contradicts the PRDs without flagging it explicitly.

---

## General Coding Principles

### Read Before Write
Always read a file before editing it. Understand existing patterns before adding new code. Extend what's there; don't introduce a second way to do the same thing.

### Minimal Footprint
- Build only what the current task requires. No speculative features.
- No helper utilities for one-off operations. No abstractions until the third repetition.
- No docstrings, comments, or type annotations on code you didn't touch.

### Money Is Always BIGINT Centimos
All monetary values in the database and Go layer are `int64` in minor units (centimos/cents). `₡25,000.00 CRC = 2500000`. `$15.50 USD = 1550`. Conversion to display strings happens only in the frontend `MoneyDisplay` component or Go formatting helpers. Never use `float64` for money anywhere.

### No Floating Point in Business Logic
Use `int64` arithmetic for all money math. When exchange rate conversions are needed, use `decimal` arithmetic (Go: `github.com/shopspring/decimal`; round only at display boundaries).

---

## Go (Backend) Conventions

### Project Layout
Follow the structure in PRD 08:
```
server/
  internal/
    config/       — env var loading
    database/     — db pool + migration runner
    handler/      — HTTP handlers (thin: parse request, call service, write response)
    model/        — structs only, no logic
    repository/   — all SQL queries live here
    service/      — business logic
    csvparser/    — Bank CSV parser package
```

**Handlers are thin.** They do three things: parse the request, call a service function, write the response. No SQL in handlers. No business logic in handlers.

**Repositories own all SQL.** Every `SELECT`, `INSERT`, `UPDATE`, `DELETE` lives in a repository file. Repositories take a `context.Context` and a `*pgxpool.Pool` (or `pgx.Tx` for transactions). No raw SQL outside `internal/repository/`.

### Error Handling
- Return `error` from every function that can fail. No panics except for truly unrecoverable startup errors.
- Wrap errors with context: `fmt.Errorf("account repo: get by id: %w", err)`.
- At the handler boundary, map domain errors to HTTP status codes. Use a central `writeError(w, err)` helper.
- Never swallow errors silently.

### HTTP Router
Use `github.com/go-chi/chi/v5`. Register all routes in `main.go` (or a `routes.go` file). Keep route registration flat and readable.

### Database
- Use `github.com/jackc/pgx/v5` with `pgxpool`.
- Use named parameters (`@param_name`) not positional (`$1`) for clarity in complex queries.
- All UUIDs are `pgtype.UUID` in Go, `uuid` in Postgres. Use `gen_random_uuid()` as default.
- All timestamps are `TIMESTAMPTZ` in Postgres, `time.Time` in Go.
- Use `pgx.BeginTx` for multi-statement operations that must be atomic (e.g., import confirm).

### Migrations
SQL files in `internal/database/migrations/`. Named `001_`, `002_`, etc. Run on startup by the migration runner. Each migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Never edit a migration that has already run — add a new one.

### Configuration
Read all config from environment variables in `internal/config/config.go`. Use a `Config` struct. Validate required vars at startup and fail fast with a clear error message.

### Context
Pass `context.Context` as the first argument to every function that does I/O. Use `r.Context()` from the HTTP request in handlers.

### Logging
Use `log/slog` (stdlib). Log at `INFO` for significant events, `DEBUG` for request/response details, `ERROR` for failures. Include structured fields: `slog.String("account_id", id)`.

---

## PostgreSQL Conventions

### Naming
- Tables: `snake_case`, plural (`transactions`, `category_groups`)
- Columns: `snake_case`
- Indexes: `idx_{table}_{columns}` (e.g., `idx_transactions_account_date`)
- Foreign keys: `{table}_{column}_fkey` (auto-named by Postgres)

### IDs
Always UUID, always `DEFAULT gen_random_uuid()`. Never use serial/integer IDs.

### Constraints
Declare all constraints in the schema:
- `NOT NULL` where the value is always required
- `CHECK` constraints for enums (e.g., `CHECK (type IN ('checking','savings','credit_card','cash','other'))`)
- `UNIQUE` constraints at the database level, not just application level

### Queries
- Use `RETURNING *` on `INSERT` and `UPDATE` to avoid a second round trip.
- Index every foreign key column.
- Index columns used in `WHERE` clauses in hot paths (e.g., `transactions.date`, `transactions.payee`).

---

## React / TypeScript (Frontend) Conventions

### Component Structure
```
src/
  api/           — one file per resource (accounts.ts, transactions.ts, etc.)
  components/    — reusable UI primitives (MoneyDisplay, CategoryPicker, etc.)
  pages/         — route-level components (one per route)
  hooks/         — custom hooks wrapping TanStack Query calls
  context/       — CurrencyContext, etc.
  types/         — shared TypeScript interfaces matching Go model structs
  utils/         — pure functions (formatMoney, normalizePayee, etc.)
```

### API Layer
Each resource gets its own file in `src/api/`. Functions return plain data (typed with interfaces from `src/types/`). TanStack Query hooks in `src/hooks/` wrap these functions — components never call fetch directly.

```ts
// src/api/accounts.ts
export async function getAccounts(): Promise<Account[]> { ... }

// src/hooks/useAccounts.ts
export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: getAccounts });
}
```

### Currency Context
**All money display goes through `<MoneyDisplay>`**. Never format currency inline in JSX. The `CurrencyContext` provides the current display currency and a `format(amountMinorUnits, exchangeRate?)` function.

```tsx
// Correct
<MoneyDisplay amount={transaction.amount} exchangeRate={transaction.exchange_rate} />

// Wrong
<span>{transaction.amount / 100}</span>
```

### TypeScript
- `strict: true` in tsconfig. No `any`. Use `unknown` and narrow it.
- All API response shapes are typed in `src/types/`. Keep them in sync with Go models.
- Amounts in TypeScript are `number` (JavaScript integers, BIGINT from API comes as string for values > 2^53 — handle with care or use `BigInt`).

### State Management
- **Server state**: TanStack Query. Mutations use `useMutation` + `queryClient.invalidateQueries` to keep the cache fresh.
- **UI state**: `useState` or `useReducer` local to the component.
- **Global UI state** (currency toggle, sidebar): React Context.
- No Redux. No Zustand. No global stores beyond Context.

### Styling
Tailwind CSS only. No inline styles. No CSS modules. No styled-components.
Use Tailwind's color palette consistently with the design in PRD 10:
- Inflow/positive: `text-green-500`
- Outflow/negative: `text-red-500`
- Overspent: `bg-red-50 text-red-700`
- Primary action: `bg-blue-600`

### Forms
Use controlled components with `useState`. No form library for v1 (forms are simple enough). Validate at submit time; show errors inline below the field.

---

## CSV Parser Conventions

The bank CSV parser lives in `server/internal/csvparser/parser.go` and is a pure function with no side effects.

- Input: `io.Reader`
- Output: `*ImportData, error` (account header metadata + `[]Transaction`)
- It must handle the Costa Rican date format `DD/MM/YYYY` — this is the primary format, not `MM/DD/YYYY`.
- The CSV has three sections: account header, transaction detail, and summary footer. Only the first two are parsed; stop at the summary.
- Amount parsing: separate debit/credit columns with period decimal separator. Debit = outflow (negative), Credit = inflow (positive). Convert to `int64` minor units.
- Encoding: detect and handle Latin-1 (common in CR bank exports). Convert to UTF-8 internally.
- The parser returns raw data; normalization and categorization happen in the service layer.
- Unit test with `ejemplo_usd.csv` and `ejemplo_crc.qif` (once CRC CSV sample is available) in the repo root.

---

## Exchange Rate Conventions

- Store one rate per calendar day in the `exchange_rates` table.
- Canonical unit: `usd_to_crc` as `NUMERIC(12,4)` — how many CRC per 1 USD.
- Fetch from BCCR (SOAP, sell rate / tipo de cambio venta) first. Fall back to exchangerate.host (REST).
- Weekends/holidays: use the most recent available rate.
- When a transaction's exchange rate is missing, look it up by date. If not in DB, fetch it.
- Store `NULL` exchange rate on CRC transactions that have no USD component.

---

## Podman Conventions

- `podman compose up -d` must start the full stack from a clean clone with no extra steps.
- The Go server runs database migrations on startup before accepting requests.
- Use `depends_on: condition: service_healthy` so the server waits for Postgres.
- Environment variables are set in `docker-compose.yml` for development. Never commit secrets — use `.env` file (git-ignored) for any sensitive values.
- Volumes: `pgdata` is named and persists between restarts. `podman compose down -v` destroys it (intentional — documented in README).

---

## File & Commit Discipline

- Never commit bank export file contents (`.csv`, `.qif`, `.txt`) to the repo (treat them as personal financial data). The sample files at the root are for development testing only.
- No `.env` files with real values committed.
- Keep migrations append-only. Never modify a migration after it has been applied.

---

## What to Do When Uncertain

1. **Read the relevant PRD first.** The answer is usually there.
2. If the PRD is silent, apply the conventions in this file.
3. If still uncertain, ask before building — a wrong architecture is harder to fix than a delayed question.

---

## Phase Awareness

Check `docs/prd/11-implementation-roadmap.md` for project history and the current phase. Note that Phase 3 (zero-based budgeting) was superseded by Phase 6 (spending plan) — never reintroduce Ready to Assign, targets, or move-money.

Current phase: **Phases 1–6 complete — maintenance & incremental features on the spending-plan model**
