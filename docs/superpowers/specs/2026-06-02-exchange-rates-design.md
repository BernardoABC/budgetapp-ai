# Exchange Rates + Currency Toggle — Design Spec
**Phase 2.4 / Date: 2026-06-02**

## Overview

Add USD↔CRC exchange rate fetching, storage, and stamping to the budgetapp. On import confirm, each transaction gets the official BCCR sell rate for its date stamped into `transactions.exchange_rate`. A global currency toggle in the header lets the user view all amounts in CRC or USD using historically accurate per-transaction rates.

---

## 1. New Files and Responsibilities

### Backend

```
server/internal/bccr/
  client.go          — pure HTTP client, no DB deps
                       FetchRates(ctx, from, to string) (map[string]float64, error)
                       Reads BCCR_API_TOKEN from config.

server/internal/repository/
  exchange_rate_repo.go
                     — GetByDate(ctx, date) (*model.ExchangeRate, error)
                     — GetNearest(ctx, date) (*model.ExchangeRate, error)
                     — Upsert(ctx, date, rate float64, source string) error
                     — ListByRange(ctx, from, to string) ([]model.ExchangeRate, error)

server/internal/service/
  exchange_rate_service.go
                     — EnsureRates(ctx, dates []string) (map[string]float64, error)
                     — FetchAndStoreToday(ctx) error
                     — GetCurrent(ctx) (*model.ExchangeRate, error)
                     — ListByRange(ctx, from, to string) ([]model.ExchangeRate, error)

server/internal/handler/
  exchange_rates.go  — GET /api/exchange-rates?from=&to=
                     — GET /api/exchange-rates/current
                     — PUT /api/exchange-rates/:date

server/internal/model/
  exchange_rate.go   — ExchangeRate struct
```

### Frontend

```
frontend/src/
  contexts/CurrencyContext.tsx   — provider, toggle, convert()
  components/CurrencyToggle.tsx  — ₡ | $ button for header
  components/MoneyDisplay.tsx    — reads context, formats amount
```

### Config

`server/internal/config/config.go` gains one field:
- `BCCRAPIToken string` — from `BCCR_API_TOKEN` env var

---

## 2. BCCR REST API

**Confirmed working via live test on 2026-06-02.**

- **Base URL:** `https://apim.bccr.fi.cr/SDDE/api/Bccr.Ge.SDDE.Publico.Indicadores.API`
- **Auth:** `Authorization: Bearer {BCCR_API_TOKEN}`
- **Endpoint:** `GET /cuadro/1/series?fechaInicio=yyyy/mm/dd&fechaFin=yyyy/mm/dd&idioma=ES`
  - Cuadro 1 = "Tipo cambio de compra y de venta del dólar de los Estados Unidos de América"
  - We filter to `codigoIndicador == "318"` (sell/venta rate)
- **Input date format:** `yyyy/mm/dd` (slashes)
- **Output date format:** `"2026-05-28"` (YYYY-MM-DD dashes) — matches DB format directly
- **Response:**
  ```json
  {
    "estado": true,
    "mensaje": "Consulta exitosa",
    "datos": [{
      "indicadores": [
        { "codigoIndicador": "317", "series": [...] },
        { "codigoIndicador": "318", "series": [
          { "fecha": "2026-05-28", "valorDatoPorPeriodo": 455.52 }
        ]}
      ]
    }]
  }
  ```
- Weekends and holidays carry the prior business day's rate (BCCR publishes one value for the whole non-business period).
- Today's rate is available same-day.

`bccr.Client.FetchRates(ctx, from, to)` makes one range call and returns `map[string]float64` keyed by YYYY-MM-DD. The caller stores all returned dates even if only a subset was requested (free historical data bonus).

---

## 3. Fallback Strategy

| Scenario | Primary | Fallback |
|----------|---------|----------|
| Daily startup fetch (today) | BCCR | `open.er-api.com/v6/latest/USD` → extract `rates.CRC` |
| Historical import batch | BCCR range call | Nearest rate already in DB |
| Both fail | — | `GetNearest` from DB; logs warning; `exchange_rate` stays NULL only if DB also has nothing |

`open.er-api.com` is free, requires no API key, supports CRC, but only serves the current rate (no historical). It is used only for the daily fetch fallback.

---

## 4. Data Flow

### Server startup
```
main.go
  → go ExchangeRateService.FetchAndStoreToday(ctx)   // non-blocking goroutine
  → time.NewTicker(24*time.Hour) repeats daily
```

### Import confirm (new path)
```
ImportHandler.Confirm
  → ImportService.Confirm(ctx, req)
      1. Collect unique dates from included transactions
      2. ExchangeRateService.EnsureRates(ctx, dates)
           a. DB: SELECT existing dates
           b. For missing dates: bccr.Client.FetchRates(minDate, maxDate) — one range call
           c. If BCCR fails: open.er-api.com (today only) or GetNearest (historical)
           d. Upsert all newly fetched rates to DB
           e. Returns map[string]float64 {date → usd_to_crc}
      3. Begin DB transaction
      4. For each txn: InsertImportedTxn(..., rateMap[txn.Date])
         (exchange_rate is NULL only if no rate exists and all fallbacks failed)
      5. Update account balance, learn rules, commit
```

### API read path
```
GET /api/exchange-rates?from=&to=  →  ExchangeRateRepo.ListByRange
GET /api/exchange-rates/current    →  ExchangeRateRepo.GetNearest(today)
PUT /api/exchange-rates/:date      →  ExchangeRateRepo.Upsert(..., "manual")
```

---

## 5. Model

```go
// server/internal/model/exchange_rate.go
type ExchangeRate struct {
    ID        string
    Date      string  // YYYY-MM-DD
    USDToCRC  float64
    Source    string  // "BCCR", "open_er_api", "manual"
    CreatedAt string
}
```

The `exchange_rates` table already exists in the schema (001_initial_schema.sql). No migration needed.

---

## 6. ImportService changes

`ImportService` gains one new field: `ratesSvc *ExchangeRateService`.

`InsertImportedTxn` signature gains one parameter: `exchangeRate *float64` (pointer — nil if unavailable).

The SQL in `import_repo.go` changes from omitting `exchange_rate` to including it:
```sql
INSERT INTO transactions
    (account_id, category_id, date, amount, currency, payee, check_number, memo, import_id, cleared, exchange_rate)
VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), $8, $9, false, $10)
```

---

## 7. Frontend

### CurrencyContext
```tsx
interface CurrencyCtx {
  currency: 'CRC' | 'USD'
  rate: number | null          // today's usd_to_crc; null if fetch failed
  toggle: () => void
  convert: (amount: number, txnCurrency: string, txnRate?: number | null) => number | null
}
```

- `currency` persisted in `localStorage` key `"currency"`
- `rate` fetched on mount from `GET /api/exchange-rates/current`; `null` on fetch failure
- `convert()` logic:
  - Same currency as display: return `amount` as-is
  - CRC → USD: `amount / (txnRate ?? rate)` — returns `null` if no rate available
  - USD → CRC: `amount * (txnRate ?? rate)` — returns `null` if no rate available

### CurrencyToggle
Small `₡ | $` pill button placed in the app header. Replaces the `defaultCurrency` option in the tweaks panel (that option is removed).

### MoneyDisplay
```tsx
<MoneyDisplay amount={txn.amount} currency={txn.currency} txnRate={txn.exchange_rate} />
```
Reads context, calls `convert()`, formats result. Renders `--` if `convert()` returns `null`.

### api.ts additions
```ts
fetchCurrentRate(): Promise<{ date: string; usd_to_crc: number; source: string }>
fetchRates(from: string, to: string): Promise<Rate[]>
upsertRate(date: string, usd_to_crc: number): Promise<Rate>
```

---

## 8. Error Handling

| Failure | Behaviour |
|---------|-----------|
| BCCR down during import confirm | Try open.er-api.com (today) or nearest DB rate (historical). Log warning. Proceed. |
| No rate at all for a date | `exchange_rate` stays NULL. Transaction imported. UI shows `--` for that amount in USD mode. |
| `GET /api/exchange-rates/current` fails on frontend | `rate` = null in context. `MoneyDisplay` renders `--` in USD mode. |
| Manual override via PUT | Upserted with source `"manual"`, overwrites any existing rate for that date. |

---

## 9. Out of Scope (deferred)

- Flagging transactions with stale/nearest-available rates in the UI (Phase 2.5+)
- Per-transaction rate display in transaction detail view (Phase 2.5+)
- Budget view USD conversion using 1st-of-month rate (Phase 3)
- Backfilling exchange rates for transactions that already exist with NULL rate
