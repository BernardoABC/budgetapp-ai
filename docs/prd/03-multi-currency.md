# PRD 03: Multi-Currency Support (CRC / USD)

## Overview
The user operates primarily in CRC (Costa Rican Colones) but needs to see their finances in USD as well. Every transaction captures the exchange rate at its date, enabling historically accurate conversion in both directions.

## Core Principles

1. **Native-currency storage** — Each account's balance and transactions are
   stored in minor units of that account's own currency (CRC centimos or USD
   cents), matching the bank statement exactly. CRC is canonical only for
   cross-account aggregation, computed at read time via each transaction's
   stamped exchange rate — storage is never converted.
2. **Exchange rate per transaction** — Each transaction records the USD↔CRC rate for its date, so conversions are historically accurate (not retroactively adjusted)
3. **Toggle, don't convert** — The currency toggle changes the *display*, not the stored data. No rounding errors accumulate.
4. **One rate per day** — Exchange rates are stored per calendar date, not per transaction

## Exchange Rate Data Model

### exchange_rates table
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| date | DATE | UNIQUE — one rate per day |
| usd_to_crc | NUMERIC(12,4) | CRC per 1 USD (e.g., 510.7500) |
| source | VARCHAR(100) | "BCCR", "exchangerate_host", "manual" |
| created_at | TIMESTAMPTZ | |

### Rate on transactions
The `transactions.exchange_rate` column stores `NUMERIC(12,4)` — the USD→CRC rate at time of that transaction. This is populated:
- Automatically during CSV import (looked up from exchange_rates table by date)
- Automatically for manual entries (current day's rate)
- Manually overridable by user

## Exchange Rate Sources

### Primary: BCCR (Banco Central de Costa Rica)
The Central Bank publishes official buy/sell rates daily.

**API Endpoint:** `https://gee.bccr.fi.cr/Indicadores/Suscripciones/WS/wsindicadoreseconomicos.asmx`

This is a SOAP API. Key indicators:
- Indicator 317: USD buy rate (tipo de cambio de compra)
- Indicator 318: USD sell rate (tipo de cambio de venta)

For simplicity, we'll use the **sell rate** (venta) as it represents what you'd pay to buy USD — the more conservative/common rate for expense tracking.

### Fallback: exchangerate.host
Free REST API: `https://api.exchangerate.host/timeseries?start_date=2026-04-01&end_date=2026-04-14&base=USD&symbols=CRC`

Used when BCCR is unavailable or for historical backfill.

### Manual entry
User can manually set/override exchange rates for any date.

## Rate Fetching Strategy

### On CSV Import
1. Collect all unique dates from the imported transactions
2. For each date, check if `exchange_rates` already has an entry
3. For missing dates, batch-fetch from BCCR API
4. If BCCR fails, try exchangerate.host
5. If both fail, use the nearest available rate and flag it

### Daily Background Fetch
On server startup (or daily via a simple goroutine ticker):
1. Check if today's rate exists
2. If not, fetch from BCCR
3. Store it

### No internet / API failure
- Use the most recent available rate
- Flag transactions using a stale rate in the UI
- Allow manual rate entry as override

## Display Conversion Logic

### CRC → USD
```
usd_amount = crc_amount / exchange_rate
```

### USD → CRC
```
crc_amount = usd_amount * exchange_rate
```

### Formatting
| Currency | Format | Example |
|----------|--------|---------|
| CRC | ₡#,###.## | ₡25,000.00 |
| USD | $#,###.## | $49.02 |

CRC amounts typically don't use decimal places in practice (centimos are rarely used), so the UI should show `₡25,000` rather than `₡25,000.00` — but the data model supports centimos for precision.

## Currency Toggle UX

### Global Toggle
A prominent toggle in the app header: `₡ CRC | $ USD`

When toggled to USD:
- All transaction amounts display their USD equivalent
- Account balances display in USD
- Budget amounts display in USD
- Charts and reports display in USD

The toggle state persists in localStorage.

### Per-Transaction Detail
In the transaction detail view, show BOTH currencies:
```
Amount:  ₡25,000.00
         ($49.02 @ ₡510.25)
```

### Budget View
When viewing budgets in USD mode:
- Assigned amounts are converted using the rate for the 1st of that budget month
- Activity amounts are converted using each transaction's individual rate
- This means "Assigned" and "Activity" conversions may use slightly different rates — this is correct and expected

## API Design

### GET /api/exchange-rates?from=2026-04-01&to=2026-04-14
Returns rates for a date range.

```json
{
  "rates": [
    { "date": "2026-04-01", "usd_to_crc": 510.75, "source": "BCCR" },
    { "date": "2026-04-02", "usd_to_crc": 511.20, "source": "BCCR" }
  ]
}
```

### PUT /api/exchange-rates/:date
Manually set/override a rate.

```json
{ "usd_to_crc": 510.50, "source": "manual" }
```

### GET /api/exchange-rates/current
Returns today's rate (or most recent available).

```json
{ "date": "2026-04-14", "usd_to_crc": 511.00, "source": "BCCR" }
```

## Edge Cases

1. **Weekend/holiday rates** — Banks don't publish rates on non-business days. Use the most recent available rate (typically Friday's rate for Saturday/Sunday).
2. **Rate not available yet** — If today's rate hasn't been published yet (BCCR updates around 8 AM), use yesterday's rate.
3. **Historical transactions before rate tracking** — When importing old transactions, backfill rates from the API. If unavailable, allow manual entry.
4. **CRC account with USD transaction** — Rare but possible (e.g., Amazon charges in USD on a CRC card). The transaction stores the amount in CRC (as charged by the bank) plus the exchange rate for reference.
5. **Rounding** — Always round to 2 decimal places for display. Store full precision internally. Round at the display layer, never in storage.
