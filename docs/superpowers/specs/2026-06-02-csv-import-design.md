# Design: Backend Phase 2 — Money Model Reconciliation + BAC CSV Import

**Date:** 2026-06-02
**Status:** Approved (design phase)
**Supersedes/clarifies:** PRD 01 (data model), PRD 02 (import), PRD 03 (multi-currency), PRD 08 (API), PRD 11 (roadmap)

## Purpose

Two coupled goals:

1. **Reconcile the money model** across docs and the Phase 1 code so the whole
   system agrees on how multi-currency (CRC + USD) accounts are stored and
   exposed — *before* import code is built on top of it.
2. **Build BAC CSV import with auto-categorization** — the core differentiating
   feature of Phase 2 — on a clean, well-bounded backend architecture.

This spec also fixes documentation contradictions discovered during design and
establishes the layering, error-handling, and testing conventions the backend
will follow from here forward.

---

## Background: the contradiction this resolves

The user has **real CRC-denominated and USD-denominated accounts** and imports
bank statements for both. The existing docs contradict themselves on how to
store money:

- PRD 03 Principle 1 and PRD 01's *Currency Strategy* prose say **"store
  everything in CRC centimos as the canonical source of truth."**
- PRD 01's actual **table definitions** say the opposite: `accounts.balance` is
  "centimos for CRC, **cents for USD**", `transactions.currency` is "Currency of
  this specific transaction", and `exchange_rate` is "NULL if same currency as
  account."

These cannot both be true. The real-world requirement decides it: a USD account
stored canonically in CRC would have a balance computed as a *sum of per-day-rate
conversions*, which will not match the USD balance the bank reports, and
converting back to USD for display compounds the drift. **Storing native
currency is the only option that keeps a USD account reconcilable against its
bank statement.**

There is also a latent bug the same decision fixes: Phase 1 handlers return
`balance / 100` using Go integer division, which **truncates minor units**
(`$15.50` stored as `1550` returns `15`). Harmless for CRC where centimos are
rarely used, wrong for USD.

---

## Decision 1: Native-currency storage (canonical model)

**Storage (source of truth):**

- Each account has a `currency` (`CRC` or `USD`).
- That account's `balance` and each of its transactions' `amount` are stored in
  **minor units of the account's own currency** (BIGINT): CRC centimos for a CRC
  account, USD cents for a USD account.
- `transactions.currency` records the transaction's currency.
- `transactions.exchange_rate` (NUMERIC(12,4)) stamps the USD→CRC rate for the
  transaction's date, enabling cross-currency *display* later. NULL when not yet
  populated.

This means imported data is **1:1 with the bank statement** — no conversion at
import, no accumulating rounding, balances always reconcile.

**Aggregation (read-time only):** "Canonical CRC" applies *only* where amounts
from different-currency accounts must be pooled — net worth, and budget activity
across accounts. There, USD amounts are converted to CRC using each
transaction's stamped `exchange_rate`, **as a computed read**, never written back
to storage.

**No schema change required** — the existing tables already match this model.
The fix is to the *prose* in PRD 01 and PRD 03.

## Decision 2: API speaks minor units + currency

The API boundary exposes and accepts **minor units (BIGINT) plus a `currency`
field**; the frontend formats for display (`₡25,000` vs `$15.50`). This matches
PRD 08's stated convention and removes the truncation bug.

This replaces the Phase 1 implementation's colones-at-the-boundary (`÷×100`) and
`outflow`/`inflow` split. See "Step 0" below.

## Decision 3: Layering rule

A single explicit rule the backend follows:

- **Thin CRUD domains** (accounts, transactions, categories) → **handler →
  repository**. No service layer. (This is what Phase 1 built; keep it.)
- **Logic-heavy domains** (import, categorization; later budget, reports,
  exchange rates) → **handler → service → repository**. The service owns
  orchestration and business rules; repositories stay dumb data access.

## Decision 4: Pure, testable core

The parser and the categorizer are **pure logic with no database or HTTP
dependency**, so they are fully unit-testable in isolation. The service layer
feeds them data (uploaded bytes, the current payee-rule set) and persists
results. This is the entry point for the project's first Go tests, written
test-first.

---

## Step 0: Phase 1 money-boundary reconciliation (prerequisite)

Done before any import code lands, so import is not built on the old boundary.

**Backend:**
- `handler/accounts.go` `toResponse`: emit `balance` as raw minor units (drop
  `/ 100`); include `currency` (already present).
- `handler/transactions.go` `toResponse`: emit a single signed `amount` in minor
  units + `currency`; **remove the `outflow`/`inflow` split**.
- Write paths: accept `amount` (and account `balance`) as minor units; **remove
  the `* 100`** in `account_repo.Create` and `transaction_repo.Create/Update`.

**Frontend — anti-corruption adapter in `src/api.ts` only.** The existing
components are deeply coupled to whole-major-unit numbers and the
`outflow`/`inflow` transaction shape (`Accounts.tsx`, `Dashboard`,
`AccountsModals`, and the static mock data in `data.ts`). Rewriting all of that
is a large change unrelated to import, so Step 0 isolates the conversion to the
API boundary:

- `fetchAccounts`: divide API `balance` (minor units) by 100 → major-unit float.
- `fetchAccountTransactions`: map API `{ amount (signed minor units), currency }`
  → the existing `{ outflow, inflow }` major-unit shape
  (`amount < 0 → outflow = -amount/100`, else `inflow = amount/100`).
- `createAccount` / `createTransaction` / `updateTransaction`: multiply
  major-unit inputs by 100 before POST/PUT.

JavaScript division is float, so this boundary has **no truncation** (the bug
was Go integer division). Components, mock data, and `fmt()` are untouched.

**Deferred to the currency-toggle deliverable (roadmap 2.5):** migrating the
frontend to hold minor units internally and making `fmt()` currency-aware
(`USD → $`, 2 decimals). Until then a USD account's balance renders with a `₡`
symbol but the correct magnitude — a known cosmetic wart, not a data bug.

**Acceptance:** the existing CRC accounts/transactions display unchanged after
the backend switches to minor units; the Go `balance / 100` truncation is gone;
a `$15.50` value round-trips through the API losslessly (verified at the API
boundary, independent of the deferred frontend symbol fix).

---

## Feature: BAC CSV import + auto-categorization

### Scope

- **In scope:** BAC CSV format only; payee normalization; auto-categorization
  (exact/prefix/fuzzy) against learned `payee_rules`; duplicate detection;
  transfer flagging; preview/confirm workflow; rule learning on confirm; import
  history.
- **Deferred (own later plans):**
  - **Exchange-rate stamping** (roadmap 2.4). Native-currency storage means a USD
    import stores USD and works without a rate; the rate only matters for the
    cross-currency toggle, which is a later deliverable. Imported transactions
    leave `exchange_rate` NULL for now.
  - **Cross-account transfer linking.** `TF` rows are flagged informationally;
    auto-matching the opposite leg in another account is deferred.
  - QIF / MT940 / `.dat` parsers and BCR — added later via the parser interface
    with no change to the categorizer or service.

### BAC CSV format (from `ejemplo_usd.csv` / `ejemplo_crc.*`)

Three sections, Latin-1 encoded:

1. **Account header** (rows 1–2): `Moneda` (CRC/USD), `Producto` (IBAN),
   `Saldo Inicial`, `Saldo en Libros`, `Saldo Disponible`, `Fecha` (statement
   date, DD/MM/YYYY).
2. **Transaction detail** (after blank line + `Detalle de Estado Bancario`
   subheader): `Fecha de Transaccion` (DD/MM/YYYY), `Referencia`, `Codigo`
   (TF/CP/PP/…), `Descripcion` (space-padded), `Debito`, `Credito`, `Balance`.
   Debit > 0 → outflow (negative amount); Credit > 0 → inflow (positive).
   Period is the decimal separator.
3. **Summary footer** (after `Resumen de Estado Bancario`): stop parsing here.

### Package layout

```
internal/
  importer/                  ← pure: no DB, no HTTP, fully unit-tested
    parser.go                Parser interface + ParsedStatement / ParsedTxn types
    bac_csv.go               BAC CSV parser
    normalize.go             payee normalization pipeline
    categorize.go            matching → suggestion + confidence (pure fn over a rule set)
    testdata/
      bac_usd.csv            committed copy of ejemplo_usd.csv
      bac_crc.csv            committed copy of a CRC sample
  service/
    import_service.go        orchestration: preview + confirm
  repository/
    payee_rule_repo.go       list, learn (upsert + increment match_count)
    import_repo.go           create import record, bulk insert transactions
  handler/
    imports.go               preview, confirm, history
  model/
    import.go                ParsedStatement DTOs, preview/confirm request+response
    payee_rule.go            PayeeRule struct
```

### Core types (pure layer)

```go
// importer/parser.go
type Parser interface {
    // Parse consumes raw statement bytes and returns a normalized statement.
    Parse(r io.Reader) (ParsedStatement, error)
}

type ParsedStatement struct {
    Currency        string          // "CRC" | "USD" (from header; "" if format has none)
    IBAN            string
    OpeningBalance  int64           // minor units
    AvailableBalance int64          // minor units
    StatementDate   string          // YYYY-MM-DD
    Transactions    []ParsedTxn
}

type ParsedTxn struct {
    Date            string          // YYYY-MM-DD
    Amount          int64           // minor units, signed (negative = outflow)
    DescriptionRaw  string
    Reference       string          // → check_number
    TransactionCode string          // TF/CP/PP/...
    RunningBalance  int64           // minor units, for optional reconciliation
}
```

The categorizer is a pure function over a supplied rule set:

```go
// importer/categorize.go
type Confidence string // "HIGH" | "MEDIUM" | "LOW" | "NONE"

type Suggestion struct {
    CategoryID string
    Confidence Confidence
}

// Categorize matches a normalized description against rules, returning the best
// suggestion. Pure: no DB. The service supplies `rules` loaded from the repo.
func Categorize(normalizedDesc string, rules []PayeeRule) Suggestion
```

Matching tiers (PRD 02): exact normalized match → HIGH; prefix match (either
direction) → MEDIUM; fuzzy (trigram / Levenshtein threshold) → LOW; else NONE.

Normalization pipeline (`normalize.go`): trim padding → uppercase → strip known
CR bank suffixes (`SAN J`, `LIBER`, `CURRI`, `SANTA`, `FAC`, `OCN\d+P`, terminal
numbers) → collapse whitespace → trim.

### Endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/imports/preview` | multipart: `file`, `account_id` | Parse + categorize + flag dupes/transfers. **No DB writes.** |
| POST | `/api/imports/confirm` | JSON (see below) | Commit in one DB transaction. |
| GET | `/api/imports` | — | Import history. |

**Preview response** (per PRD 02, amounts in minor units):

```json
{
  "file_info": {
    "filename": "...", "currency": "USD", "iban": "CR88...",
    "opening_balance": 5392620, "available_balance": 4916336,
    "statement_date": "2026-03-31", "transaction_count": 12,
    "date_range": { "from": "2026-04-01", "to": "2026-04-13" },
    "total_inflow": 184616, "total_outflow": -660900,
    "currency_mismatch": false
  },
  "transactions": [
    {
      "temp_id": "tmp_1", "date": "2026-04-01", "amount": -36700,
      "description_raw": "TEF A : 952432326             ",
      "description_normalized": "TEF A 952432326",
      "reference": "406471624", "transaction_code": "TF",
      "balance": 5355920,
      "suggested_category_id": null, "suggested_confidence": "NONE",
      "duplicate_of": null, "is_transfer": true
    }
  ]
}
```

`currency_mismatch` is true when the CSV header currency ≠ the selected account's
currency (warn, don't block — PRD 02 edge case 8).

### Stateless confirm (deviation from PRD 02 — approved)

PRD 02's original `confirm` payload sent only `temp_id` + overrides, which would
require the server to remember the parsed file between calls (a stateful import
session). Instead, **confirm re-sends the full reviewed transactions** the
frontend already holds. Simpler, stateless, robust for a single-user app. PRD 02
is updated to match.

**Confirm request:** the frontend re-sends the raw parsed fields plus the user's
review decisions. The server normalizes `description_raw` itself — clients never
send normalized strings.

```json
{
  "account_id": "uuid",
  "filename": "estado_cuenta_abril.csv",
  "transactions": [
    {
      "include": true,
      "date": "2026-04-01", "amount": -36700,
      "description_raw": "TEF A : 952432326             ",
      "reference": "406471624",
      "category_id": "uuid-or-null",
      "payee_override": null, "memo": null
    }
  ]
}
```

**Raw vs normalized, made explicit:**
- `transactions.payee` (stored) = `payee_override` if provided, else the trimmed
  `description_raw`. Per PRD 01, this column holds the human-readable payee.
- The **payee-rule key and the duplicate-detection key** use
  `normalize(description_raw)`, computed server-side — never the override. This
  keeps rule learning stable regardless of per-transaction display overrides.

**Confirm response:**

```json
{ "import_id": "uuid", "imported_count": 10, "skipped_count": 2,
  "new_rules_created": 8, "rules_updated": 3 }
```

### Commit transaction (atomic)

In a single pgx DB transaction, `import_service.Confirm`:

1. Insert an `imports` row (`account_id`, `filename`, `transaction_count`,
   `status='completed'`).
2. Bulk-insert the included transactions (linked via `import_id`), each storing
   `amount` in the account's native minor units, `currency` = account currency,
   `exchange_rate` = NULL (deferred).
3. Update the account `balance` by the sum of included amounts.
4. **Learn rules:** for each included transaction the user categorized, upsert a
   `payee_rule` keyed by normalized description — create with `match_count = 1`,
   or update `category_id` + increment `match_count` + set `last_used_at`.
5. Commit. Any error rolls back the entire import.

### Duplicate detection

A parsed transaction is flagged a potential duplicate when an existing
transaction in the **same account** matches on: same date, same amount, same
normalized description, and same reference (when present). Flagged in preview,
**not auto-excluded** — the user decides (legitimate same-day same-amount
repeats happen).

---

## Cross-cutting quality changes

These land alongside the import work and become standing conventions.

### Typed errors

Replace the string-matching `isNotFound()` (which greps `err.Error()` for "no
rows"/"not found") with a sentinel:

```go
// repository/errors.go
var ErrNotFound = errors.New("not found")
```

Repositories return `ErrNotFound` (mapping `pgx.ErrNoRows`); handlers branch with
`errors.Is(err, repository.ErrNotFound)`.

### Validation

A small shared helper for the repeated `readJSON` + required-field pattern in
handlers — not a framework. Keeps validation consistent as endpoints multiply.

### Testing discipline (test-first)

- **Parser tests** (`importer/bac_csv_test.go`): table-driven against committed
  `testdata/bac_usd.csv` and `testdata/bac_crc.csv` — assert section detection,
  DD/MM/YYYY parsing, debit/credit → signed minor units, Latin-1 decoding,
  footer stop, padding trim.
- **Normalizer + categorizer tests** (`normalize_test.go`, `categorize_test.go`):
  table-driven over the normalization pipeline and the exact/prefix/fuzzy tiers
  with confidence assertions.

These pure-function tests are written before their implementations.

---

## Documentation reconciliation (part of this work)

| Doc | Change |
|-----|--------|
| PRD 01 | Rewrite *Currency Strategy* prose: native-currency storage; CRC-canonical only at aggregation. Remove the "everything stored in CRC" claim that contradicts the table definitions. |
| PRD 03 | Fix Principle 1 to "native storage; convert at display/aggregation via stamped per-transaction rate." |
| PRD 08 | Money convention → minor units + `currency` (already stated; align examples). Fix grouped-category route to `/api/category-groups`. Note stateless `confirm` payload. |
| PRD 02 | Stateless `confirm` payload; amounts in minor units; note the format-agnostic `Parser` interface; flag filename (`02-qif-import…`) vs CSV content. |
| PRD 11 | Phase 2: add Step 0 reconciliation; scope import to BAC CSV first; note parser interface; move exchange rates to a separate 2.4 plan. |

---

## Out of scope (explicit)

- Exchange-rate fetching/stamping and the CRC/USD display toggle (roadmap 2.4–2.5).
- Cross-account transfer auto-linking.
- QIF, MT940 (`.txt`), fixed-width (`.dat`) parsers; BCR and other banks.
- Budgeting, dashboard, reports (Phases 3–4).

## Acceptance criteria

1. Step 0: CRC and USD accounts both display correct balances from minor units;
   a USD amount with cents round-trips losslessly.
2. Uploading `ejemplo_usd.csv` to a USD account previews 12 transactions with
   correct signed minor-unit amounts, normalized descriptions, references,
   transfer flags, and any duplicate flags — with no DB writes.
3. Confirming the preview inserts the included transactions, updates the account
   balance to match, creates an `imports` record, and learns/updates
   `payee_rules`; re-importing the same file flags every row as a duplicate.
4. Parser, normalizer, and categorizer have passing table-driven unit tests.
5. `isNotFound` string-matching is gone; handlers use `errors.Is` +
   `repository.ErrNotFound`.
