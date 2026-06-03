# BAC CSV Import + Money Model Reconciliation — Implementation Plan

> **Status: COMPLETED — 2026-06-03**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the accounts/transactions API to native-currency minor units, then build BAC CSV import with payee normalization, auto-categorization, duplicate detection, and a stateless preview/confirm workflow.

**Architecture:** Phase 1 CRUD stays handler→repository. Import is logic-heavy, so it uses handler→service→repository. The parser, payee normalizer, and categorizer are **pure** (no DB/HTTP) and fully unit-tested. A format-agnostic `Parser` interface keeps future formats (QIF/MT940/BCR) additive. The money boundary moves to minor units + a `currency` field; the frontend keeps its current shape via an anti-corruption adapter in `api.ts`.

**Tech Stack:** Go 1.26.2, pgx/v5, net/http, log/slog, `golang.org/x/text/encoding/charmap` (Latin-1), Go `testing` (table-driven); React 19 + TypeScript (`api.ts` only).

**Reference spec:** `docs/superpowers/specs/2026-06-02-csv-import-design.md`

---

## File map

```
server/
  go.mod                                         modify — x/text becomes a direct dep
  main.go                                         modify — wire import repos/service/handler + routes
  internal/
    repository/
      errors.go                                   create — ErrNotFound sentinel
      account_repo.go                             modify — drop ×100; map ErrNoRows→ErrNotFound
      transaction_repo.go                         modify — drop ×100; map ErrNoRows→ErrNotFound
      payee_rule_repo.go                          create — List + Learn (upsert)
      import_repo.go                              create — dup candidates, create import, insert txn, list
    handler/
      middleware.go                               modify — remove string-matching isNotFound
      accounts.go                                 modify — minor units; errors.Is
      transactions.go                             modify — single signed amount + currency; errors.Is
      imports.go                                  create — preview, confirm, history
    model/
      account.go                                  modify — Balance comment (minor units)
      transaction.go                              modify — Amount comment (minor units)
      payee_rule.go                               create — PayeeRule struct
      import.go                                   create — preview/confirm DTOs
    service/
      import_service.go                           create — preview + confirm orchestration
    importer/
      parser.go                                   create — Parser interface + ParsedStatement/ParsedTxn
      bac_csv.go                                  create — BAC CSV parser
      normalize.go                                create — payee normalization
      categorize.go                               create — exact/prefix/fuzzy matching
      bac_csv_test.go                             create — parser tests
      normalize_test.go                           create — normalization tests
      categorize_test.go                          create — categorizer tests
      testdata/
        bac_usd.csv                               create — copy of ejemplo_usd.csv
        bac_crc.csv                               create — small synthetic CRC fixture

frontend/
  src/api.ts                                      modify — anti-corruption adapter (minor units ↔ major)
  src/data.ts                                     modify — comment only (Account.balance still major)
```

---

# Part A — Step 0: Money boundary reconciliation

## Task 1: Account API → minor units

**Files:**
- Modify: `server/internal/handler/accounts.go:25`
- Modify: `server/internal/repository/account_repo.go` (Create, `req.Balance*100`)
- Modify: `server/internal/model/account.go` (comment)

- [ ] **Step 1.1: Stop dividing balance in the handler**

In `server/internal/handler/accounts.go`, change the `toResponse` balance line:

```go
		"balance":    a.Balance,
```

(was `a.Balance / 100`). Leave every other field unchanged — `currency` is already returned.

- [ ] **Step 1.2: Stop multiplying balance in the repo**

In `server/internal/repository/account_repo.go`, in `Create`, the INSERT currently passes `req.Balance*100`. Change that argument to `req.Balance`:

```go
	`, req.Name, req.Type, currency, req.Balance, req.OnBudget, req.Note, req.SortOrder,
```

- [ ] **Step 1.3: Update the model comment**

In `server/internal/model/account.go`, change the `Balance` field comment in `CreateAccountReq` from `// received as colones, multiplied ×100 before storage` to:

```go
	Balance   int64  `json:"balance"` // minor units of the account currency (CRC centimos / USD cents)
```

- [ ] **Step 1.4: Build**

Run: `cd server && go build ./...`
Expected: exits 0.

- [ ] **Step 1.5: Commit**

```bash
git add server/internal/handler/accounts.go server/internal/repository/account_repo.go server/internal/model/account.go
git commit -m "refactor: account API speaks minor units, not colones"
```

---

## Task 2: Transaction API → single signed amount + currency

**Files:**
- Modify: `server/internal/handler/transactions.go:20-48` (`toResponse`)
- Modify: `server/internal/repository/transaction_repo.go` (Create line 83, Update line 129)
- Modify: `server/internal/model/transaction.go` (comments)

- [ ] **Step 2.1: Replace the outflow/inflow split with amount + currency**

In `server/internal/handler/transactions.go`, replace the entire `toResponse` method (lines 19–48) with:

```go
// toResponse maps a transaction to the API shape: a single signed amount in the
// account's native minor units, plus its currency. The frontend formats it.
func (h *TransactionHandler) toResponse(t model.Transaction) map[string]any {
	var category any = nil
	if t.CategoryName != "" {
		category = t.CategoryName
	}
	var categoryID any = nil
	if t.CategoryID != "" {
		categoryID = t.CategoryID
	}
	return map[string]any{
		"id":          t.ID,
		"account":     t.AccountID,
		"date":        t.Date,
		"payee":       t.Payee,
		"category":    category,
		"category_id": categoryID,
		"memo":        t.Memo,
		"amount":      t.Amount,
		"currency":    t.Currency,
		"cleared":     t.Cleared,
	}
}
```

- [ ] **Step 2.2: Stop multiplying amount in the repo (Create)**

In `server/internal/repository/transaction_repo.go`, in `Create`, replace line 83:

```go
	amount := req.Amount
```

Then replace the two later uses of `amountCentimos` in `Create` (the INSERT parameter and the balance `UPDATE`) with `amount`. Also update the function's doc comment above `Create` to:

```go
// Create inserts the transaction and updates the account balance atomically.
// req.Amount is already in the account's native minor units.
```

- [ ] **Step 2.3: Stop multiplying amount in the repo (Update)**

In `Update`, replace line 129:

```go
	newAmount := req.Amount
```

Replace the two uses of `newAmountCentimos` (the UPDATE parameter and the `diff` computation) with `newAmount`. Update the doc comment to `// req.Amount is already in the account's native minor units.`

- [ ] **Step 2.4: Update model comments**

In `server/internal/model/transaction.go`, change the `Amount` comments in `CreateTransactionReq` and `UpdateTransactionReq` to:

```go
	Amount     int64  `json:"amount"` // signed minor units (negative = outflow)
```

- [ ] **Step 2.5: Build**

Run: `cd server && go build ./...`
Expected: exits 0.

- [ ] **Step 2.6: Commit**

```bash
git add server/internal/handler/transactions.go server/internal/repository/transaction_repo.go server/internal/model/transaction.go
git commit -m "refactor: transaction API uses signed minor-unit amount + currency"
```

---

## Task 3: Frontend anti-corruption adapter in `api.ts`

The backend now sends/accepts minor units. Convert at the boundary so every component, the mock data, and `fmt()` stay unchanged. JS division is float — no truncation.

**Files:**
- Modify: `frontend/src/api.ts` (fetchAccounts, fetchAccountTransactions, createAccount, createTransaction, updateTransaction)
- Modify: `frontend/src/data.ts:4` (comment)

- [ ] **Step 3.1: Convert account balance on read**

In `frontend/src/api.ts`, replace `fetchAccounts` (lines 26–32) with:

```ts
export async function fetchAccounts(): Promise<{ budget: Account[]; tracking: Account[] }> {
  const list: Array<Account & { balance: number }> = await apiFetch('/accounts');
  const toMajor = (a: Account): Account => ({ ...a, balance: a.balance / 100 });
  return {
    budget:   list.filter(a => a.on_budget && !a.closed).map(toMajor),
    tracking: list.filter(a => !a.on_budget && !a.closed).map(toMajor),
  };
}
```

- [ ] **Step 3.2: Convert account balance on create**

Replace `createAccount` (lines 34–38) with:

```ts
export async function createAccount(body: {
  name: string; type: string; currency: string; balance: number; on_budget: boolean; note?: string;
}): Promise<Account> {
  const acc: Account = await apiFetch('/accounts', {
    method: 'POST',
    body: JSON.stringify({ ...body, balance: Math.round(body.balance * 100) }),
  });
  return { ...acc, balance: acc.balance / 100 };
}
```

- [ ] **Step 3.3: Map signed amount → outflow/inflow on read**

Replace `fetchAccountTransactions` (lines 54–63) with:

```ts
export async function fetchAccountTransactions(
  accountId: string,
  page = 1,
  perPage = 200,
): Promise<Transaction[]> {
  type ApiTxn = Omit<Transaction, 'outflow' | 'inflow'> & { amount: number; currency: string };
  const data: { transactions: ApiTxn[] } = await apiFetch(
    `/accounts/${accountId}/transactions?page=${page}&per_page=${perPage}`,
  );
  return (data.transactions ?? []).map(t => {
    const major = t.amount / 100;
    return {
      id: t.id, date: t.date, payee: t.payee, category: t.category,
      memo: t.memo, cleared: t.cleared, account: t.account,
      outflow: major < 0 ? -major : 0,
      inflow: major > 0 ? major : 0,
    } as Transaction;
  });
}
```

- [ ] **Step 3.4: Convert amount → minor units on create/update**

Replace `createTransaction` (lines 65–73) and `updateTransaction` (lines 75–80) with:

```ts
export async function createTransaction(
  accountId: string,
  body: { date: string; payee: string; category_id?: string; amount: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  return apiFetch(`/accounts/${accountId}/transactions`, {
    method: 'POST',
    body: JSON.stringify({ ...body, amount: Math.round(body.amount * 100) }),
  });
}

export async function updateTransaction(
  id: string,
  body: { date?: string; payee?: string; category_id?: string; amount?: number; memo?: string; cleared?: boolean },
): Promise<Transaction> {
  const payload = body.amount === undefined ? body : { ...body, amount: Math.round(body.amount * 100) };
  return apiFetch(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
```

Note: the callers in `Accounts.tsx` already compute `amount` in major units from outflow/inflow (`updated.inflow > 0 ? updated.inflow : -updated.outflow`), so this adapter is the only conversion point.

- [ ] **Step 3.5: Update the data.ts comment**

In `frontend/src/data.ts`, line 4, change the `balance` comment to:

```ts
  balance: number;        // major units (api.ts converts ÷100 from minor units at the boundary)
```

- [ ] **Step 3.6: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0 (no type errors).

- [ ] **Step 3.7: Commit**

```bash
git add frontend/src/api.ts frontend/src/data.ts
git commit -m "refactor: api.ts adapts minor-unit backend to existing frontend shape"
```

---

# Part B — Quality foundation: typed errors

## Task 4: Replace string-matched `isNotFound` with a sentinel error

**Files:**
- Create: `server/internal/repository/errors.go`
- Modify: `server/internal/repository/account_repo.go` (Get, Update, ToggleClosed, Delete)
- Modify: `server/internal/repository/transaction_repo.go` (Get, Update, Delete)
- Modify: `server/internal/handler/accounts.go` (4 isNotFound calls)
- Modify: `server/internal/handler/transactions.go` (3 isNotFound calls)
- Modify: `server/internal/handler/middleware.go` (remove isNotFound + unused import)

- [ ] **Step 4.1: Create the sentinel**

Create `server/internal/repository/errors.go`:

```go
package repository

import "errors"

// ErrNotFound is returned by repositories when a requested row does not exist.
// Handlers branch on it with errors.Is to return a 404.
var ErrNotFound = errors.New("not found")
```

- [ ] **Step 4.2: Map ErrNoRows in account_repo**

In `server/internal/repository/account_repo.go`, add `"errors"` and `"github.com/jackc/pgx/v5"` to the imports. In `Get`, `Update`, and `ToggleClosed`, change the error return to map no-rows:

```go
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return a, ErrNotFound
		}
		return a, fmt.Errorf("get account %s: %w", id, err)
	}
```

(use the matching wrap message already present in each method). In `Delete`, replace the `tag.RowsAffected() == 0` branch's `fmt.Errorf("account %s not found", id)` with `ErrNotFound`.

- [ ] **Step 4.3: Map ErrNoRows in transaction_repo**

In `server/internal/repository/transaction_repo.go`, add `"errors"` and `"github.com/jackc/pgx/v5"` imports. In `Get`, map `pgx.ErrNoRows` → `ErrNotFound` (same pattern as 4.2). In `Update` and `Delete`, the first `tx.QueryRow(...).Scan(...)` that loads the existing row should map `pgx.ErrNoRows` → `ErrNotFound`:

```go
	).Scan(&oldAmount, &accountID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.Transaction{}, ErrNotFound
		}
		return model.Transaction{}, fmt.Errorf("get old transaction: %w", err)
	}
```

(In `Delete` the return type is just `error`, so return `ErrNotFound` directly.)

- [ ] **Step 4.4: Switch handlers to errors.Is**

In `server/internal/handler/accounts.go`, add `"errors"` and `"budgetapp/internal/repository"` (already imported) to imports, then replace each `if isNotFound(err) {` with:

```go
		if errors.Is(err, repository.ErrNotFound) {
```

Do the same in `server/internal/handler/transactions.go`.

- [ ] **Step 4.5: Remove the old helper**

In `server/internal/handler/middleware.go`, delete the `isNotFound` function (the `func isNotFound(err error) bool { ... }` at the bottom of the file) and remove `"strings"` from the import block (it is now unused).

- [ ] **Step 4.6: Build**

Run: `cd server && go build ./...`
Expected: exits 0.

- [ ] **Step 4.7: Commit**

```bash
git add server/internal/repository/errors.go server/internal/repository/account_repo.go server/internal/repository/transaction_repo.go server/internal/handler/
git commit -m "refactor: typed repository.ErrNotFound replaces string-matched isNotFound"
```

---

# Part C — Import pure core (TDD)

## Task 5: Parser interface and types

**Files:**
- Create: `server/internal/importer/parser.go`

- [ ] **Step 5.1: Create the package with types and interface**

Create `server/internal/importer/parser.go`:

```go
// Package importer parses bank statement exports into a normalized, format-agnostic
// shape and provides payee normalization + auto-categorization. It has no database
// or HTTP dependencies and is fully unit-tested.
package importer

import "io"

// Parser turns raw statement bytes into a normalized statement. One implementation
// per bank/format (e.g. BACCSVParser). Adding a format means adding a Parser; the
// categorizer and import service never change.
type Parser interface {
	Parse(r io.Reader) (ParsedStatement, error)
}

// ParsedStatement is the normalized result of parsing one statement file.
// All monetary values are in the statement currency's minor units.
type ParsedStatement struct {
	Currency         string // "CRC" | "USD"; "" if the format carries no currency
	IBAN             string
	OpeningBalance   int64
	AvailableBalance int64
	StatementDate    string // "YYYY-MM-DD"; "" if absent
	Transactions     []ParsedTxn
}

// ParsedTxn is one normalized transaction line.
type ParsedTxn struct {
	Date            string // "YYYY-MM-DD"
	Amount          int64  // signed minor units (negative = outflow)
	DescriptionRaw  string // exactly as in the file, padding preserved
	Reference       string
	TransactionCode string // e.g. "TF", "CP", "PP"
	RunningBalance  int64  // minor units; for optional reconciliation
}
```

- [ ] **Step 5.2: Build**

Run: `cd server && go build ./internal/importer/`
Expected: exits 0.

- [ ] **Step 5.3: Commit**

```bash
git add server/internal/importer/parser.go
git commit -m "feat: add format-agnostic Parser interface and parsed-statement types"
```

---

## Task 6: BAC CSV parser

**Files:**
- Create: `server/internal/importer/testdata/bac_usd.csv`
- Create: `server/internal/importer/testdata/bac_crc.csv`
- Create: `server/internal/importer/bac_csv_test.go`
- Create: `server/internal/importer/bac_csv.go`

- [ ] **Step 6.1: Copy the real USD sample into testdata**

```bash
mkdir -p server/internal/importer/testdata
cp ejemplo_usd.csv server/internal/importer/testdata/bac_usd.csv
```

- [ ] **Step 6.2: Create a small synthetic CRC fixture**

Create `server/internal/importer/testdata/bac_crc.csv` (plain ASCII — markers and the CRC/USD token carry no accents, so the parser keys off them cleanly):

```
Numero de Clientes, Nombre, Producto, Moneda, Saldo Inicial, Saldo en Libros, Retenidos y Diferidos, Saldo Disponible, Fecha, STBGAV, STBUNC
1234567, TEST USER, CR99010200001234567890, CRC, 100000.00, 95000.00, 0.00, 95000.00, 31/03/2026, 0.00, 0.00

Detalle de Estado Bancario
Fecha de Transaccion, Referencia, Codigo, Descripcion, Debito, Credito, Balance
01/04/2026, 100001, CP, AUTOMERCADO ESCAZU, 5000.00, 0.00, 95000.00
02/04/2026, 100002, PP, SALARIO ABRIL, 0.00, 50000.00, 145000.00

Resumen de Estado Bancario
Total, 1, 5000.00, 1, 50000.00
```

- [ ] **Step 6.3: Write the failing tests**

Create `server/internal/importer/bac_csv_test.go`:

```go
package importer

import (
	"os"
	"testing"
)

func parseFixture(t *testing.T, name string) ParsedStatement {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer f.Close()
	stmt, err := BACCSVParser{}.Parse(f)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return stmt
}

func TestBACCSV_USD_Header(t *testing.T) {
	stmt := parseFixture(t, "bac_usd.csv")
	if stmt.Currency != "USD" {
		t.Errorf("currency = %q, want USD", stmt.Currency)
	}
	if stmt.IBAN != "CR88010200009342364982" {
		t.Errorf("iban = %q", stmt.IBAN)
	}
	if stmt.OpeningBalance != 5392620 {
		t.Errorf("opening = %d, want 5392620", stmt.OpeningBalance)
	}
	if stmt.StatementDate != "2026-03-31" {
		t.Errorf("statement date = %q, want 2026-03-31", stmt.StatementDate)
	}
}

func TestBACCSV_USD_Transactions(t *testing.T) {
	stmt := parseFixture(t, "bac_usd.csv")
	if len(stmt.Transactions) != 12 {
		t.Fatalf("len = %d, want 12", len(stmt.Transactions))
	}
	first := stmt.Transactions[0]
	if first.Date != "2026-04-01" {
		t.Errorf("date = %q, want 2026-04-01", first.Date)
	}
	if first.Amount != -36700 {
		t.Errorf("amount = %d, want -36700", first.Amount)
	}
	if first.Reference != "406471624" {
		t.Errorf("reference = %q", first.Reference)
	}
	if first.TransactionCode != "TF" {
		t.Errorf("code = %q, want TF", first.TransactionCode)
	}
	// The PP credit row (Invoice Telescoped) is a positive inflow.
	var credit ParsedTxn
	for _, tx := range stmt.Transactions {
		if tx.TransactionCode == "PP" {
			credit = tx
		}
	}
	if credit.Amount != 184616 {
		t.Errorf("credit amount = %d, want 184616", credit.Amount)
	}
}

func TestBACCSV_CRC_Currency(t *testing.T) {
	stmt := parseFixture(t, "bac_crc.csv")
	if stmt.Currency != "CRC" {
		t.Errorf("currency = %q, want CRC", stmt.Currency)
	}
	if len(stmt.Transactions) != 2 {
		t.Fatalf("len = %d, want 2", len(stmt.Transactions))
	}
	if stmt.Transactions[0].Amount != -500000 {
		t.Errorf("debit = %d, want -500000", stmt.Transactions[0].Amount)
	}
	if stmt.Transactions[1].Amount != 5000000 {
		t.Errorf("credit = %d, want 5000000", stmt.Transactions[1].Amount)
	}
}
```

- [ ] **Step 6.4: Run tests to verify they fail**

Run: `cd server && go test ./internal/importer/`
Expected: FAIL — `undefined: BACCSVParser`.

- [ ] **Step 6.5: Implement the parser**

Create `server/internal/importer/bac_csv.go`:

```go
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/encoding/charmap"
)

// BACCSVParser parses BAC (Banco BAC Credomatic) CSV statement exports, which are
// Latin-1 encoded and structured as: account header, "Detalle de Estado Bancario"
// transaction section, and a "Resumen de Estado Bancario" footer.
type BACCSVParser struct{}

func (BACCSVParser) Parse(r io.Reader) (ParsedStatement, error) {
	cr := csv.NewReader(charmap.ISO8859_1.NewDecoder().Reader(r))
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true
	cr.LazyQuotes = true // bank descriptions occasionally contain stray quote characters
	records, err := cr.ReadAll()
	if err != nil {
		return ParsedStatement{}, fmt.Errorf("read csv: %w", err)
	}

	var stmt ParsedStatement
	section := "header"
	headerParsed := false

	for i, rec := range records {
		if len(rec) == 0 {
			continue
		}
		first := strings.TrimSpace(rec[0])

		switch section {
		case "header":
			if strings.HasPrefix(first, "Detalle de Estado Bancario") {
				section = "detail-cols"
				continue
			}
			// The account data row is the one whose currency field is CRC/USD
			// (the column-name row has "Moneda" there).
			if !headerParsed && len(rec) >= 9 && isAccountDataRow(rec) {
				stmt.Currency = strings.TrimSpace(rec[3])
				stmt.IBAN = strings.TrimSpace(rec[2])
				stmt.OpeningBalance = amountOrZero(rec[4])
				stmt.AvailableBalance = amountOrZero(rec[7])
				if d, err := parseDateDDMMYYYY(rec[8]); err == nil {
					stmt.StatementDate = d
				}
				headerParsed = true
			}
		case "detail-cols":
			// This is the transaction column-header row; skip exactly one.
			section = "detail"
		case "detail":
			if strings.HasPrefix(first, "Resumen de Estado Bancario") {
				section = "done"
				continue
			}
			txn, ok, err := parseBACDetailRow(rec)
			if err != nil {
				return stmt, fmt.Errorf("row %d: %w", i+1, err)
			}
			if ok {
				stmt.Transactions = append(stmt.Transactions, txn)
			}
		case "done":
			// summary rows ignored
		}
	}
	return stmt, nil
}

func isAccountDataRow(rec []string) bool {
	c := strings.TrimSpace(rec[3])
	return c == "CRC" || c == "USD"
}

func parseBACDetailRow(rec []string) (ParsedTxn, bool, error) {
	if len(rec) < 7 {
		return ParsedTxn{}, false, nil
	}
	debit, err := parseAmount(rec[4])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	credit, err := parseAmount(rec[5])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	if debit == 0 && credit == 0 {
		return ParsedTxn{}, false, nil // empty/blank row
	}
	date, err := parseDateDDMMYYYY(rec[0])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	balance, err := parseAmount(rec[6])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	return ParsedTxn{
		Date:            date,
		Amount:          credit - debit, // credit = inflow (+), debit = outflow (−)
		DescriptionRaw:  rec[3],
		Reference:       strings.TrimSpace(rec[1]),
		TransactionCode: strings.TrimSpace(rec[2]),
		RunningBalance:  balance,
	}, true, nil
}

// parseAmount converts a decimal string like "367.00" to minor units (36700).
func parseAmount(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	s = strings.ReplaceAll(s, ",", "") // tolerate thousands separators
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("parse amount %q: %w", s, err)
	}
	return int64(math.Round(f * 100)), nil
}

func amountOrZero(s string) int64 {
	v, _ := parseAmount(s)
	return v
}

// parseDateDDMMYYYY converts "01/04/2026" to "2026-04-01".
func parseDateDDMMYYYY(s string) (string, error) {
	t, err := time.Parse("02/01/2006", strings.TrimSpace(s))
	if err != nil {
		return "", fmt.Errorf("parse date %q: %w", s, err)
	}
	return t.Format("2006-01-02"), nil
}
```

- [ ] **Step 6.6: Run tests to verify they pass**

Run: `cd server && go test ./internal/importer/ -run TestBACCSV -v`
Expected: PASS (all three tests).

- [ ] **Step 6.7: Commit**

```bash
git add server/internal/importer/bac_csv.go server/internal/importer/bac_csv_test.go server/internal/importer/testdata/
git commit -m "feat: BAC CSV parser with Latin-1 decoding and section state machine"
```

---

## Task 7: Payee normalization

**Files:**
- Create: `server/internal/importer/normalize_test.go`
- Create: `server/internal/importer/normalize.go`

- [ ] **Step 7.1: Write the failing tests**

Create `server/internal/importer/normalize_test.go`:

```go
package importer

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"strips location code and OCN", "WALMART CURRIDABAT OCN00PSAN J", "WALMART CURRIDABAT"},
		{"strips colon and padding", "TEF A : 952432326             ", "TEF A 952432326"},
		{"uppercases and collapses", "Automercado   Escazu", "AUTOMERCADO ESCAZU"},
		{"preserves CURRIDABAT (no false suffix)", "AUTOMERCADO CURRIDABAT", "AUTOMERCADO CURRIDABAT"},
		{"empty stays empty", "   ", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Normalize(c.in); got != c.want {
				t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
```

- [ ] **Step 7.2: Run to verify failure**

Run: `cd server && go test ./internal/importer/ -run TestNormalize`
Expected: FAIL — `undefined: Normalize`.

- [ ] **Step 7.3: Implement normalization**

Create `server/internal/importer/normalize.go`:

```go
package importer

import (
	"regexp"
	"strings"
)

var (
	ocnCodeRe   = regexp.MustCompile(`OCN\d+P`)
	suffixRe    = regexp.MustCompile(`\b(SAN J|LIBER|CURRI|SANTA|FAC)\b`)
	nonAlnumRe  = regexp.MustCompile(`[^A-Z0-9\s]`)
	whitespace  = regexp.MustCompile(`\s+`)
)

// Normalize cleans a raw bank description into a stable key for rule matching:
// uppercase, strip OCN commerce codes and known location suffixes, drop
// punctuation, collapse whitespace. It is the single source of truth for the
// payee-rule key and duplicate-detection key.
func Normalize(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = ocnCodeRe.ReplaceAllString(s, " ")
	s = suffixRe.ReplaceAllString(s, " ")
	s = nonAlnumRe.ReplaceAllString(s, " ")
	s = whitespace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
```

- [ ] **Step 7.4: Run to verify pass**

Run: `cd server && go test ./internal/importer/ -run TestNormalize -v`
Expected: PASS (all subtests).

- [ ] **Step 7.5: Commit**

```bash
git add server/internal/importer/normalize.go server/internal/importer/normalize_test.go
git commit -m "feat: payee normalization pipeline"
```

---

## Task 8: Categorizer

**Files:**
- Create: `server/internal/importer/categorize_test.go`
- Create: `server/internal/importer/categorize.go`

- [ ] **Step 8.1: Write the failing tests**

Create `server/internal/importer/categorize_test.go`:

```go
package importer

import "testing"

func TestCategorize(t *testing.T) {
	rules := []Rule{
		{Pattern: "AUTOMERCADO ESCAZU", CategoryID: "groceries"},
		{Pattern: "OFFICE DEPOT PLAZA CRONOS", CategoryID: "office"},
	}

	t.Run("exact is HIGH", func(t *testing.T) {
		s := Categorize("AUTOMERCADO ESCAZU", rules)
		if s.CategoryID != "groceries" || s.Confidence != ConfidenceHigh {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("prefix is MEDIUM", func(t *testing.T) {
		s := Categorize("AUTOMERCADO ESCAZU PLAZA", rules)
		if s.CategoryID != "groceries" || s.Confidence != ConfidenceMedium {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("near match is LOW", func(t *testing.T) {
		s := Categorize("OFFICE DEPOT PLAZA CRONOSSAN", rules)
		if s.CategoryID != "office" || s.Confidence != ConfidenceLow {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("no match is NONE", func(t *testing.T) {
		s := Categorize("COMPLETELY UNRELATED STRING", rules)
		if s.Confidence != ConfidenceNone || s.CategoryID != "" {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("empty input is NONE", func(t *testing.T) {
		if Categorize("", rules).Confidence != ConfidenceNone {
			t.Error("empty should be NONE")
		}
	})
}
```

- [ ] **Step 8.2: Run to verify failure**

Run: `cd server && go test ./internal/importer/ -run TestCategorize`
Expected: FAIL — `undefined: Rule` / `undefined: Categorize`.

- [ ] **Step 8.3: Implement the categorizer**

Create `server/internal/importer/categorize.go`:

```go
package importer

import "strings"

// Confidence expresses how sure a categorization suggestion is.
type Confidence string

const (
	ConfidenceHigh   Confidence = "HIGH"
	ConfidenceMedium Confidence = "MEDIUM"
	ConfidenceLow    Confidence = "LOW"
	ConfidenceNone   Confidence = "NONE"
)

// Rule is a normalized payee pattern mapped to a category. The import service
// builds these from the payee_rules table; the categorizer stays DB-free.
type Rule struct {
	Pattern    string // already normalized
	CategoryID string
}

// Suggestion is the categorizer's output for one description.
type Suggestion struct {
	CategoryID string
	Confidence Confidence
}

const fuzzyThreshold = 0.6

// Categorize matches a normalized description against rules in tiers:
// exact → HIGH, prefix (either direction) → MEDIUM, trigram-similar → LOW, else NONE.
func Categorize(normalizedDesc string, rules []Rule) Suggestion {
	if normalizedDesc == "" || len(rules) == 0 {
		return Suggestion{Confidence: ConfidenceNone}
	}
	for _, r := range rules {
		if r.Pattern == normalizedDesc {
			return Suggestion{CategoryID: r.CategoryID, Confidence: ConfidenceHigh}
		}
	}
	for _, r := range rules {
		if r.Pattern == "" {
			continue
		}
		if strings.HasPrefix(normalizedDesc, r.Pattern) || strings.HasPrefix(r.Pattern, normalizedDesc) {
			return Suggestion{CategoryID: r.CategoryID, Confidence: ConfidenceMedium}
		}
	}
	best, bestID := 0.0, ""
	for _, r := range rules {
		if sim := trigramSimilarity(normalizedDesc, r.Pattern); sim > best {
			best, bestID = sim, r.CategoryID
		}
	}
	if best >= fuzzyThreshold {
		return Suggestion{CategoryID: bestID, Confidence: ConfidenceLow}
	}
	return Suggestion{Confidence: ConfidenceNone}
}

func trigramSet(s string) map[string]struct{} {
	r := []rune(" " + s + " ")
	set := make(map[string]struct{})
	for i := 0; i+3 <= len(r); i++ {
		set[string(r[i:i+3])] = struct{}{}
	}
	return set
}

// trigramSimilarity is the Dice coefficient over character trigrams (0..1).
func trigramSimilarity(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	ta, tb := trigramSet(a), trigramSet(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	inter := 0
	for t := range ta {
		if _, ok := tb[t]; ok {
			inter++
		}
	}
	return 2 * float64(inter) / float64(len(ta)+len(tb))
}
```

- [ ] **Step 8.4: Run to verify pass**

Run: `cd server && go test ./internal/importer/ -v`
Expected: PASS (all importer tests).

- [ ] **Step 8.5: Tidy modules (x/text becomes direct) and commit**

```bash
cd server && go mod tidy && go build ./...
git add server/internal/importer/categorize.go server/internal/importer/categorize_test.go server/go.mod server/go.sum
git commit -m "feat: tiered payee categorizer (exact/prefix/trigram-fuzzy)"
```

Expected: `go.mod` now lists `golang.org/x/text` as a direct require.

---

# Part D — Import persistence, service, and HTTP

## Task 9: Import models

**Files:**
- Create: `server/internal/model/payee_rule.go`
- Create: `server/internal/model/import.go`

- [ ] **Step 9.1: Create payee_rule.go**

Create `server/internal/model/payee_rule.go`:

```go
package model

type PayeeRule struct {
	ID         string
	Pattern    string
	CategoryID string
	MatchCount int
}
```

- [ ] **Step 9.2: Create import.go (preview/confirm DTOs)**

Create `server/internal/model/import.go`:

```go
package model

type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type ImportFileInfo struct {
	Filename         string    `json:"filename"`
	Currency         string    `json:"currency"`
	IBAN             string    `json:"iban"`
	OpeningBalance   int64     `json:"opening_balance"`
	AvailableBalance int64     `json:"available_balance"`
	StatementDate    string    `json:"statement_date"`
	TransactionCount int       `json:"transaction_count"`
	DateRange        DateRange `json:"date_range"`
	TotalInflow      int64     `json:"total_inflow"`
	TotalOutflow     int64     `json:"total_outflow"`
	CurrencyMismatch bool      `json:"currency_mismatch"`
}

type PreviewTxn struct {
	TempID                string  `json:"temp_id"`
	Date                  string  `json:"date"`
	Amount                int64   `json:"amount"`
	DescriptionRaw        string  `json:"description_raw"`
	DescriptionNormalized string  `json:"description_normalized"`
	Reference             string  `json:"reference"`
	TransactionCode       string  `json:"transaction_code"`
	Balance               int64   `json:"balance"`
	SuggestedCategoryID   *string `json:"suggested_category_id"`
	SuggestedConfidence   string  `json:"suggested_confidence"`
	DuplicateOf           *string `json:"duplicate_of"`
	IsTransfer            bool    `json:"is_transfer"`
}

type PreviewResponse struct {
	FileInfo     ImportFileInfo `json:"file_info"`
	Transactions []PreviewTxn   `json:"transactions"`
}

type ConfirmTxnReq struct {
	Include        bool    `json:"include"`
	Date           string  `json:"date"`
	Amount         int64   `json:"amount"`
	DescriptionRaw string  `json:"description_raw"`
	Reference      string  `json:"reference"`
	CategoryID     *string `json:"category_id"`
	PayeeOverride  *string `json:"payee_override"`
	Memo           *string `json:"memo"`
}

type ConfirmReq struct {
	AccountID    string          `json:"account_id"`
	Filename     string          `json:"filename"`
	Transactions []ConfirmTxnReq `json:"transactions"`
}

type ConfirmResponse struct {
	ImportID        string `json:"import_id"`
	ImportedCount   int    `json:"imported_count"`
	SkippedCount    int    `json:"skipped_count"`
	NewRulesCreated int    `json:"new_rules_created"`
	RulesUpdated    int    `json:"rules_updated"`
}

type ImportRecord struct {
	ID               string `json:"id"`
	AccountID        string `json:"account_id"`
	Filename         string `json:"filename"`
	ImportedAt       string `json:"imported_at"`
	TransactionCount int    `json:"transaction_count"`
	Status           string `json:"status"`
}
```

- [ ] **Step 9.3: Build and commit**

```bash
cd server && go build ./... && cd ..
git add server/internal/model/payee_rule.go server/internal/model/import.go
git commit -m "feat: import + payee-rule models and preview/confirm DTOs"
```

---

## Task 10: Payee rule repository

**Files:**
- Create: `server/internal/repository/payee_rule_repo.go`

- [ ] **Step 10.1: Create the repo**

Create `server/internal/repository/payee_rule_repo.go`:

```go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type PayeeRuleRepo struct{ pool *pgxpool.Pool }

func NewPayeeRuleRepo(pool *pgxpool.Pool) *PayeeRuleRepo { return &PayeeRuleRepo{pool: pool} }

// List returns all payee rules for the categorizer to match against.
func (r *PayeeRuleRepo) List(ctx context.Context) ([]model.PayeeRule, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, payee_pattern, category_id::text, match_count
		FROM payee_rules
	`)
	if err != nil {
		return nil, fmt.Errorf("list payee rules: %w", err)
	}
	defer rows.Close()
	var out []model.PayeeRule
	for rows.Next() {
		var p model.PayeeRule
		if err := rows.Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount); err != nil {
			return nil, fmt.Errorf("scan payee rule: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Learn upserts a rule for a normalized pattern within an existing transaction.
// Returns created=true if a new rule was inserted, false if an existing one was
// updated (category reassigned, match_count incremented).
func (r *PayeeRuleRepo) Learn(ctx context.Context, tx pgx.Tx, pattern, categoryID string) (bool, error) {
	var created bool
	err := tx.QueryRow(ctx, `
		INSERT INTO payee_rules (payee_pattern, category_id, match_count, last_used_at)
		VALUES ($1, $2, 1, NOW())
		ON CONFLICT (payee_pattern) DO UPDATE
		SET category_id  = EXCLUDED.category_id,
		    match_count  = payee_rules.match_count + 1,
		    last_used_at = NOW(),
		    updated_at   = NOW()
		RETURNING (xmax = 0) AS created
	`, pattern, categoryID).Scan(&created)
	if err != nil {
		return false, fmt.Errorf("learn payee rule: %w", err)
	}
	return created, nil
}
```

- [ ] **Step 10.2: Build and commit**

```bash
cd server && go build ./... && cd ..
git add server/internal/repository/payee_rule_repo.go
git commit -m "feat: payee rule repository with upsert-based learning"
```

---

## Task 11: Import repository

**Files:**
- Create: `server/internal/repository/import_repo.go`

- [ ] **Step 11.1: Create the repo**

Create `server/internal/repository/import_repo.go`:

```go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type ImportRepo struct{ pool *pgxpool.Pool }

func NewImportRepo(pool *pgxpool.Pool) *ImportRepo { return &ImportRepo{pool: pool} }

// DupCandidate is an existing transaction with the same account, date, and amount
// as an incoming row. The service narrows these to true duplicates by comparing
// normalized descriptions and references.
type DupCandidate struct {
	ID        string
	Payee     string
	Reference string
}

func (r *ImportRepo) DupCandidates(ctx context.Context, accountID, date string, amount int64) ([]DupCandidate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(payee,''), COALESCE(check_number,'')
		FROM transactions
		WHERE account_id = $1 AND date = $2 AND amount = $3
	`, accountID, date, amount)
	if err != nil {
		return nil, fmt.Errorf("dup candidates: %w", err)
	}
	defer rows.Close()
	var out []DupCandidate
	for rows.Next() {
		var c DupCandidate
		if err := rows.Scan(&c.ID, &c.Payee, &c.Reference); err != nil {
			return nil, fmt.Errorf("scan dup candidate: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateImport inserts the imports row within the confirm transaction.
func (r *ImportRepo) CreateImport(ctx context.Context, tx pgx.Tx, accountID, filename string, count int) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO imports (account_id, filename, transaction_count, status)
		VALUES ($1, $2, $3, 'completed')
		RETURNING id::text
	`, accountID, filename, count).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create import: %w", err)
	}
	return id, nil
}

// InsertImportedTxn inserts one imported transaction within the confirm transaction.
// categoryID is nil for uncategorized; exchange_rate is left NULL (deferred).
func (r *ImportRepo) InsertImportedTxn(
	ctx context.Context, tx pgx.Tx,
	accountID, importID, date string, amount int64, currency, payee, reference string,
	categoryID *string, memo *string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO transactions
			(account_id, category_id, date, amount, currency, payee, check_number, memo, import_id, cleared)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), $8, $9, false)
	`, accountID, categoryID, date, amount, currency, payee, reference, memo, importID)
	if err != nil {
		return fmt.Errorf("insert imported txn: %w", err)
	}
	return nil
}

// List returns import history, newest first.
func (r *ImportRepo) List(ctx context.Context) ([]model.ImportRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, account_id::text, filename, imported_at::text, transaction_count, status
		FROM imports
		ORDER BY imported_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list imports: %w", err)
	}
	defer rows.Close()
	var out []model.ImportRecord
	for rows.Next() {
		var m model.ImportRecord
		if err := rows.Scan(&m.ID, &m.AccountID, &m.Filename, &m.ImportedAt, &m.TransactionCount, &m.Status); err != nil {
			return nil, fmt.Errorf("scan import: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
```

- [ ] **Step 11.2: Build and commit**

```bash
cd server && go build ./... && cd ..
git add server/internal/repository/import_repo.go
git commit -m "feat: import repository (dup candidates, create import, insert txn, history)"
```

---

## Task 12: Import service (preview + confirm)

**Files:**
- Create: `server/internal/service/import_service.go`

- [ ] **Step 12.1: Create the service**

Create `server/internal/service/import_service.go`:

```go
package service

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/importer"
	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

// ImportService orchestrates the parse → categorize → preview and the confirm/commit
// flows. Parsing and categorization live in the pure importer package; this service
// adds the database.
type ImportService struct {
	pool        *pgxpool.Pool
	accountRepo *repository.AccountRepo
	ruleRepo    *repository.PayeeRuleRepo
	importRepo  *repository.ImportRepo
}

func NewImportService(
	pool *pgxpool.Pool,
	accountRepo *repository.AccountRepo,
	ruleRepo *repository.PayeeRuleRepo,
	importRepo *repository.ImportRepo,
) *ImportService {
	return &ImportService{pool: pool, accountRepo: accountRepo, ruleRepo: ruleRepo, importRepo: importRepo}
}

// Preview parses the uploaded file, categorizes each row, flags duplicates and
// transfers, and returns the preview. It performs no writes.
func (s *ImportService) Preview(ctx context.Context, accountID, filename string, file io.Reader) (model.PreviewResponse, error) {
	account, err := s.accountRepo.Get(ctx, accountID)
	if err != nil {
		return model.PreviewResponse{}, err
	}

	stmt, err := importer.BACCSVParser{}.Parse(file)
	if err != nil {
		return model.PreviewResponse{}, fmt.Errorf("parse statement: %w", err)
	}

	dbRules, err := s.ruleRepo.List(ctx)
	if err != nil {
		return model.PreviewResponse{}, err
	}
	rules := make([]importer.Rule, len(dbRules))
	for i, r := range dbRules {
		rules[i] = importer.Rule{Pattern: r.Pattern, CategoryID: r.CategoryID}
	}

	var (
		txns                      = make([]model.PreviewTxn, 0, len(stmt.Transactions))
		totalIn, totalOut         int64
		minDate, maxDate          string
	)
	for i, pt := range stmt.Transactions {
		norm := importer.Normalize(pt.DescriptionRaw)
		sug := importer.Categorize(norm, rules)

		var sugID *string
		if sug.CategoryID != "" {
			id := sug.CategoryID
			sugID = &id
		}

		dupID, err := s.findDuplicate(ctx, accountID, pt.Date, pt.Amount, norm, pt.Reference)
		if err != nil {
			return model.PreviewResponse{}, err
		}

		txns = append(txns, model.PreviewTxn{
			TempID:                fmt.Sprintf("tmp_%d", i+1),
			Date:                  pt.Date,
			Amount:                pt.Amount,
			DescriptionRaw:        pt.DescriptionRaw,
			DescriptionNormalized: norm,
			Reference:             pt.Reference,
			TransactionCode:       pt.TransactionCode,
			Balance:               pt.RunningBalance,
			SuggestedCategoryID:   sugID,
			SuggestedConfidence:   string(sug.Confidence),
			DuplicateOf:           dupID,
			IsTransfer:            pt.TransactionCode == "TF",
		})

		if pt.Amount < 0 {
			totalOut += pt.Amount
		} else {
			totalIn += pt.Amount
		}
		if minDate == "" || pt.Date < minDate {
			minDate = pt.Date
		}
		if maxDate == "" || pt.Date > maxDate {
			maxDate = pt.Date
		}
	}

	return model.PreviewResponse{
		FileInfo: model.ImportFileInfo{
			Filename:         filename,
			Currency:         stmt.Currency,
			IBAN:             stmt.IBAN,
			OpeningBalance:   stmt.OpeningBalance,
			AvailableBalance: stmt.AvailableBalance,
			StatementDate:    stmt.StatementDate,
			TransactionCount: len(txns),
			DateRange:        model.DateRange{From: minDate, To: maxDate},
			TotalInflow:      totalIn,
			TotalOutflow:     totalOut,
			CurrencyMismatch: stmt.Currency != "" && account.Currency != "" && stmt.Currency != account.Currency,
		},
		Transactions: txns,
	}, nil
}

// findDuplicate returns the id of an existing transaction that matches on account,
// date, amount, and (normalized description or reference), or nil.
func (s *ImportService) findDuplicate(ctx context.Context, accountID, date string, amount int64, norm, reference string) (*string, error) {
	cands, err := s.importRepo.DupCandidates(ctx, accountID, date, amount)
	if err != nil {
		return nil, err
	}
	for _, c := range cands {
		refMatch := reference != "" && c.Reference != "" && reference == c.Reference
		descMatch := importer.Normalize(c.Payee) == norm
		if refMatch || descMatch {
			id := c.ID
			return &id, nil
		}
	}
	return nil, nil
}

// Confirm commits the reviewed transactions, the import record, account balance,
// and learned payee rules in a single database transaction.
func (s *ImportService) Confirm(ctx context.Context, req model.ConfirmReq) (model.ConfirmResponse, error) {
	account, err := s.accountRepo.Get(ctx, req.AccountID)
	if err != nil {
		return model.ConfirmResponse{}, err
	}

	included := make([]model.ConfirmTxnReq, 0, len(req.Transactions))
	for _, t := range req.Transactions {
		if t.Include {
			included = append(included, t)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return model.ConfirmResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	importID, err := s.importRepo.CreateImport(ctx, tx, req.AccountID, req.Filename, len(included))
	if err != nil {
		return model.ConfirmResponse{}, err
	}

	var balanceDelta int64
	var newRules, updatedRules int

	for _, t := range included {
		payee := strings.TrimSpace(t.DescriptionRaw)
		if t.PayeeOverride != nil && *t.PayeeOverride != "" {
			payee = *t.PayeeOverride
		}

		if err := s.importRepo.InsertImportedTxn(
			ctx, tx, req.AccountID, importID, t.Date, t.Amount,
			account.Currency, payee, t.Reference, t.CategoryID, t.Memo,
		); err != nil {
			return model.ConfirmResponse{}, err
		}
		balanceDelta += t.Amount

		if t.CategoryID != nil && *t.CategoryID != "" {
			created, err := s.ruleRepo.Learn(ctx, tx, importer.Normalize(t.DescriptionRaw), *t.CategoryID)
			if err != nil {
				return model.ConfirmResponse{}, err
			}
			if created {
				newRules++
			} else {
				updatedRules++
			}
		}
	}

	if balanceDelta != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
			balanceDelta, req.AccountID,
		); err != nil {
			return model.ConfirmResponse{}, fmt.Errorf("update balance: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return model.ConfirmResponse{}, fmt.Errorf("commit: %w", err)
	}

	return model.ConfirmResponse{
		ImportID:        importID,
		ImportedCount:   len(included),
		SkippedCount:    len(req.Transactions) - len(included),
		NewRulesCreated: newRules,
		RulesUpdated:    updatedRules,
	}, nil
}
```

- [ ] **Step 12.2: Build and commit**

```bash
cd server && go build ./... && cd ..
git add server/internal/service/import_service.go
git commit -m "feat: import service — stateless preview and atomic confirm"
```

---

## Task 13: Import HTTP handlers + routes

**Files:**
- Create: `server/internal/handler/imports.go`
- Modify: `server/main.go` (wire repos/service/handler + routes)

- [ ] **Step 13.1: Create the handlers**

Create `server/internal/handler/imports.go`:

```go
package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

type ImportHandler struct {
	svc        *service.ImportService
	importRepo *repository.ImportRepo
}

func NewImportHandler(svc *service.ImportService, importRepo *repository.ImportRepo) *ImportHandler {
	return &ImportHandler{svc: svc, importRepo: importRepo}
}

// Preview handles POST /api/imports/preview (multipart: file, account_id).
func (h *ImportHandler) Preview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid multipart form")
		return
	}
	accountID := r.FormValue("account_id")
	if accountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "account_id is required")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "file is required")
		return
	}
	defer file.Close()

	resp, err := h.svc.Preview(r.Context(), accountID, header.Filename, file)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusBadRequest, "PARSE_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// Confirm handles POST /api/imports/confirm (JSON).
func (h *ImportHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	var req model.ConfirmReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.AccountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "account_id is required")
		return
	}
	resp, err := h.svc.Confirm(r.Context(), req)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// History handles GET /api/imports.
func (h *ImportHandler) History(w http.ResponseWriter, r *http.Request) {
	records, err := h.importRepo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	if records == nil {
		records = []model.ImportRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}
```

- [ ] **Step 13.2: Wire into main.go**

In `server/main.go`, add `"budgetapp/internal/service"` to the imports. In the repos block (after `catRepo`), add:

```go
	ruleRepo := repository.NewPayeeRuleRepo(pool)
	importRepo := repository.NewImportRepo(pool)
```

In the handlers block (after `cats`), add:

```go
	importSvc := service.NewImportService(pool, accountRepo, ruleRepo, importRepo)
	imports := handler.NewImportHandler(importSvc, importRepo)
```

After the category routes, add:

```go
	// Imports
	mux.HandleFunc("POST /api/imports/preview", imports.Preview)
	mux.HandleFunc("POST /api/imports/confirm", imports.Confirm)
	mux.HandleFunc("GET /api/imports", imports.History)
```

- [ ] **Step 13.3: Build**

Run: `cd server && go build ./...`
Expected: exits 0.

- [ ] **Step 13.4: Run the full test suite**

Run: `cd server && go test ./...`
Expected: PASS (importer tests; other packages report "no test files").

- [ ] **Step 13.5: Commit**

```bash
git add server/internal/handler/imports.go server/main.go
git commit -m "feat: wire import preview/confirm/history endpoints"
```

---

## Task 14: End-to-end manual verification

No automated DB tests exist in this project (no test-DB harness), so verify the wired endpoints against a running server.

**Files:** none (manual)

- [ ] **Step 14.1: Start Postgres and the server**

```bash
cd /home/Berny/budgetapp-ai
podman-compose up -d postgres
cd server && DATABASE_URL="postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" go run . &
```

Wait for `listening` in the log.

- [ ] **Step 14.2: Create a USD account and capture its id**

```bash
curl -s -X POST localhost:8080/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"BAC USD","type":"checking","currency":"USD","on_budget":true,"balance":0}' | tee /tmp/acct.json
```

Expected: 201 JSON with `"currency":"USD"` and `"balance":0`. Extract the `id`:

```bash
ACCT=$(python3 -c "import json;print(json.load(open('/tmp/acct.json'))['id'])")
echo "$ACCT"
```

- [ ] **Step 14.3: Preview the sample import**

```bash
curl -s -X POST localhost:8080/api/imports/preview \
  -F "account_id=$ACCT" \
  -F "file=@ejemplo_usd.csv" | python3 -m json.tool | head -40
```

Expected: `file_info.currency == "USD"`, `transaction_count == 12`, `currency_mismatch == false`; first transaction `amount == -36700`, `is_transfer == true`, `suggested_confidence == "NONE"`.

- [ ] **Step 14.4: Confirm an import of the first two rows**

```bash
curl -s -X POST localhost:8080/api/imports/confirm \
  -H 'Content-Type: application/json' \
  -d '{"account_id":"'"$ACCT"'","filename":"ejemplo_usd.csv","transactions":[
    {"include":true,"date":"2026-04-01","amount":-36700,"description_raw":"TEF A : 952432326","reference":"406471624","category_id":null,"payee_override":null,"memo":null},
    {"include":true,"date":"2026-04-10","amount":184616,"description_raw":"Invoice Telescoped 23-03 al 03","reference":"11320525","category_id":null,"payee_override":null,"memo":null}
  ]}' | python3 -m json.tool
```

Expected: `imported_count == 2`, `skipped_count == 0`.

- [ ] **Step 14.5: Verify balance and history**

```bash
curl -s "localhost:8080/api/accounts/$ACCT" | python3 -c "import json,sys;a=json.load(sys.stdin);print('balance',a['balance'])"
curl -s localhost:8080/api/imports | python3 -m json.tool
```

Expected: balance == `147916` (−36700 + 184616, USD cents → $1,479.16); one import record with `transaction_count == 2`.

- [ ] **Step 14.6: Verify duplicate detection**

Re-run the Step 14.3 preview. Expected: the rows matching the two confirmed transactions now show a non-null `duplicate_of`.

- [ ] **Step 14.7: Stop the server**

```bash
kill %1 2>/dev/null
```

- [ ] **Step 14.8: Record verification result**

If all expectations held, this part is done. If any failed, debug with the systematic-debugging skill before proceeding.

---

# Part E — Documentation reconciliation

## Task 15: Update the PRDs to match the implemented model

**Files:**
- Modify: `docs/prd/01-data-model.md` (Currency Strategy section, lines ~182–192)
- Modify: `docs/prd/03-multi-currency.md` (Core Principle 1, lines ~7–11)
- Modify: `docs/prd/08-api-design.md` (money convention notes; category route; confirm payload)
- Modify: `docs/prd/02-qif-import-and-auto-categorization.md` (stateless confirm; parser interface note)
- Modify: `docs/prd/11-implementation-roadmap.md` (Phase 2 ordering)

- [ ] **Step 15.1: Fix PRD 01 Currency Strategy**

In `docs/prd/01-data-model.md`, replace the **Currency Strategy** section so it states the native-currency model:

```markdown
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
```

- [ ] **Step 15.2: Fix PRD 03 Principle 1**

In `docs/prd/03-multi-currency.md`, replace Core Principle 1:

```markdown
1. **Native-currency storage** — Each account's balance and transactions are
   stored in minor units of that account's own currency (CRC centimos or USD
   cents), matching the bank statement exactly. CRC is canonical only for
   cross-account aggregation, computed at read time via each transaction's
   stamped exchange rate — storage is never converted.
```

- [ ] **Step 15.3: Fix PRD 08**

In `docs/prd/08-api-design.md`:
- Under **Conventions**, confirm the Money row reads "BIGINT minor units of the
  account currency" and add a note: "Responses include the resource's `currency`
  so the client can format; the API never sends pre-divided major units."
- In the **Categories** table, change the grouped-list description to point at
  `GET /api/category-groups` (the implemented route) rather than `GET /api/categories`.
- Under the **Import** section, add: "`/api/imports/confirm` is stateless — the
  client re-sends the reviewed transactions; the server does not persist preview
  state."

- [ ] **Step 15.4: Fix PRD 02**

In `docs/prd/02-qif-import-and-auto-categorization.md`:
- Replace the `POST /api/imports/confirm` request example with the stateless
  payload (each transaction carries `date`, `amount`, `description_raw`,
  `reference`, `category_id`, `payee_override`, `memo`, `include`).
- Add a note under **Server-Side Parsing**: "Parsing is implemented behind a
  format-agnostic `Parser` interface (`internal/importer`). BAC CSV is the first
  implementation; QIF/MT940/fixed-width and other banks are added as additional
  parsers without changing the categorizer or import service."
- Add a note at the top: "Filename retains the historical `qif` slug; the
  implemented first format is BAC CSV."

- [ ] **Step 15.5: Fix PRD 11 roadmap**

In `docs/prd/11-implementation-roadmap.md`, under **Phase 2**, insert a Step 2.0
before 2.1 and adjust scope:

```markdown
### Step 2.0: Money Model Reconciliation
- [x] Accounts/transactions API speaks native-currency minor units + `currency`
- [x] Remove the colones-at-boundary `÷×100` and the outflow/inflow API split
- [x] Frontend anti-corruption adapter in `api.ts`
- [x] Typed `repository.ErrNotFound` replaces string-matched error checks

### Step 2.1: CSV Parser
(Scope: BAC CSV first, behind a format-agnostic Parser interface. Exchange-rate
stamping is deferred to Step 2.4 — imported transactions leave exchange_rate NULL.)
```

- [ ] **Step 15.6: Commit**

```bash
git add docs/prd/
git commit -m "docs: reconcile PRDs with native-currency model and import design"
```

---

## Done

After Task 15, the branch `phase2-csv-import` contains: the native-currency money
boundary, typed errors, a fully unit-tested BAC CSV parser + normalizer +
categorizer, the import service and endpoints, and reconciled docs. Merge via the
finishing-a-development-branch skill.

**Deferred to later plans (not in this branch):** exchange-rate fetching/stamping
and the CRC/USD display toggle (roadmap 2.4–2.5), cross-account transfer linking,
and additional parsers (QIF/MT940/`.dat`, BCR).
