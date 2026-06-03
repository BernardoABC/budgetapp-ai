# Exchange Rates + Currency Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch USD↔CRC rates from BCCR's REST API, stamp `transactions.exchange_rate` on import, expose rate endpoints, and wire the frontend to display live rates with a working CRC/USD toggle.

**Architecture:** A pure `internal/bccr` HTTP client feeds `ExchangeRateService`, which owns rate fetching, fallback logic, and daily caching. `ImportService` gains a dependency on `ExchangeRateService` and stamps each imported transaction's rate during `Confirm`. Three new API endpoints expose rates to the frontend. App.tsx replaces the static `AppData.exchangeRate` with a live fetch.

**Tech Stack:** Go 1.26, net/http, pgx/v5, `net/http/httptest` for client tests, React 19 + TypeScript, inline styles.

**Spec:** `docs/superpowers/specs/2026-06-02-exchange-rates-design.md`

---

## File Map

### New files
| File | Purpose |
|------|---------|
| `server/internal/bccr/client.go` | Pure BCCR HTTP client — FetchRates |
| `server/internal/bccr/client_test.go` | Unit tests with httptest mock server |
| `server/internal/model/exchange_rate.go` | ExchangeRate struct |
| `server/internal/repository/exchange_rate_repo.go` | DB layer for exchange_rates table |
| `server/internal/service/exchange_rate_service.go` | Business logic: EnsureRates, FetchAndStoreToday, GetCurrent, ListByRange, Upsert |
| `server/internal/handler/exchange_rates.go` | HTTP handlers for the 3 rate endpoints |

### Modified files
| File | Change |
|------|--------|
| `server/internal/config/config.go` | Add `BCCRAPIToken` field |
| `server/internal/model/transaction.go` | Add `ExchangeRate *float64` field |
| `server/internal/repository/transaction_repo.go` | Add `exchange_rate` to SELECT in ListByAccount + Get |
| `server/internal/handler/transactions.go` | Add `exchange_rate` to JSON response |
| `server/internal/repository/import_repo.go` | `InsertImportedTxn` gains `exchangeRate *float64` param |
| `server/internal/service/import_service.go` | Add `rateSvc` field, call `EnsureRates` in `Confirm` |
| `server/main.go` | Wire new repo/service/handler, add startup goroutine + daily ticker |
| `frontend/src/api.ts` | Add `fetchCurrentRate`, `fetchRates`, `upsertRate`; expose `exchange_rate` in transaction fetch |
| `frontend/src/data.ts` | Add `exchange_rate?: number \| null` to `Transaction` |
| `frontend/src/App.tsx` | Fetch live rate on mount, replace `AppData.exchangeRate`; remove `defaultCurrency` from tweaks |

---

## Task 1: ExchangeRate model + Transaction model update

**Files:**
- Create: `server/internal/model/exchange_rate.go`
- Modify: `server/internal/model/transaction.go`

- [ ] **Step 1.1: Create the ExchangeRate model**

```go
// server/internal/model/exchange_rate.go
package model

type ExchangeRate struct {
	ID        string
	Date      string  // YYYY-MM-DD
	USDToCRC  float64
	Source    string  // "BCCR", "open_er_api", "manual"
	CreatedAt string
}
```

- [ ] **Step 1.2: Add ExchangeRate field to Transaction**

Open `server/internal/model/transaction.go` and add one field after `Cleared`:

```go
type Transaction struct {
	ID           string
	AccountID    string
	CategoryID   string
	CategoryName string
	Date         string
	Amount       int64
	Currency     string
	Payee        string
	Memo         string
	Cleared      bool
	ExchangeRate *float64 // nil if not stamped
}
```

- [ ] **Step 1.3: Commit**

```bash
git add server/internal/model/
git commit -m "feat: add ExchangeRate model and ExchangeRate field on Transaction"
```

---

## Task 2: Config — add BCCRAPIToken

**Files:**
- Modify: `server/internal/config/config.go`

- [ ] **Step 2.1: Add BCCRAPIToken to Config**

```go
// server/internal/config/config.go
package config

import "os"

type Config struct {
	DatabaseURL  string
	Port         string
	CORSOrigin   string
	BCCRAPIToken string
}

func Load() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	cors := os.Getenv("CORS_ORIGIN")
	if cors == "" {
		cors = "*"
	}
	return Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		Port:         port,
		CORSOrigin:   cors,
		BCCRAPIToken: os.Getenv("BCCR_API_TOKEN"),
	}
}
```

- [ ] **Step 2.2: Verify the server still compiles**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```
Expected: no output (success).

- [ ] **Step 2.3: Commit**

```bash
git add server/internal/config/config.go
git commit -m "feat: add BCCRAPIToken to config"
```

---

## Task 3: ExchangeRateRepo

**Files:**
- Create: `server/internal/repository/exchange_rate_repo.go`

- [ ] **Step 3.1: Create the repository**

```go
// server/internal/repository/exchange_rate_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type ExchangeRateRepo struct{ pool *pgxpool.Pool }

func NewExchangeRateRepo(pool *pgxpool.Pool) *ExchangeRateRepo {
	return &ExchangeRateRepo{pool: pool}
}

// ExistingDates returns a set of which of the given YYYY-MM-DD dates already have a row.
func (r *ExchangeRateRepo) ExistingDates(ctx context.Context, dates []string) (map[string]bool, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date::text FROM exchange_rates WHERE date::text = ANY($1)`,
		dates,
	)
	if err != nil {
		return nil, fmt.Errorf("existing exchange rate dates: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool, len(dates))
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, fmt.Errorf("scan date: %w", err)
		}
		out[d] = true
	}
	return out, rows.Err()
}

// GetNearest returns the most recent rate on or before date.
func (r *ExchangeRateRepo) GetNearest(ctx context.Context, date string) (*model.ExchangeRate, error) {
	var er model.ExchangeRate
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, date::text, usd_to_crc, source, created_at::text
		FROM exchange_rates
		WHERE date <= $1::date
		ORDER BY date DESC
		LIMIT 1
	`, date).Scan(&er.ID, &er.Date, &er.USDToCRC, &er.Source, &er.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get nearest rate for %s: %w", date, err)
	}
	return &er, nil
}

// Upsert inserts or updates the rate for a date. Uses ON CONFLICT DO UPDATE.
func (r *ExchangeRateRepo) Upsert(ctx context.Context, date string, rate float64, source string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO exchange_rates (date, usd_to_crc, source)
		VALUES ($1::date, $2, $3)
		ON CONFLICT (date) DO UPDATE
		SET usd_to_crc = EXCLUDED.usd_to_crc,
		    source     = EXCLUDED.source
	`, date, rate, source)
	if err != nil {
		return fmt.Errorf("upsert rate %s: %w", date, err)
	}
	return nil
}

// ListByRange returns all rates in [from, to] inclusive, ordered by date asc.
func (r *ExchangeRateRepo) ListByRange(ctx context.Context, from, to string) ([]model.ExchangeRate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, date::text, usd_to_crc, source, created_at::text
		FROM exchange_rates
		WHERE date BETWEEN $1::date AND $2::date
		ORDER BY date ASC
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("list rates: %w", err)
	}
	defer rows.Close()
	var out []model.ExchangeRate
	for rows.Next() {
		var er model.ExchangeRate
		if err := rows.Scan(&er.ID, &er.Date, &er.USDToCRC, &er.Source, &er.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan rate: %w", err)
		}
		out = append(out, er)
	}
	return out, rows.Err()
}
```

- [ ] **Step 3.2: Verify it compiles**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```
Expected: no output.

- [ ] **Step 3.3: Commit**

```bash
git add server/internal/repository/exchange_rate_repo.go
git commit -m "feat: exchange rate repository (ExistingDates, GetNearest, Upsert, ListByRange)"
```

---

## Task 4: BCCR HTTP client with tests

**Files:**
- Create: `server/internal/bccr/client.go`
- Create: `server/internal/bccr/client_test.go`

- [ ] **Step 4.1: Write the failing test first**

```go
// server/internal/bccr/client_test.go
package bccr

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchRates_extractsSellRate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Error("missing Authorization header")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(bccrResponse{
			Estado: true,
			Datos: []bccrData{{
				Indicadores: []bccrIndicador{
					{
						CodigoIndicador: "317",
						Series:          []bccrSerie{{Fecha: "2026-05-28", ValorDatoPorPeriodo: 449.56}},
					},
					{
						CodigoIndicador: "318",
						Series: []bccrSerie{
							{Fecha: "2026-05-28", ValorDatoPorPeriodo: 455.52},
							{Fecha: "2026-05-29", ValorDatoPorPeriodo: 456.16},
						},
					},
				},
			}},
		})
	}))
	defer srv.Close()

	c := &Client{token: "test", baseURL: srv.URL, httpClient: srv.Client()}
	rates, err := c.FetchRates(context.Background(), "2026-05-28", "2026-05-29")
	if err != nil {
		t.Fatal(err)
	}
	if rates["2026-05-28"] != 455.52 {
		t.Errorf("want 455.52 got %f", rates["2026-05-28"])
	}
	if rates["2026-05-29"] != 456.16 {
		t.Errorf("want 456.16 got %f", rates["2026-05-29"])
	}
	if _, ok := rates["2026-05-28"]; !ok {
		t.Error("missing key 2026-05-28")
	}
}

func TestFetchRates_nonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := &Client{token: "bad", baseURL: srv.URL, httpClient: srv.Client()}
	_, err := c.FetchRates(context.Background(), "2026-05-28", "2026-05-28")
	if err == nil {
		t.Error("expected error for 401")
	}
}

func TestFetchRates_dateFormatConversion(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(bccrResponse{
			Estado: true,
			Datos: []bccrData{{
				Indicadores: []bccrIndicador{
					{CodigoIndicador: "318", Series: []bccrSerie{{Fecha: "2026-05-28", ValorDatoPorPeriodo: 455.52}}},
				},
			}},
		})
	}))
	defer srv.Close()

	c := &Client{token: "t", baseURL: srv.URL, httpClient: srv.Client()}
	c.FetchRates(context.Background(), "2026-05-28", "2026-05-28")
	if got := gotPath; got != "fechaInicio=2026%2F05%2F28&fechaFin=2026%2F05%2F28&idioma=ES" {
		// Accept either URL-encoded or raw slashes
		if got != "fechaInicio=2026/05/28&fechaFin=2026/05/28&idioma=ES" {
			t.Errorf("unexpected query: %s", got)
		}
	}
}
```

- [ ] **Step 4.2: Run the test — verify it fails**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/bccr/... -v
```
Expected: compile error — package `bccr` does not exist yet.

- [ ] **Step 4.3: Implement the client**

```go
// server/internal/bccr/client.go
package bccr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const defaultBaseURL = "https://apim.bccr.fi.cr/SDDE/api/Bccr.Ge.SDDE.Publico.Indicadores.API"

type Client struct {
	token      string
	baseURL    string
	httpClient *http.Client
}

func NewClient(token string) *Client {
	return &Client{
		token:      token,
		baseURL:    defaultBaseURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

type bccrResponse struct {
	Estado bool       `json:"estado"`
	Datos  []bccrData `json:"datos"`
}
type bccrData struct {
	Indicadores []bccrIndicador `json:"indicadores"`
}
type bccrIndicador struct {
	CodigoIndicador string      `json:"codigoIndicador"`
	Series          []bccrSerie `json:"series"`
}
type bccrSerie struct {
	Fecha               string  `json:"fecha"`
	ValorDatoPorPeriodo float64 `json:"valorDatoPorPeriodo"`
}

// FetchRates fetches the USD→CRC sell rate (indicator 318) for [from, to].
// from and to are YYYY-MM-DD. Returns map keyed by YYYY-MM-DD.
func (c *Client) FetchRates(ctx context.Context, from, to string) (map[string]float64, error) {
	fromFmt := strings.ReplaceAll(from, "-", "/")
	toFmt := strings.ReplaceAll(to, "-", "/")

	url := fmt.Sprintf(
		"%s/cuadro/1/series?fechaInicio=%s&fechaFin=%s&idioma=ES",
		c.baseURL, fromFmt, toFmt,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("bccr new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bccr request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bccr status %d", resp.StatusCode)
	}

	var body bccrResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("bccr decode: %w", err)
	}
	if !body.Estado || len(body.Datos) == 0 {
		return nil, fmt.Errorf("bccr: empty or failed response")
	}

	rates := make(map[string]float64)
	for _, ind := range body.Datos[0].Indicadores {
		if ind.CodigoIndicador != "318" {
			continue
		}
		for _, s := range ind.Series {
			rates[s.Fecha] = s.ValorDatoPorPeriodo
		}
	}
	if len(rates) == 0 {
		return nil, fmt.Errorf("bccr: indicator 318 not found in response")
	}
	return rates, nil
}
```

- [ ] **Step 4.4: Run tests — verify they pass**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./internal/bccr/... -v
```
Expected:
```
--- PASS: TestFetchRates_extractsSellRate (0.00s)
--- PASS: TestFetchRates_nonOKStatus (0.00s)
--- PASS: TestFetchRates_dateFormatConversion (0.00s)
PASS
```

- [ ] **Step 4.5: Commit**

```bash
git add server/internal/bccr/
git commit -m "feat: BCCR REST client with unit tests"
```

---

## Task 5: ExchangeRateService

**Files:**
- Create: `server/internal/service/exchange_rate_service.go`

- [ ] **Step 5.1: Create the service**

```go
// server/internal/service/exchange_rate_service.go
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"budgetapp/internal/bccr"
	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type ExchangeRateService struct {
	repo   *repository.ExchangeRateRepo
	client *bccr.Client
}

func NewExchangeRateService(repo *repository.ExchangeRateRepo, client *bccr.Client) *ExchangeRateService {
	return &ExchangeRateService{repo: repo, client: client}
}

// EnsureRates checks the DB for each date, fetches missing ones from BCCR
// (one range call), and returns a map of {date → usd_to_crc} for all dates.
// For dates where no rate can be obtained, the nearest available is used.
func (s *ExchangeRateService) EnsureRates(ctx context.Context, dates []string) (map[string]float64, error) {
	if len(dates) == 0 {
		return map[string]float64{}, nil
	}
	dates = uniqueStrings(dates)

	existing, err := s.repo.ExistingDates(ctx, dates)
	if err != nil {
		return nil, err
	}

	var missing []string
	for _, d := range dates {
		if !existing[d] {
			missing = append(missing, d)
		}
	}

	if len(missing) > 0 {
		min, max := minMaxStrings(missing)
		fetched, fetchErr := s.client.FetchRates(ctx, min, max)
		if fetchErr != nil {
			slog.Warn("BCCR fetch failed during import", "err", fetchErr)
			// Try open.er-api.com for today's date if it's among missing
			today := time.Now().Format("2006-01-02")
			for _, d := range missing {
				if d == today {
					if rate, ferr := fetchOpenERRate(ctx); ferr == nil {
						if err := s.repo.Upsert(ctx, d, rate, "open_er_api"); err != nil {
							slog.Warn("upsert fallback rate", "err", err)
						}
					}
				}
			}
		} else {
			for date, rate := range fetched {
				if err := s.repo.Upsert(ctx, date, rate, "BCCR"); err != nil {
					slog.Warn("upsert BCCR rate", "date", date, "err", err)
				}
			}
		}
	}

	result := make(map[string]float64, len(dates))
	for _, d := range dates {
		er, err := s.repo.GetNearest(ctx, d)
		if err != nil {
			slog.Warn("no rate available for date", "date", d)
			continue
		}
		result[d] = er.USDToCRC
	}
	return result, nil
}

// FetchAndStoreToday fetches today's rate if not already in the DB.
// Tries BCCR first, falls back to open.er-api.com.
func (s *ExchangeRateService) FetchAndStoreToday(ctx context.Context) error {
	today := time.Now().Format("2006-01-02")
	existing, err := s.repo.ExistingDates(ctx, []string{today})
	if err != nil {
		return err
	}
	if existing[today] {
		slog.Info("exchange rate already up to date", "date", today)
		return nil
	}

	fetched, err := s.client.FetchRates(ctx, today, today)
	if err != nil {
		slog.Warn("BCCR fetch failed, trying fallback", "err", err)
		rate, ferr := fetchOpenERRate(ctx)
		if ferr != nil {
			return fmt.Errorf("all rate sources failed: bccr=%w; fallback=%v", err, ferr)
		}
		return s.repo.Upsert(ctx, today, rate, "open_er_api")
	}

	for date, rate := range fetched {
		if err := s.repo.Upsert(ctx, date, rate, "BCCR"); err != nil {
			return err
		}
	}
	slog.Info("exchange rate stored", "date", today)
	return nil
}

// GetCurrent returns the most recent rate on or before today.
func (s *ExchangeRateService) GetCurrent(ctx context.Context) (*model.ExchangeRate, error) {
	today := time.Now().Format("2006-01-02")
	return s.repo.GetNearest(ctx, today)
}

// ListByRange returns rates for the given date range (YYYY-MM-DD).
func (s *ExchangeRateService) ListByRange(ctx context.Context, from, to string) ([]model.ExchangeRate, error) {
	return s.repo.ListByRange(ctx, from, to)
}

// Upsert allows a manual rate override (used by the PUT endpoint).
func (s *ExchangeRateService) Upsert(ctx context.Context, date string, rate float64, source string) error {
	return s.repo.Upsert(ctx, date, rate, source)
}

// fetchOpenERRate calls open.er-api.com (no key required) for the current USD→CRC rate.
func fetchOpenERRate(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.er-api.com/v6/latest/USD", nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("open.er-api request: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, fmt.Errorf("open.er-api decode: %w", err)
	}
	rate, ok := body.Rates["CRC"]
	if !ok || rate == 0 {
		return 0, fmt.Errorf("open.er-api: CRC rate missing")
	}
	return rate, nil
}

func uniqueStrings(ss []string) []string {
	seen := make(map[string]bool, len(ss))
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func minMaxStrings(ss []string) (min, max string) {
	min, max = ss[0], ss[0]
	for _, s := range ss[1:] {
		if s < min {
			min = s
		}
		if s > max {
			max = s
		}
	}
	return
}
```

- [ ] **Step 5.2: Verify it compiles**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```
Expected: no output.

- [ ] **Step 5.3: Commit**

```bash
git add server/internal/service/exchange_rate_service.go
git commit -m "feat: exchange rate service (EnsureRates, FetchAndStoreToday, BCCR+fallback)"
```

---

## Task 6: Add exchange_rate to transaction queries and responses

**Files:**
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/handler/transactions.go`

- [ ] **Step 6.1: Update ListByAccount query**

In `server/internal/repository/transaction_repo.go`, find the `ListByAccount` SELECT and add `exchange_rate`:

```go
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = $1
		ORDER BY t.date DESC, t.created_at DESC
		LIMIT $2 OFFSET $3
	`, accountID, perPage, offset)
```

And update the scan to include `ExchangeRate`:
```go
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate); err != nil {
```

- [ ] **Step 6.2: Update Get query**

In the same file, find the `Get` method and add `exchange_rate`:

```go
	err := r.pool.QueryRow(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.id = $1
	`, id).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
		&t.ExchangeRate)
```

- [ ] **Step 6.3: Update transaction handler to include exchange_rate in response**

Open `server/internal/handler/transactions.go`. Find the `toResponse` method (or inline map) and add `exchange_rate`:

```go
func toTxnResponse(t model.Transaction) map[string]any {
	return map[string]any{
		"id":            t.ID,
		"account_id":    t.AccountID,
		"category_id":   t.CategoryID,
		"category":      t.CategoryName,
		"date":          t.Date,
		"amount":        t.Amount,
		"currency":      t.Currency,
		"payee":         t.Payee,
		"memo":          t.Memo,
		"cleared":       t.Cleared,
		"exchange_rate": t.ExchangeRate,
	}
}
```

If the handler currently uses inline maps rather than a helper, add this helper and update all map literals to call it. Check `server/internal/handler/transactions.go` for the current structure.

- [ ] **Step 6.4: Verify it compiles and tests pass**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./... && go test ./...
```
Expected: no errors.

- [ ] **Step 6.5: Commit**

```bash
git add server/internal/repository/transaction_repo.go server/internal/handler/transactions.go
git commit -m "feat: include exchange_rate in transaction queries and API response"
```

---

## Task 7: Exchange rate handler

**Files:**
- Create: `server/internal/handler/exchange_rates.go`

- [ ] **Step 7.1: Create the handler**

```go
// server/internal/handler/exchange_rates.go
package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

type ExchangeRateHandler struct {
	svc *service.ExchangeRateService
}

func NewExchangeRateHandler(svc *service.ExchangeRateService) *ExchangeRateHandler {
	return &ExchangeRateHandler{svc: svc}
}

func (h *ExchangeRateHandler) Current(w http.ResponseWriter, r *http.Request) {
	er, err := h.svc.GetCurrent(r.Context())
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "No exchange rate available")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"date":       er.Date,
		"usd_to_crc": er.USDToCRC,
		"source":     er.Source,
	})
}

func (h *ExchangeRateHandler) ListByRange(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "query params 'from' and 'to' (YYYY-MM-DD) are required")
		return
	}
	rates, err := h.svc.ListByRange(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]map[string]any, len(rates))
	for i, er := range rates {
		resp[i] = map[string]any{
			"date":       er.Date,
			"usd_to_crc": er.USDToCRC,
			"source":     er.Source,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rates": resp})
}

func (h *ExchangeRateHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if date == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "date path param required")
		return
	}
	var body struct {
		USDToCRC float64 `json:"usd_to_crc"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.USDToCRC <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "usd_to_crc must be positive")
		return
	}
	if err := h.svc.Upsert(r.Context(), date, body.USDToCRC, "manual"); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"date":       date,
		"usd_to_crc": body.USDToCRC,
		"source":     "manual",
	})
}
```

- [ ] **Step 7.2: Verify it compiles**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```
Expected: no output.

- [ ] **Step 7.3: Commit**

```bash
git add server/internal/handler/exchange_rates.go
git commit -m "feat: exchange rate HTTP handler (current, list by range, manual upsert)"
```

---

## Task 8: Wire everything in main.go + startup goroutine

**Files:**
- Modify: `server/main.go`

- [ ] **Step 8.1: Add repo, service, handler, routes, and startup goroutine to main.go**

The full updated `main.go`:

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"budgetapp/internal/bccr"
	"budgetapp/internal/config"
	"budgetapp/internal/database"
	"budgetapp/internal/database/migrations"
	"budgetapp/internal/handler"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

func main() {
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect to database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("connected to database")

	if err := migrations.Run(ctx, pool); err != nil {
		slog.Error("run migrations", "err", err)
		os.Exit(1)
	}

	// Repos
	accountRepo  := repository.NewAccountRepo(pool)
	txnRepo      := repository.NewTransactionRepo(pool)
	catRepo      := repository.NewCategoryRepo(pool)
	ruleRepo     := repository.NewPayeeRuleRepo(pool)
	importRepo   := repository.NewImportRepo(pool)
	rateRepo     := repository.NewExchangeRateRepo(pool)

	// Services
	bccrClient   := bccr.NewClient(cfg.BCCRAPIToken)
	rateSvc      := service.NewExchangeRateService(rateRepo, bccrClient)
	importSvc    := service.NewImportService(pool, accountRepo, ruleRepo, importRepo, rateSvc)

	// Fetch today's rate on startup (non-blocking)
	go func() {
		if err := rateSvc.FetchAndStoreToday(ctx); err != nil {
			slog.Warn("startup rate fetch failed", "err", err)
		}
	}()

	// Refresh daily at midnight
	go func() {
		for {
			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 1, 0, 0, now.Location())
			select {
			case <-time.After(time.Until(next)):
				if err := rateSvc.FetchAndStoreToday(ctx); err != nil {
					slog.Warn("daily rate fetch failed", "err", err)
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// Handlers
	accounts  := handler.NewAccountHandler(accountRepo)
	txns      := handler.NewTransactionHandler(txnRepo)
	cats      := handler.NewCategoryHandler(catRepo)
	imports   := handler.NewImportHandler(importSvc, importRepo)
	rates     := handler.NewExchangeRateHandler(rateSvc)

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Accounts
	mux.HandleFunc("GET /api/accounts", accounts.List)
	mux.HandleFunc("POST /api/accounts", accounts.Create)
	mux.HandleFunc("GET /api/accounts/{id}", accounts.Get)
	mux.HandleFunc("PUT /api/accounts/{id}", accounts.Update)
	mux.HandleFunc("DELETE /api/accounts/{id}", accounts.Delete)
	mux.HandleFunc("PATCH /api/accounts/{id}/close", accounts.ToggleClosed)

	// Transactions
	mux.HandleFunc("GET /api/accounts/{id}/transactions", txns.ListByAccount)
	mux.HandleFunc("POST /api/accounts/{id}/transactions", txns.Create)
	mux.HandleFunc("GET /api/transactions/{id}", txns.Get)
	mux.HandleFunc("PUT /api/transactions/{id}", txns.Update)
	mux.HandleFunc("DELETE /api/transactions/{id}", txns.Delete)

	// Categories
	mux.HandleFunc("GET /api/category-groups", cats.ListGroups)
	mux.HandleFunc("POST /api/category-groups", cats.CreateGroup)
	mux.HandleFunc("PUT /api/category-groups/{id}", cats.UpdateGroup)
	mux.HandleFunc("DELETE /api/category-groups/{id}", cats.DeleteGroup)
	mux.HandleFunc("POST /api/categories", cats.CreateCategory)
	mux.HandleFunc("PUT /api/categories/{id}", cats.UpdateCategory)
	mux.HandleFunc("DELETE /api/categories/{id}", cats.DeleteCategory)

	// Imports
	mux.HandleFunc("POST /api/imports/preview", imports.Preview)
	mux.HandleFunc("POST /api/imports/confirm", imports.Confirm)
	mux.HandleFunc("GET /api/imports", imports.History)

	// Exchange rates
	mux.HandleFunc("GET /api/exchange-rates/current", rates.Current)
	mux.HandleFunc("GET /api/exchange-rates", rates.ListByRange)
	mux.HandleFunc("PUT /api/exchange-rates/{date}", rates.Upsert)

	corsMiddleware := handler.CORS(cfg.CORSOrigin)
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler.Logger(corsMiddleware(mux)),
	}

	go func() {
		slog.Info("listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
}
```

Note: `service.NewImportService` signature will change in Task 10 to accept `rateSvc`. Write this step after Task 10 compiles, or temporarily keep the old `NewImportService` signature and fix it in Task 10.

- [ ] **Step 8.2: Verify it compiles (ImportService will fail — that's expected)**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./... 2>&1
```
Expected: compile error about `NewImportService` argument count. That's fine — proceed to Task 9.

---

## Task 9: ImportRepo — add exchange_rate to InsertImportedTxn

**Files:**
- Modify: `server/internal/repository/import_repo.go`

- [ ] **Step 9.1: Update InsertImportedTxn signature and SQL**

Replace the existing `InsertImportedTxn` function:

```go
// InsertImportedTxn inserts one imported transaction within the confirm transaction.
// exchangeRate is nil when no rate could be determined.
func (r *ImportRepo) InsertImportedTxn(
	ctx context.Context, tx pgx.Tx,
	accountID, importID, date string, amount int64, currency, payee, reference string,
	categoryID *string, memo *string, exchangeRate *float64,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO transactions
			(account_id, category_id, date, amount, currency, payee, check_number, memo, import_id, cleared, exchange_rate)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), $8, $9, false, $10)
	`, accountID, categoryID, date, amount, currency, payee, reference, memo, importID, exchangeRate)
	if err != nil {
		return fmt.Errorf("insert imported txn: %w", err)
	}
	return nil
}
```

- [ ] **Step 9.2: Commit**

```bash
git add server/internal/repository/import_repo.go
git commit -m "feat: ImportRepo.InsertImportedTxn stamps exchange_rate"
```

---

## Task 10: ImportService — EnsureRates + rate stamping in Confirm

**Files:**
- Modify: `server/internal/service/import_service.go`

- [ ] **Step 10.1: Update ImportService to depend on ExchangeRateService**

Replace the full `import_service.go` content:

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

type ImportService struct {
	pool        *pgxpool.Pool
	accountRepo *repository.AccountRepo
	ruleRepo    *repository.PayeeRuleRepo
	importRepo  *repository.ImportRepo
	rateSvc     *ExchangeRateService
}

func NewImportService(
	pool *pgxpool.Pool,
	accountRepo *repository.AccountRepo,
	ruleRepo *repository.PayeeRuleRepo,
	importRepo *repository.ImportRepo,
	rateSvc *ExchangeRateService,
) *ImportService {
	return &ImportService{
		pool:        pool,
		accountRepo: accountRepo,
		ruleRepo:    ruleRepo,
		importRepo:  importRepo,
		rateSvc:     rateSvc,
	}
}

// Preview is unchanged — no rate fetching at preview time.
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
		txns              = make([]model.PreviewTxn, 0, len(stmt.Transactions))
		totalIn, totalOut int64
		minDate, maxDate  string
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

// Confirm commits reviewed transactions, stamping exchange_rate on each one.
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

	// Collect unique dates from included transactions and fetch their rates.
	dates := make([]string, 0, len(included))
	for _, t := range included {
		dates = append(dates, t.Date)
	}
	rateMap, err := s.rateSvc.EnsureRates(ctx, dates)
	if err != nil {
		return model.ConfirmResponse{}, fmt.Errorf("ensure rates: %w", err)
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

		var rate *float64
		if r, ok := rateMap[t.Date]; ok {
			r := r
			rate = &r
		}

		if err := s.importRepo.InsertImportedTxn(
			ctx, tx, req.AccountID, importID, t.Date, t.Amount,
			account.Currency, payee, t.Reference, t.CategoryID, t.Memo, rate,
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

- [ ] **Step 10.2: Build the full server — must compile cleanly now**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
```
Expected: no output.

- [ ] **Step 10.3: Run all tests**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./...
```
Expected: all pass.

- [ ] **Step 10.4: Smoke test the running server**

```bash
# Terminal 1 — start server
cd /home/Berny/budgetapp-ai/server
source .env
DATABASE_URL="postgres://budgetapp:budgetapp@localhost:5432/budgetapp?sslmode=disable" \
BCCR_API_TOKEN="$BCCR_API_TOKEN" go run . &

# Terminal 2 — test endpoints
sleep 2
curl -s http://localhost:8080/api/exchange-rates/current | python3 -m json.tool
curl -s "http://localhost:8080/api/exchange-rates?from=2026-05-28&to=2026-06-02" | python3 -m json.tool
```
Expected: `current` returns today's rate (fetched from BCCR on startup). `from/to` returns a list of rates.

- [ ] **Step 10.5: Stop the test server and commit**

```bash
kill %1  # or Ctrl-C in terminal 1
git add server/internal/service/import_service.go server/main.go
git commit -m "feat: wire ExchangeRateService into ImportService.Confirm and main.go startup"
```

---

## Task 11: Frontend — api.ts additions + Transaction type

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/data.ts`

- [ ] **Step 11.1: Add exchange_rate to Transaction type in data.ts**

Open `frontend/src/data.ts`. In the `Transaction` interface, add two fields after `cleared`:

```typescript
export interface Transaction {
  id: string;
  date: string;
  payee: string;
  category: string | null;
  memo: string;
  outflow: number;
  inflow: number;
  cleared: boolean;
  account: string;
  currency?: string;
  exchange_rate?: number | null;
  splits?: { category: string; amount: number }[];
}
```

- [ ] **Step 11.2: Update fetchAccountTransactions to expose currency and exchange_rate**

In `frontend/src/api.ts`, update `fetchAccountTransactions`:

```typescript
export async function fetchAccountTransactions(
  accountId: string,
  page = 1,
  perPage = 200,
): Promise<Transaction[]> {
  type ApiTxn = Omit<Transaction, 'outflow' | 'inflow'> & { amount: number; currency: string; exchange_rate?: number | null };
  const data: { transactions: ApiTxn[] } = await apiFetch(
    `/accounts/${accountId}/transactions?page=${page}&per_page=${perPage}`,
  );
  return (data.transactions ?? []).map(t => {
    const major = t.amount / 100;
    return {
      id: t.id, date: t.date, payee: t.payee, category: t.category,
      memo: t.memo, cleared: t.cleared, account: t.account,
      currency: t.currency,
      exchange_rate: t.exchange_rate,
      outflow: major < 0 ? -major : 0,
      inflow: major > 0 ? major : 0,
    } as Transaction;
  });
}
```

- [ ] **Step 11.3: Add exchange rate API functions**

At the end of `frontend/src/api.ts`, add:

```typescript
// ─── Exchange Rates ───────────────────────────────────────────────────────────

export interface ExchangeRate {
  date: string;
  usd_to_crc: number;
  source: string;
}

export async function fetchCurrentRate(): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>('/exchange-rates/current');
}

export async function fetchRates(from: string, to: string): Promise<ExchangeRate[]> {
  const data = await apiFetch<{ rates: ExchangeRate[] }>(`/exchange-rates?from=${from}&to=${to}`);
  return data.rates ?? [];
}

export async function upsertRate(date: string, usd_to_crc: number): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>(`/exchange-rates/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ usd_to_crc }),
  });
}
```

- [ ] **Step 11.4: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -10
```
Expected: no TypeScript errors.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/src/api.ts frontend/src/data.ts
git commit -m "feat: exchange rate API functions and exchange_rate on Transaction type"
```

---

## Task 12: App.tsx — fetch live rate, remove static AppData fallback

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 12.1: Import fetchCurrentRate and add live rate state**

At the top of `frontend/src/App.tsx`, add `fetchCurrentRate` to the api import:

```typescript
import { fetchAccounts, fetchCategoryGroupsRaw, fetchCurrentRate } from './api';
```

Add two state variables after the existing state declarations (around line 84):

```typescript
const [exchangeRate, setExchangeRate] = useState<number>(AppData.exchangeRate);
const [exchangeRateDate, setExchangeRateDate] = useState<string>(AppData.exchangeRateDate);
```

- [ ] **Step 12.2: Replace the static AppData rate with a live fetch**

Find the existing `useEffect` that loads accounts and categories (around line 107). Add `fetchCurrentRate()` to the `Promise.all`:

```typescript
useEffect(() => {
  Promise.all([fetchAccounts(), fetchCategoryGroupsRaw(), fetchCurrentRate()])
    .then(([accs, rawGroups, rate]) => {
      setAccounts(accs);
      setExchangeRate(rate.usd_to_crc);
      setExchangeRateDate(rate.date);
      const idMap: Record<string, string> = {};
      rawGroups.forEach(g => g.categories.forEach(c => { idMap[c.name] = c.id; }));
      setCategoryIdByName(idMap);
      setCategoryGroups(rawGroups.map(g => ({
        id: g.id,
        name: g.name,
        categories: g.categories.map(c => c.name),
      })));
    })
    .catch(err => console.warn('API unavailable, using static data:', err.message));
}, []);
```

- [ ] **Step 12.3: Remove the static destructure of AppData rates**

Find this line (around line 124):
```typescript
const { budget, monthlySpending, exchangeRate, exchangeRateDate } = AppData;
```

Remove `exchangeRate, exchangeRateDate` from that destructure (they're now from state):
```typescript
const { budget, monthlySpending } = AppData;
```

- [ ] **Step 12.4: Remove defaultCurrency from tweaks**

In the `TweaksPanel` component (around line 31), remove the "Default Currency" section entirely:

```typescript
// REMOVE this block from TweaksPanel:
<div>
  <div style={twk.label}>Default Currency</div>
  <div style={{ display: 'flex', gap: 6 }}>
    {['CRC', 'USD'].map(c => (
      <button key={c} onClick={() => updateTweak('defaultCurrency', c)} style={{ ...twk.pill, ...(tweaks.defaultCurrency === c ? twk.pillOn : {}) }}>
        {c === 'CRC' ? '₡ CRC' : '$ USD'}
      </button>
    ))}
  </div>
</div>
```

Also remove `defaultCurrency` from the `Tweaks` interface and `TWEAK_DEFAULTS`:

```typescript
// Before:
const TWEAK_DEFAULTS = { accent: 'mint' as AccentKey, density: 'comfortable', defaultCurrency: 'USD' };
interface Tweaks { accent: AccentKey; density: string; defaultCurrency: string; }

// After:
const TWEAK_DEFAULTS = { accent: 'mint' as AccentKey, density: 'comfortable' };
interface Tweaks { accent: AccentKey; density: string; }
```

And remove the `if (key === 'defaultCurrency') handleCurrencyChange(val);` line from `updateTweak`.

- [ ] **Step 12.5: Verify TypeScript compiles**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run build 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 12.6: Start dev server and verify live rate appears in the sidebar**

```bash
cd /home/Berny/budgetapp-ai/frontend && npm run dev &
```

Open `http://localhost:5173` in a browser. Check:
- Sidebar footer shows today's BCCR rate (e.g. `₡461.17 / $1`) with today's date
- The ₡/$ toggle in the header still works
- The tweaks panel no longer has a "Default Currency" row

- [ ] **Step 12.7: Commit**

```bash
kill %1  # stop dev server
git add frontend/src/App.tsx
git commit -m "feat: fetch live exchange rate from API; remove static AppData rate fallback"
```

---

## Final verification

- [ ] **Run all backend tests**

```bash
cd /home/Berny/budgetapp-ai/server && go test ./... -v
```
Expected: all pass.

- [ ] **Build the full stack**

```bash
cd /home/Berny/budgetapp-ai/server && go build ./...
cd /home/Berny/budgetapp-ai/frontend && npm run build
```
Expected: both succeed with no errors.

- [ ] **End-to-end import smoke test**

Start the server with your `.env`, open the frontend, and perform a CSV import. After confirming, query the DB to verify `exchange_rate` is populated:

```sql
SELECT id, date, amount, exchange_rate
FROM transactions
WHERE import_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```
Expected: `exchange_rate` column is non-NULL for imported rows.

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: Phase 2.4 complete — exchange rates, BCCR integration, import stamping, live rate in UI"
```
