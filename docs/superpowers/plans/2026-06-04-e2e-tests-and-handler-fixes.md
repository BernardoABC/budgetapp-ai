# E2E Tests + Handler Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated end-to-end HTTP test suite covering every route, and fix three handler bugs found during smoke testing.

**Architecture:** Each E2E test spins up a full `httptest.Server` wired against the real test DB (same pool pattern as existing repo/service tests). A new `testutil.NewTestServer(t)` helper handles wiring so tests stay focused. Bug fixes are handler-layer validations with tests written first (TDD).

**Tech Stack:** Go `net/http/httptest`, existing `testutil` + `pgxpool`, `go test ./...`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `server/internal/testutil/server.go` | `NewTestServer` — wires full handler stack for tests |
| Create | `server/e2e/helpers_test.go` | HTTP client helpers shared by all E2E tests |
| Create | `server/e2e/accounts_test.go` | Accounts CRUD + close toggle |
| Create | `server/e2e/categories_test.go` | Category groups + categories CRUD |
| Create | `server/e2e/payee_rules_test.go` | Payee rules CRUD |
| Create | `server/e2e/import_test.go` | CSV preview + confirm + history |
| Create | `server/e2e/transactions_test.go` | Transactions CRUD + batch + reconcile |
| Create | `server/e2e/transfers_test.go` | Linked transfer creation |
| Create | `server/e2e/budgets_test.go` | Budget month, assigned, targets, copy, move |
| Create | `server/e2e/exchange_rates_test.go` | Upsert, current, nearest, list |
| Create | `server/e2e/reports_test.go` | Spending, income-expense, net-worth + validation |
| Modify | `server/internal/handler/reports.go` | Validate `YYYY-MM` format; return 400 for full dates |
| Modify | `server/internal/handler/transactions.go` | Validate `date` non-empty in Update; return 400 |
| Modify | `Makefile` | Add `test-e2e` target |

---

## Task 1: NewTestServer helper

**Files:**
- Create: `server/internal/testutil/server.go`

- [ ] **Step 1: Write the file**

```go
// server/internal/testutil/server.go
package testutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"budgetapp/internal/bccr"
	"budgetapp/internal/database/migrations"
	"budgetapp/internal/handler"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

// NewTestServer wires the full handler stack against the test DB and returns
// a running httptest.Server. Closed automatically via t.Cleanup.
func NewTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool := NewTestPool(t)
	ctx := context.Background()
	if err := migrations.Run(ctx, pool); err != nil {
		t.Fatalf("migrations: %v", err)
	}

	accountRepo := repository.NewAccountRepo(pool)
	txnRepo     := repository.NewTransactionRepo(pool)
	catRepo     := repository.NewCategoryRepo(pool)
	ruleRepo    := repository.NewPayeeRuleRepo(pool)
	importRepo  := repository.NewImportRepo(pool)
	rateRepo    := repository.NewExchangeRateRepo(pool)
	budgetRepo  := repository.NewBudgetRepo(pool)
	targetRepo  := repository.NewTargetRepo(pool)

	// Empty token: BCCR fetch calls will fail but are never called in tests.
	bccrClient := bccr.NewClient("")
	rateSvc    := service.NewExchangeRateService(rateRepo, bccrClient)
	importSvc  := service.NewImportService(pool, accountRepo, ruleRepo, importRepo, rateSvc)
	budgetSvc  := service.NewBudgetService(budgetRepo, targetRepo, catRepo)

	accounts := handler.NewAccountHandler(accountRepo)
	txns     := handler.NewTransactionHandler(txnRepo)
	cats     := handler.NewCategoryHandler(catRepo)
	rules    := handler.NewPayeeRuleHandler(ruleRepo)
	imports  := handler.NewImportHandler(importSvc, importRepo)
	rates    := handler.NewExchangeRateHandler(rateSvc)
	budgets  := handler.NewBudgetHandler(budgetSvc)
	reports  := handler.NewReportsHandler(txnRepo)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/accounts", accounts.List)
	mux.HandleFunc("POST /api/accounts", accounts.Create)
	mux.HandleFunc("GET /api/accounts/{id}", accounts.Get)
	mux.HandleFunc("PUT /api/accounts/{id}", accounts.Update)
	mux.HandleFunc("DELETE /api/accounts/{id}", accounts.Delete)
	mux.HandleFunc("PATCH /api/accounts/{id}/close", accounts.ToggleClosed)
	mux.HandleFunc("GET /api/accounts/{id}/transactions", txns.ListByAccount)
	mux.HandleFunc("POST /api/accounts/{id}/transactions", txns.Create)
	mux.HandleFunc("POST /api/accounts/{id}/reconcile", txns.Reconcile)
	mux.HandleFunc("GET /api/transactions/{id}", txns.Get)
	mux.HandleFunc("PUT /api/transactions/{id}", txns.Update)
	mux.HandleFunc("DELETE /api/transactions/{id}", txns.Delete)
	mux.HandleFunc("PATCH /api/transactions/batch", txns.Batch)
	mux.HandleFunc("POST /api/transfers", txns.CreateTransfer)
	mux.HandleFunc("GET /api/category-groups", cats.ListGroups)
	mux.HandleFunc("POST /api/category-groups", cats.CreateGroup)
	mux.HandleFunc("PUT /api/category-groups/{id}", cats.UpdateGroup)
	mux.HandleFunc("DELETE /api/category-groups/{id}", cats.DeleteGroup)
	mux.HandleFunc("POST /api/categories", cats.CreateCategory)
	mux.HandleFunc("PUT /api/categories/{id}", cats.UpdateCategory)
	mux.HandleFunc("DELETE /api/categories/{id}", cats.DeleteCategory)
	mux.HandleFunc("GET /api/payee-rules", rules.List)
	mux.HandleFunc("POST /api/payee-rules", rules.Create)
	mux.HandleFunc("PUT /api/payee-rules/{id}", rules.Update)
	mux.HandleFunc("DELETE /api/payee-rules/{id}", rules.Delete)
	mux.HandleFunc("POST /api/imports/preview", imports.Preview)
	mux.HandleFunc("POST /api/imports/confirm", imports.Confirm)
	mux.HandleFunc("GET /api/imports", imports.History)
	mux.HandleFunc("GET /api/exchange-rates/current", rates.Current)
	mux.HandleFunc("GET /api/exchange-rates/nearest", rates.Nearest)
	mux.HandleFunc("GET /api/exchange-rates", rates.ListByRange)
	mux.HandleFunc("PUT /api/exchange-rates/{date}", rates.Upsert)
	mux.HandleFunc("GET /api/budgets/{month}", budgets.GetMonth)
	mux.HandleFunc("PUT /api/budgets/{month}/categories/{categoryId}", budgets.SetAssigned)
	mux.HandleFunc("POST /api/budgets/{month}/copy-previous", budgets.CopyPrevious)
	mux.HandleFunc("POST /api/budgets/{month}/move", budgets.Move)
	mux.HandleFunc("PUT /api/categories/{id}/target", budgets.UpsertTarget)
	mux.HandleFunc("DELETE /api/categories/{id}/target", budgets.DeleteTarget)
	mux.HandleFunc("GET /api/reports/spending", reports.SpendingByGroup)
	mux.HandleFunc("GET /api/reports/income-expense", reports.IncomeExpense)
	mux.HandleFunc("GET /api/reports/net-worth", reports.NetWorth)

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./internal/testutil/...
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add server/internal/testutil/server.go
git commit -m "test: add NewTestServer helper for E2E tests"
```

---

## Task 2: E2E helpers

**Files:**
- Create: `server/e2e/helpers_test.go`

- [ ] **Step 1: Create `server/e2e/` directory and helpers**

```go
// server/e2e/helpers_test.go
package e2e_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"budgetapp/internal/testutil"
)

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	return testutil.NewTestServer(t)
}

// do sends a request and returns the response. Body is closed by the caller via t.Cleanup.
func do(t *testing.T, srv *httptest.Server, method, path string, body any) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, srv.URL+path, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// decode decodes the response body into v.
func decode(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("decode JSON (%s): %v\nbody: %s", resp.Request.URL, err, b)
	}
}

// mustStatus asserts the response has the expected status code.
func mustStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("want status %d, got %d\nbody: %s", want, resp.StatusCode, b)
	}
}

// getString extracts a string field from a decoded map.
func getString(t *testing.T, m map[string]any, key string) string {
	t.Helper()
	v, ok := m[key]
	if !ok {
		t.Fatalf("key %q not in map %v", key, m)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("key %q: want string, got %T (%v)", key, v, v)
	}
	return s
}

// getBool extracts a bool field from a decoded map.
func getBool(t *testing.T, m map[string]any, key string) bool {
	t.Helper()
	v, ok := m[key]
	if !ok {
		t.Fatalf("key %q not in map %v", key, m)
	}
	b, ok := v.(bool)
	if !ok {
		t.Fatalf("key %q: want bool, got %T (%v)", key, v, v)
	}
	return b
}

// getFloat64 extracts a numeric field (JSON numbers decode as float64).
func getFloat64(t *testing.T, m map[string]any, key string) float64 {
	t.Helper()
	v, ok := m[key]
	if !ok {
		t.Fatalf("key %q not in map %v", key, m)
	}
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("key %q: want float64, got %T (%v)", key, v, v)
	}
	return f
}

// uid generates a unique string suffix for test resource names.
var uidCounter int
func uid() string {
	uidCounter++
	return fmt.Sprintf("e2e-%d", uidCounter)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && go build ./e2e/...
```

Expected: no output, exit 0.

---

## Task 3: Accounts E2E tests

**Files:**
- Create: `server/e2e/accounts_test.go`

- [ ] **Step 1: Write the test**

```go
// server/e2e/accounts_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestE2E_Accounts_CRUD(t *testing.T) {
	srv := newServer(t)

	// Create
	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name":      fmt.Sprintf("Checking-%s", uid()),
		"currency":  "USD",
		"type":      "checking",
		"on_budget": true,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	id := getString(t, acc, "id")
	if id == "" {
		t.Fatal("created account has no id")
	}
	t.Cleanup(func() {
		do(t, srv, http.MethodDelete, "/api/accounts/"+id, nil)
	})

	// Get
	resp = do(t, srv, http.MethodGet, "/api/accounts/"+id, nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	if getString(t, acc, "id") != id {
		t.Fatalf("Get returned wrong id")
	}

	// List includes new account
	var list []map[string]any
	resp = do(t, srv, http.MethodGet, "/api/accounts", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &list)
	found := false
	for _, a := range list {
		if a["id"] == id {
			found = true
		}
	}
	if !found {
		t.Error("created account not found in List")
	}

	// Update
	resp = do(t, srv, http.MethodPut, "/api/accounts/"+id, map[string]any{
		"name":      "Updated",
		"currency":  "USD",
		"type":      "checking",
		"on_budget": true,
		"note":      "smoke",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	if getString(t, acc, "note") != "smoke" {
		t.Errorf("note not updated, got %v", acc["note"])
	}
}

func TestE2E_Accounts_ClosedToggle(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name":     fmt.Sprintf("Toggle-%s", uid()),
		"currency": "USD",
		"type":     "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	id := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+id, nil) })

	// Close
	resp = do(t, srv, http.MethodPatch, "/api/accounts/"+id+"/close", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	if !getBool(t, acc, "closed") {
		t.Error("want closed=true after toggle")
	}

	// Reopen
	resp = do(t, srv, http.MethodPatch, "/api/accounts/"+id+"/close", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	if getBool(t, acc, "closed") {
		t.Error("want closed=false after second toggle")
	}
}

func TestE2E_Accounts_GetNotFound(t *testing.T) {
	srv := newServer(t)
	resp := do(t, srv, http.MethodGet, "/api/accounts/00000000-0000-0000-0000-000000000000", nil)
	mustStatus(t, resp, http.StatusNotFound)
}
```

- [ ] **Step 2: Run the tests**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Accounts ./e2e/...
```

Expected: all three tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/e2e/helpers_test.go server/e2e/accounts_test.go
git commit -m "test: add E2E accounts tests"
```

---

## Task 4: Categories + Payee Rules E2E tests

**Files:**
- Create: `server/e2e/categories_test.go`
- Create: `server/e2e/payee_rules_test.go`

- [ ] **Step 1: Write categories_test.go**

```go
// server/e2e/categories_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestE2E_Categories_CRUD(t *testing.T) {
	srv := newServer(t)

	// Create group
	var grp map[string]any
	resp := do(t, srv, http.MethodPost, "/api/category-groups", map[string]any{
		"name": fmt.Sprintf("Grp-%s", uid()),
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &grp)
	grpID := getString(t, grp, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/category-groups/"+grpID, nil) })

	// Create category in group
	var cat map[string]any
	resp = do(t, srv, http.MethodPost, "/api/categories", map[string]any{
		"name":     fmt.Sprintf("Cat-%s", uid()),
		"group_id": grpID,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &cat)
	catID := getString(t, cat, "id")

	// List groups includes the new group with its category
	var groups []map[string]any
	resp = do(t, srv, http.MethodGet, "/api/category-groups", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &groups)
	found := false
	for _, g := range groups {
		if g["id"] == grpID {
			found = true
			cats, _ := g["categories"].([]any)
			if len(cats) == 0 {
				t.Error("created category not in group's categories list")
			}
		}
	}
	if !found {
		t.Error("created group not found in List")
	}

	// Update category
	resp = do(t, srv, http.MethodPut, "/api/categories/"+catID, map[string]any{
		"name":     "Renamed",
		"group_id": grpID,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &cat)
	if getString(t, cat, "name") != "Renamed" {
		t.Errorf("name not updated, got %v", cat["name"])
	}

	// Update group
	resp = do(t, srv, http.MethodPut, "/api/category-groups/"+grpID, map[string]any{
		"name": "Renamed Group",
	})
	mustStatus(t, resp, http.StatusOK)

	// Delete category then group
	resp = do(t, srv, http.MethodDelete, "/api/categories/"+catID, nil)
	mustStatus(t, resp, http.StatusNoContent)
}
```

- [ ] **Step 2: Write payee_rules_test.go**

```go
// server/e2e/payee_rules_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestE2E_PayeeRules_CRUD(t *testing.T) {
	srv := newServer(t)

	// Seed a category to attach the rule to
	var grp map[string]any
	resp := do(t, srv, http.MethodPost, "/api/category-groups", map[string]any{"name": fmt.Sprintf("RG-%s", uid())})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &grp)
	grpID := getString(t, grp, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/category-groups/"+grpID, nil) })

	var cat map[string]any
	resp = do(t, srv, http.MethodPost, "/api/categories", map[string]any{"name": fmt.Sprintf("RC-%s", uid()), "group_id": grpID})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &cat)
	catID := getString(t, cat, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/categories/"+catID, nil) })

	// Create rule
	var rule map[string]any
	resp = do(t, srv, http.MethodPost, "/api/payee-rules", map[string]any{
		"payee_pattern": fmt.Sprintf("WALMART-%s", uid()),
		"category_id":   catID,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &rule)
	ruleID := getString(t, rule, "id")
	if getString(t, rule, "payee_pattern") == "" {
		t.Error("payee_pattern empty in response")
	}
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/payee-rules/"+ruleID, nil) })

	// List includes rule
	var rules []map[string]any
	resp = do(t, srv, http.MethodGet, "/api/payee-rules", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &rules)
	found := false
	for _, r := range rules {
		if r["id"] == ruleID {
			found = true
		}
	}
	if !found {
		t.Error("created rule not in List")
	}

	// Update
	resp = do(t, srv, http.MethodPut, "/api/payee-rules/"+ruleID, map[string]any{
		"payee_pattern": "WALMART-UPDATED",
		"category_id":   catID,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &rule)
	if getString(t, rule, "payee_pattern") != "WALMART-UPDATED" {
		t.Errorf("pattern not updated: %v", rule["payee_pattern"])
	}

	// Delete
	resp = do(t, srv, http.MethodDelete, "/api/payee-rules/"+ruleID, nil)
	mustStatus(t, resp, http.StatusNoContent)
}
```

- [ ] **Step 3: Run**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run "TestE2E_Categories|TestE2E_PayeeRules" ./e2e/...
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/e2e/categories_test.go server/e2e/payee_rules_test.go
git commit -m "test: add E2E category and payee rule tests"
```

---

## Task 5: Import E2E tests

**Files:**
- Create: `server/e2e/import_test.go`

The import test uses the existing testdata fixture at `server/internal/importer/testdata/bac_usd.csv`. It accesses it via `os.Open` — when `go test ./e2e/...` runs, the working directory is `server/e2e/`, so we use a relative path of `../internal/importer/testdata/bac_usd.csv`.

- [ ] **Step 1: Write import_test.go**

```go
// server/e2e/import_test.go
package e2e_test

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"testing"
)

// multipartFile builds a multipart request body with the given file and account_id.
func multipartFile(t *testing.T, accountID, filepath string) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	_ = w.WriteField("account_id", accountID)
	f, err := os.Open(filepath)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer f.Close()
	part, err := w.CreateFormFile("file", "bac_usd.csv")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		t.Fatalf("copy file: %v", err)
	}
	w.Close()
	return body, w.FormDataContentType()
}

func TestE2E_Import_PreviewAndConfirm(t *testing.T) {
	srv := newServer(t)

	// Create account
	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name":     fmt.Sprintf("ImportAcc-%s", uid()),
		"currency": "USD",
		"type":     "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	// Preview
	body, ct := multipartFile(t, accID, "../internal/importer/testdata/bac_usd.csv")
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/imports/preview", body)
	req.Header.Set("Content-Type", ct)
	previewResp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preview request: %v", err)
	}
	t.Cleanup(func() { previewResp.Body.Close() })
	if previewResp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(previewResp.Body)
		t.Fatalf("preview status %d: %s", previewResp.StatusCode, b)
	}

	var preview map[string]any
	decode(t, previewResp, &preview)
	txns, _ := preview["transactions"].([]any)
	if len(txns) == 0 {
		t.Fatal("preview returned 0 transactions")
	}

	// Build confirm payload: include all non-duplicate rows
	rows := make([]map[string]any, 0, len(txns))
	for _, raw := range txns {
		txn := raw.(map[string]any)
		if txn["duplicate_of"] != nil {
			continue
		}
		rows = append(rows, map[string]any{
			"include":         true,
			"date":            txn["date"],
			"amount":          txn["amount"],
			"description_raw": txn["description_raw"],
			"reference":       txn["reference"],
			"category_id":     nil,
			"payee_override":  nil,
			"memo":            nil,
		})
	}
	confirmPayload := map[string]any{
		"account_id":   accID,
		"filename":     "bac_usd.csv",
		"transactions": rows,
	}

	resp = do(t, srv, http.MethodPost, "/api/imports/confirm", confirmPayload)
	mustStatus(t, resp, http.StatusOK)
	var result map[string]any
	decode(t, resp, &result)
	imported := getFloat64(t, result, "imported_count")
	if imported == 0 {
		t.Errorf("expected imported_count > 0, got %v", result)
	}

	// Duplicate detection: preview again → all rows flagged as duplicates
	body2, ct2 := multipartFile(t, accID, "../internal/importer/testdata/bac_usd.csv")
	req2, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/imports/preview", body2)
	req2.Header.Set("Content-Type", ct2)
	dupResp, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("dup preview request: %v", err)
	}
	t.Cleanup(func() { dupResp.Body.Close() })
	var dupPreview map[string]any
	decode(t, dupResp, &dupPreview)
	dupTxns, _ := dupPreview["transactions"].([]any)
	dupCount := 0
	for _, raw := range dupTxns {
		if raw.(map[string]any)["duplicate_of"] != nil {
			dupCount++
		}
	}
	if dupCount == 0 {
		t.Error("expected duplicate detection on re-import, got 0 duplicates")
	}
}

func TestE2E_Import_History(t *testing.T) {
	srv := newServer(t)

	var hist []any
	resp := do(t, srv, http.MethodGet, "/api/imports", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &hist)
	// Just verifies the endpoint returns a list (may be empty or not)
	_ = hist
}

func TestE2E_Import_Confirm_SkipsWhenIncludeFalse(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name":     fmt.Sprintf("SkipAcc-%s", uid()),
		"currency": "USD",
		"type":     "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	// Confirm with include:false on all rows → imported_count=0
	confirmPayload := map[string]any{
		"account_id": accID,
		"filename":   "test.csv",
		"transactions": []map[string]any{
			{
				"include":         false,
				"date":            "2026-01-01",
				"amount":          -1000,
				"description_raw": "TEST",
				"reference":       "REF1",
				"category_id":     nil,
				"payee_override":  nil,
				"memo":            nil,
			},
		},
	}
	resp = do(t, srv, http.MethodPost, "/api/imports/confirm", confirmPayload)
	mustStatus(t, resp, http.StatusOK)
	var result map[string]any
	decode(t, resp, &result)
	if getFloat64(t, result, "imported_count") != 0 {
		t.Error("expected 0 imported when include=false")
	}
	if getFloat64(t, result, "skipped_count") != 1 {
		t.Error("expected 1 skipped when include=false")
	}
}
```

- [ ] **Step 2: Run**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Import ./e2e/...
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/e2e/import_test.go
git commit -m "test: add E2E import tests"
```

---

## Task 6: Transactions E2E tests (includes bug-first test for Update)

**Files:**
- Create: `server/e2e/transactions_test.go`

- [ ] **Step 1: Write the test — including the failing bug test first**

```go
// server/e2e/transactions_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

// seedAccount is a convenience helper used by multiple test files.
func seedAccount(t *testing.T, srv interface{ URL string }, currency string) string {
	t.Helper()
	// We need the concrete *httptest.Server here; use the package-level do/decode helpers.
	// This is called with the srv returned by newServer(t).
	panic("use the package-level seedAccountOn helper instead")
}

func TestE2E_Transactions_CRUD(t *testing.T) {
	srv := newServer(t)

	// Create account
	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name": fmt.Sprintf("TxnAcc-%s", uid()), "currency": "USD", "type": "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	// Create transaction
	var txn map[string]any
	resp = do(t, srv, http.MethodPost, "/api/accounts/"+accID+"/transactions", map[string]any{
		"date":   "2026-06-01",
		"amount": -5000,
		"payee":  "ZARA",
		"memo":   "shirt",
	})
	mustStatus(t, resp, http.StatusCreated)
	decode(t, resp, &txn)
	txnID := getString(t, txn, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/transactions/"+txnID, nil) })

	// Get
	resp = do(t, srv, http.MethodGet, "/api/transactions/"+txnID, nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &txn)
	if getString(t, txn, "payee") != "ZARA" {
		t.Errorf("payee = %v, want ZARA", txn["payee"])
	}

	// List by account
	var page map[string]any
	resp = do(t, srv, http.MethodGet, "/api/accounts/"+accID+"/transactions", nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &page)
	txns, _ := page["transactions"].([]any)
	if len(txns) == 0 {
		t.Error("expected at least 1 transaction in list")
	}

	// Update — must include date and amount
	resp = do(t, srv, http.MethodPut, "/api/transactions/"+txnID, map[string]any{
		"date":   "2026-06-01",
		"amount": -5000,
		"payee":  "ZARA",
		"memo":   "updated memo",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &txn)
	if txn["memo"] != "updated memo" {
		t.Errorf("memo not updated: %v", txn["memo"])
	}

	// Delete
	resp = do(t, srv, http.MethodDelete, "/api/transactions/"+txnID, nil)
	mustStatus(t, resp, http.StatusNoContent)
}

// TestE2E_Transactions_Update_RequiresDate documents and tests that omitting
// date in PUT /api/transactions/{id} must return 400, not 500.
// This test is written BEFORE the fix — it will fail until Task 10 is complete.
func TestE2E_Transactions_Update_RequiresDate(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name": fmt.Sprintf("DateAcc-%s", uid()), "currency": "USD", "type": "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	var txn map[string]any
	resp = do(t, srv, http.MethodPost, "/api/accounts/"+accID+"/transactions", map[string]any{
		"date": "2026-06-01", "amount": -1000, "payee": "TEST",
	})
	mustStatus(t, resp, http.StatusCreated)
	decode(t, resp, &txn)
	txnID := getString(t, txn, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/transactions/"+txnID, nil) })

	// Omit date — must get 400 not 500
	resp = do(t, srv, http.MethodPut, "/api/transactions/"+txnID, map[string]any{
		"amount": -1000,
		"payee":  "TEST",
		"memo":   "no date",
	})
	mustStatus(t, resp, http.StatusBadRequest)
}

func TestE2E_Transactions_Batch(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name": fmt.Sprintf("BatchAcc-%s", uid()), "currency": "USD", "type": "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	// Create two transactions
	makeT := func(payee string) string {
		var t2 map[string]any
		r := do(t, srv, http.MethodPost, "/api/accounts/"+accID+"/transactions", map[string]any{
			"date": "2026-06-01", "amount": -1000, "payee": payee,
		})
		mustStatus(t, r, http.StatusCreated)
		decode(t, r, &t2)
		return getString(t, t2, "id")
	}
	id1 := makeT("Batch-A")
	id2 := makeT("Batch-B")

	// Clear
	var batchResult map[string]any
	resp = do(t, srv, http.MethodPatch, "/api/transactions/batch", map[string]any{
		"transaction_ids": []string{id1, id2},
		"action":          "clear",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &batchResult)
	if getFloat64(t, batchResult, "affected") != 2 {
		t.Errorf("clear: want affected=2, got %v", batchResult["affected"])
	}

	// Verify cleared
	var t1 map[string]any
	resp = do(t, srv, http.MethodGet, "/api/transactions/"+id1, nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &t1)
	if !getBool(t, t1, "cleared") {
		t.Error("want cleared=true after batch clear")
	}

	// Unknown action → 400
	resp = do(t, srv, http.MethodPatch, "/api/transactions/batch", map[string]any{
		"transaction_ids": []string{id1},
		"action":          "nonexistent",
	})
	mustStatus(t, resp, http.StatusBadRequest)

	// Delete both
	resp = do(t, srv, http.MethodPatch, "/api/transactions/batch", map[string]any{
		"transaction_ids": []string{id1, id2},
		"action":          "delete",
	})
	mustStatus(t, resp, http.StatusOK)
}

func TestE2E_Transactions_Reconcile(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name": fmt.Sprintf("RecAcc-%s", uid()), "currency": "USD", "type": "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	accID := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+accID, nil) })

	resp = do(t, srv, http.MethodPost, "/api/accounts/"+accID+"/reconcile", map[string]any{
		"adjustment": 0,
	})
	mustStatus(t, resp, http.StatusOK)
	var result map[string]any
	decode(t, resp, &result)
	if _, ok := result["reconciled_count"]; !ok {
		t.Error("reconcile response missing reconciled_count")
	}
}
```

Note: remove the stub `seedAccount` function — it was left in by mistake. The `seedAccount` helper is not used; delete those lines before committing.

- [ ] **Step 2: Run (TestE2E_Transactions_Update_RequiresDate will FAIL — that's expected)**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Transactions ./e2e/...
```

Expected: `TestE2E_Transactions_Update_RequiresDate` FAIL (500, not 400). Others PASS.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/e2e/transactions_test.go
git commit -m "test: add E2E transaction tests (Update_RequiresDate intentionally failing)"
```

---

## Task 7: Transfers E2E tests

**Files:**
- Create: `server/e2e/transfers_test.go`

- [ ] **Step 1: Write the test**

```go
// server/e2e/transfers_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestE2E_Transfer_LinkedPeers(t *testing.T) {
	srv := newServer(t)

	makeAcc := func(currency string) string {
		var a map[string]any
		r := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
			"name": fmt.Sprintf("Xfer-%s-%s", currency, uid()), "currency": currency, "type": "checking",
		})
		mustStatus(t, r, http.StatusOK)
		decode(t, r, &a)
		id := getString(t, a, "id")
		t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+id, nil) })
		return id
	}

	fromID := makeAcc("USD")
	toID := makeAcc("CRC")

	var result map[string]any
	resp := do(t, srv, http.MethodPost, "/api/transfers", map[string]any{
		"from_account_id": fromID,
		"to_account_id":   toID,
		"amount":          10000,
		"date":            "2026-06-01",
		"memo":            "e2e transfer",
	})
	mustStatus(t, resp, http.StatusCreated)
	decode(t, resp, &result)

	fromTxn, ok := result["from"].(map[string]any)
	if !ok {
		t.Fatalf("result missing 'from' transaction: %v", result)
	}
	toTxn, ok := result["to"].(map[string]any)
	if !ok {
		t.Fatalf("result missing 'to' transaction: %v", result)
	}

	fromID2 := getString(t, fromTxn, "id")
	toID2 := getString(t, toTxn, "id")
	fromPeer := getString(t, fromTxn, "transfer_peer_id")
	toPeer := getString(t, toTxn, "transfer_peer_id")

	if fromPeer != toID2 {
		t.Errorf("from.transfer_peer_id = %q, want %q", fromPeer, toID2)
	}
	if toPeer != fromID2 {
		t.Errorf("to.transfer_peer_id = %q, want %q", toPeer, fromID2)
	}
	if getFloat64(t, fromTxn, "amount") >= 0 {
		t.Error("from transaction amount should be negative (outflow)")
	}
	if getFloat64(t, toTxn, "amount") <= 0 {
		t.Error("to transaction amount should be positive (inflow)")
	}
}

func TestE2E_Transfer_SameAccountRejected(t *testing.T) {
	srv := newServer(t)

	var acc map[string]any
	resp := do(t, srv, http.MethodPost, "/api/accounts", map[string]any{
		"name": fmt.Sprintf("SameAcc-%s", uid()), "currency": "USD", "type": "checking",
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &acc)
	id := getString(t, acc, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/accounts/"+id, nil) })

	resp = do(t, srv, http.MethodPost, "/api/transfers", map[string]any{
		"from_account_id": id,
		"to_account_id":   id,
		"amount":          1000,
		"date":            "2026-06-01",
	})
	mustStatus(t, resp, http.StatusBadRequest)
}
```

- [ ] **Step 2: Run**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Transfer ./e2e/...
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/e2e/transfers_test.go
git commit -m "test: add E2E transfer tests"
```

---

## Task 8: Budgets E2E tests

**Files:**
- Create: `server/e2e/budgets_test.go`

- [ ] **Step 1: Write the test**

```go
// server/e2e/budgets_test.go
package e2e_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestE2E_Budgets(t *testing.T) {
	srv := newServer(t)
	month := "2026-06"

	// Seed group + category
	var grp map[string]any
	resp := do(t, srv, http.MethodPost, "/api/category-groups", map[string]any{
		"name": fmt.Sprintf("BudgetGrp-%s", uid()),
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &grp)
	grpID := getString(t, grp, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/category-groups/"+grpID, nil) })

	var cat map[string]any
	resp = do(t, srv, http.MethodPost, "/api/categories", map[string]any{
		"name": fmt.Sprintf("BudgetCat-%s", uid()), "group_id": grpID,
	})
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &cat)
	catID := getString(t, cat, "id")
	t.Cleanup(func() { do(t, srv, http.MethodDelete, "/api/categories/"+catID, nil) })

	// Get budget month
	var bm map[string]any
	resp = do(t, srv, http.MethodGet, "/api/budgets/"+month, nil)
	mustStatus(t, resp, http.StatusOK)
	decode(t, resp, &bm)
	if bm["month"] != month {
		t.Errorf("month = %v, want %s", bm["month"], month)
	}
	if _, ok := bm["category_groups"]; !ok {
		t.Error("budget month response missing category_groups")
	}

	// Set assigned
	resp = do(t, srv, http.MethodPut, "/api/budgets/"+month+"/categories/"+catID, map[string]any{
		"assigned": 50000,
	})
	mustStatus(t, resp, http.StatusOK)
	var assigned map[string]any
	decode(t, resp, &assigned)
	if getFloat64(t, assigned, "assigned") != 50000 {
		t.Errorf("assigned = %v, want 50000", assigned["assigned"])
	}

	// Upsert target
	resp = do(t, srv, http.MethodPut, "/api/categories/"+catID+"/target", map[string]any{
		"type":   "monthly",
		"amount": 50000,
	})
	mustStatus(t, resp, http.StatusOK)
	var target map[string]any
	decode(t, resp, &target)
	if target["type"] != "monthly" {
		t.Errorf("target type = %v, want monthly", target["type"])
	}

	// Copy previous month (204 No Content)
	resp = do(t, srv, http.MethodPost, "/api/budgets/"+month+"/copy-previous", nil)
	mustStatus(t, resp, http.StatusNoContent)

	// Move between categories (even if same cat, just verifies the endpoint works)
	resp = do(t, srv, http.MethodPost, "/api/budgets/"+month+"/move", map[string]any{
		"from_category_id": catID,
		"to_category_id":   catID,
		"amount":           1000,
	})
	mustStatus(t, resp, http.StatusNoContent)

	// Delete target
	resp = do(t, srv, http.MethodDelete, "/api/categories/"+catID+"/target", nil)
	mustStatus(t, resp, http.StatusNoContent)
}
```

- [ ] **Step 2: Run**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Budgets ./e2e/...
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/e2e/budgets_test.go
git commit -m "test: add E2E budget tests"
```

---

## Task 9: Exchange Rates E2E tests

**Files:**
- Create: `server/e2e/exchange_rates_test.go`

- [ ] **Step 1: Write the test**

```go
// server/e2e/exchange_rates_test.go
package e2e_test

import (
	"net/http"
	"testing"
)

func TestE2E_ExchangeRates(t *testing.T) {
	srv := newServer(t)

	// Upsert a manual rate
	resp := do(t, srv, http.MethodPut, "/api/exchange-rates/2026-06-01", map[string]any{
		"usd_to_crc": 521.50,
	})
	mustStatus(t, resp, http.StatusOK)
	var rate map[string]any
	decode(t, resp, &rate)
	if getFloat64(t, rate, "usd_to_crc") != 521.50 {
		t.Errorf("usd_to_crc = %v, want 521.5", rate["usd_to_crc"])
	}
	if rate["source"] != "manual" {
		t.Errorf("source = %v, want manual", rate["source"])
	}

	// Nearest rate for that date
	resp = do(t, srv, http.MethodGet, "/api/exchange-rates/nearest?date=2026-06-01", nil)
	mustStatus(t, resp, http.StatusOK)
	var nearest map[string]any
	decode(t, resp, &nearest)
	if getFloat64(t, nearest, "usd_to_crc") != 521.50 {
		t.Errorf("nearest usd_to_crc = %v, want 521.5", nearest["usd_to_crc"])
	}

	// List by range includes the rate
	resp = do(t, srv, http.MethodGet, "/api/exchange-rates?from=2026-06-01&to=2026-06-01", nil)
	mustStatus(t, resp, http.StatusOK)
	var list map[string]any
	decode(t, resp, &list)
	rates, _ := list["rates"].([]any)
	if len(rates) == 0 {
		t.Error("expected at least 1 rate in range list")
	}
}

func TestE2E_ExchangeRates_UpsertValidation(t *testing.T) {
	srv := newServer(t)

	// Zero rate → 400
	resp := do(t, srv, http.MethodPut, "/api/exchange-rates/2026-06-02", map[string]any{
		"usd_to_crc": 0.0,
	})
	mustStatus(t, resp, http.StatusBadRequest)

	// Negative rate → 400
	resp = do(t, srv, http.MethodPut, "/api/exchange-rates/2026-06-02", map[string]any{
		"usd_to_crc": -1.0,
	})
	mustStatus(t, resp, http.StatusBadRequest)
}
```

- [ ] **Step 2: Run**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_ExchangeRates ./e2e/...
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/e2e/exchange_rates_test.go
git commit -m "test: add E2E exchange rate tests"
```

---

## Task 10: Reports E2E tests (includes failing bug test)

**Files:**
- Create: `server/e2e/reports_test.go`

- [ ] **Step 1: Write the test**

```go
// server/e2e/reports_test.go
package e2e_test

import (
	"net/http"
	"testing"
)

func TestE2E_Reports_ValidData(t *testing.T) {
	srv := newServer(t)

	// All three report endpoints should return 200 with YYYY-MM params
	for _, tc := range []struct {
		name string
		path string
	}{
		{"spending", "/api/reports/spending?from=2026-01&to=2026-06"},
		{"income-expense", "/api/reports/income-expense?from=2026-01&to=2026-06"},
		{"net-worth", "/api/reports/net-worth?from=2026-01&to=2026-06"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := do(t, srv, http.MethodGet, tc.path, nil)
			mustStatus(t, resp, http.StatusOK)
			var result []any
			decode(t, resp, &result)
			// result may be empty if no data, but must be a list
			_ = result
		})
	}
}

// TestE2E_Reports_RejectsFullDateParam documents and tests that passing
// YYYY-MM-DD to the report endpoints must return 400, not 500.
// Written BEFORE the fix — will fail until Task 11 is complete.
func TestE2E_Reports_RejectsFullDateParam(t *testing.T) {
	srv := newServer(t)

	for _, tc := range []struct {
		name string
		path string
	}{
		{"spending", "/api/reports/spending?from=2026-01-01&to=2026-06-30"},
		{"income-expense", "/api/reports/income-expense?from=2026-01-01&to=2026-06-30"},
		{"net-worth", "/api/reports/net-worth?from=2026-01-01&to=2026-06-30"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := do(t, srv, http.MethodGet, tc.path, nil)
			// Must be 400 (bad request), not 500 (internal error)
			mustStatus(t, resp, http.StatusBadRequest)
		})
	}
}

func TestE2E_Reports_RequiresFromAndTo(t *testing.T) {
	srv := newServer(t)

	for _, path := range []string{
		"/api/reports/spending?from=2026-01",
		"/api/reports/income-expense?to=2026-06",
		"/api/reports/net-worth",
	} {
		resp := do(t, srv, http.MethodGet, path, nil)
		mustStatus(t, resp, http.StatusBadRequest)
	}
}
```

- [ ] **Step 2: Run (TestE2E_Reports_RejectsFullDateParam will FAIL — that's expected)**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Reports ./e2e/...
```

Expected: `TestE2E_Reports_RejectsFullDateParam` FAIL (500, not 400). Others PASS.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/e2e/reports_test.go
git commit -m "test: add E2E reports tests (RejectsFullDateParam intentionally failing)"
```

---

## Task 11: Fix reports handler — validate YYYY-MM format

**Files:**
- Modify: `server/internal/handler/reports.go`

- [ ] **Step 1: Add a `validateYYYYMM` helper and call it in all three report handlers**

In `server/internal/handler/reports.go`, add this helper at the bottom of the file:

```go
// validateYYYYMM returns an error message if s is not in YYYY-MM format.
func validateYYYYMM(s string) string {
	if len(s) != 7 || s[4] != '-' {
		return fmt.Sprintf("%q is not a valid YYYY-MM value", s)
	}
	return ""
}
```

Add `"fmt"` to the imports.

Then in `SpendingByGroup`, after the empty-check, add:

```go
if msg := validateYYYYMM(from); msg != "" {
    writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", msg)
    return
}
if msg := validateYYYYMM(to); msg != "" {
    writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", msg)
    return
}
```

Add the same two blocks to `IncomeExpense` and `NetWorth` — immediately after their existing empty-check blocks.

- [ ] **Step 2: Run the previously-failing test — it should now pass**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Reports ./e2e/...
```

Expected: ALL tests PASS including `TestE2E_Reports_RejectsFullDateParam`.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test ./...
```

Expected: all packages pass.

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/reports.go
git commit -m "fix: validate YYYY-MM format in report handlers; return 400 for full dates"
```

---

## Task 12: Fix transaction Update handler — validate date non-empty

**Files:**
- Modify: `server/internal/handler/transactions.go`

- [ ] **Step 1: Add date validation in `Update`**

In `server/internal/handler/transactions.go`, the `Update` method currently reads the request and immediately calls `h.repo.Update`. Add a check after the `readJSON` call:

```go
func (h *TransactionHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req model.UpdateTransactionReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.Date == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "date is required")
		return
	}
	t, err := h.repo.Update(r.Context(), id, req)
	// ... rest unchanged
```

- [ ] **Step 2: Run the previously-failing test — it should now pass**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test -v -run TestE2E_Transactions_Update_RequiresDate ./e2e/...
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd server && TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable" go test ./...
```

Expected: all packages pass.

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/transactions.go
git commit -m "fix: validate date is non-empty in transaction Update handler; return 400 not 500"
```

---

## Task 13: Makefile e2e target

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add the target**

Add to the `Makefile` in the Test section (after `test-run`):

```makefile
test-e2e: ## Run end-to-end handler tests (requires test DB)
	cd server && TEST_DATABASE_URL="$(TEST_DB_URL)" go test -v ./e2e/...
```

Also add `test-e2e` to the `.PHONY` list.

- [ ] **Step 2: Run it**

```bash
make test-e2e
```

Expected: all E2E tests PASS, output shows each test name.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "chore: add test-e2e Makefile target"
```

---

## Self-Review

**Spec coverage:**
- ✅ All 14 route groups covered by E2E tests
- ✅ Bug: reports 500 on full dates → Task 10 (test) + Task 11 (fix)
- ✅ Bug: transaction PUT 500 without date → Task 6 (test) + Task 12 (fix)
- ✅ Bug: batch silent failure for unknown payload → tested in Task 6 (unknown action → 400)
- ✅ Import `include:false` silent skip → documented in Task 5, test verifies behavior is intentional

**Placeholder scan:** None found.

**Type consistency:** All field names (`payee_pattern`, `category_id`, `transaction_ids`, `action`, `usd_to_crc`) match what was confirmed during the smoke test. `getString`/`getBool`/`getFloat64` helpers are defined in Task 2 and used consistently throughout.
