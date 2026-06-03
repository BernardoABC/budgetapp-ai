# 07 — Anomaly / Unusual-Spend Alerts

**Model fit:** Qwen 2.5 7B ✅ as a *hybrid* (stats in Go, explanation by LLM) ·
**Effort:** M · **Value:** ★★★

## Concept

After an import (or on a dashboard glance), highlight transactions and patterns
that don't fit your normal behavior, and explain them in one line:

- "₡210,000 at **Office Depot** — 6× your usual spend there."
- "First-ever charge from **PriceSmart**."
- "**Restaurants** is at ₡142k this month, 48% over your average with a week left."
- "Possible duplicate: two ₡18,500 charges at the same café, same day."

## Hybrid split

**Deterministic (Go/SQL — the detection):**
Anomaly scoring is statistics, not language. Compute per category and per merchant:
- rolling mean/median + standard deviation of amounts
- z-score or IQR-based outlier flags on new transactions
- "never seen this merchant before" (no prior `payee_rules` / history)
- month-to-date pace vs trailing average (overspend trajectory)
- near-duplicate detection (the importer already has duplicate logic to reuse)

**LLM (the explanation & prioritization):**
- Turn a flagged set of stats into a short, ranked, human list.
- Decide what's worth surfacing vs noise (a slightly-above-average grocery run is
  not worth a card; a 6× outlier is).
- Phrase each alert plainly and non-alarmingly.

## Where it plugs in

- **`internal/service`:** `AnomalyService.Scan(ctx, scope)` where scope is "last
  import" or "current month". Returns scored candidates with the raw stats.
- **`internal/ai`:** `SummarizeAnomalies(ctx, candidates) ([]Alert, error)` —
  filters/ranks/phrases. Returns at most N alerts.
- **Surfaces:**
  - `Import.tsx`: a "Heads up" section in the import review for unusual rows.
  - `Dashboard.tsx`: an "Insights" card for the current month.
- Read-only; alerts can be dismissed (optional `dismissed_alerts` table).

## Candidate → prompt sketch

**System:**
```
You turn flagged spending anomalies into a short, ranked, calm list for a budget
app. Keep only the genuinely noteworthy ones (skip minor fluctuations). One line
each, <=16 words. Never invent numbers; use only the provided stats.
Respond only with JSON.
```

**User:**
```json
[
  {"i":0,"type":"merchant_outlier","payee":"Office Depot","amount":"₡210,000","usual":"₡35,000","ratio":6.0},
  {"i":1,"type":"new_merchant","payee":"PriceSmart","amount":"₡88,000"},
  {"i":2,"type":"category_pace","group":"Restaurants","mtd":"₡142,000","avg":"₡96,000","days_left":7},
  {"i":3,"type":"merchant_outlier","payee":"Automercado","amount":"₡44,000","usual":"₡40,000","ratio":1.1}
]
```

**Output:**
```json
{ "alerts":[
  {"i":0,"severity":"high","text":"₡210,000 at Office Depot — about 6× your usual."},
  {"i":2,"severity":"medium","text":"Restaurants at ₡142,000, ~48% over average with a week left."},
  {"i":1,"severity":"low","text":"First charge from PriceSmart (₡88,000)."}
]}
```

(The model dropped #3 as noise — exactly the filtering you want from it.)

## Validation & safety

- All statistics computed in Go; the model only selects and phrases. Optionally
  verify each emitted number exists in the candidate input.
- Conservative thresholds + the model's noise-filtering keep alert fatigue low.
- Purely informational; never blocks import or mutates data.

## Effort

**M.** The stats layer is the substance (and is useful standalone). The LLM layer
is one ranking/phrasing call. Reuses existing duplicate-detection for the
near-duplicate case.

## Risks / notes

- Cold start: with little history, suppress outlier alerts (need a minimum sample
  per merchant/category) and lean on "new merchant" + duplicate signals.
- Keep severity thresholds user-tunable to taste.
