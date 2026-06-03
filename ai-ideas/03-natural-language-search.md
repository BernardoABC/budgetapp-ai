# 03 — Natural-Language Transaction Search

**Model fit:** Qwen 2.5 7B ✅ (text → constrained JSON filter) · **Effort:** M ·
**Value:** ★★★★

## Concept

A search box where you type plain language and the app answers from your data:

- "how much did I spend on coffee in April?"
- "show all transfers over ₡100,000 last month"
- "restaurants since March, biggest first"
- "uncategorized transactions from BAC checking"

The LLM does **not** query the database directly. It translates the question into
a **strict, validated filter object** (a small query DSL). Go executes that filter
against the existing `transaction_repo`, computes any totals, and returns real
rows + real numbers. The model never touches money math or raw SQL.

## Why this design keeps a 7B model safe and effective

- The model's only job is **semantic parsing** into a tiny fixed JSON schema —
  well within 7B ability, and constrained by Ollama's `format`.
- No SQL injection / no hallucinated math: Go validates every field against
  whitelists (known category ids, account ids, date bounds) before executing.
- Anything the model can't map cleanly degrades to a normal keyword search over
  `payee` / `memo`.

## Query DSL (the model's output target)

```json
{
  "type": "object",
  "properties": {
    "text":        {"type": "string"},
    "account_id":  {"type": "string"},
    "category_id": {"type": "string"},
    "group":       {"type": "string"},
    "min_amount":  {"type": "integer"},
    "max_amount":  {"type": "integer"},
    "date_from":   {"type": "string"},
    "date_to":     {"type": "string"},
    "flow":        {"type": "string", "enum": ["inflow","outflow","any"]},
    "is_transfer": {"type": "boolean"},
    "uncategorized": {"type": "boolean"},
    "sort":        {"type": "string", "enum": ["date_desc","date_asc","amount_desc","amount_asc"]},
    "aggregate":   {"type": "string", "enum": ["none","sum","count","avg"]}
  }
}
```

## Where it plugs in

- **New endpoint:** `POST /api/search/nl` `{ "q": "how much on coffee in April" }`.
- **`internal/ai`:** `ParseQuery(ctx, q, ctxHints) (Filter, error)` where
  `ctxHints` injects the current category list, account names→ids, today's date,
  and the user's display currency so relative dates ("last month", "April")
  resolve correctly.
- **`internal/service`:** a thin `SearchService` validates the parsed filter
  (whitelist ids, clamp dates, reject nonsense), then calls existing repo methods.
  Amounts/sums are computed in Go exactly as the reports already do.
- **Frontend:** a global search bar (in `Layout.tsx`) that shows the resolved
  filter as removable chips ("Category: Coffee Shops", "April 2026") so the user
  sees *how* their question was interpreted and can tweak it.

## Prompt sketch

**System:**
```
You convert a user's plain-language question about their transactions into a
JSON filter. Use only the provided category ids and account ids. Resolve
relative dates against TODAY. Amounts are in minor units (×100). If the user
asks "how much", set aggregate to "sum". Respond only with JSON.
```

**User:**
```
TODAY: 2026-06-03. Display currency: CRC.
Accounts: [{"id":"a1","name":"BAC Checking"},{"id":"a2","name":"USD Savings"}]
Categories: [{"id":"13","name":"Coffee Shops","group":"Food & Drink"}, ...]

Question: "how much did I spend on coffee in April?"
```

**Output:**
```json
{ "category_id": "13", "date_from": "2026-04-01", "date_to": "2026-04-30",
  "flow": "outflow", "aggregate": "sum", "sort": "date_desc" }
```

Go then runs the filter, sums the matching outflows, and renders:
"You spent **₡38,400** on Coffee Shops in April across 9 transactions."

## Validation & safety

- Every id checked against the injected whitelist; unknown → dropped.
- Dates clamped to a sane range; `min/max_amount` sanity-checked.
- If parse fails or returns empty, fall back to a literal `text` keyword search.
- Read-only: search can never mutate data.

## Effort

**M.** New endpoint + service + a focused frontend search bar. The repo already
supports filtering by account/category/date; mostly wiring plus the parse call
and chip UI.

## Risks / notes

- Relative-date ambiguity ("last month" near month boundaries) — solved by
  injecting `TODAY` and showing resolved chips for correction.
- Multi-currency sums must use the reports' existing CRC-aggregation logic, not
  the model.
