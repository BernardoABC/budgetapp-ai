# 01 — LLM Categorization Fallback

**Model fit:** Qwen 2.5 7B ✅ (classification is its sweet spot) · **Effort:** S–M
· **Value:** ★★★★★

## Concept

Today auto-categorization is a deterministic ladder (exact → prefix → fuzzy match
in `internal/importer/categorize.go`). When nothing matches, the transaction is
left uncategorized and the user does it by hand. This idea adds one more rung at
the bottom: **when the rule engine returns no match (or only a LOW-confidence
fuzzy match), ask the local LLM to classify the payee into one of the existing
categories.**

This is the single highest-leverage AI feature because it directly amplifies the
app's flagship differentiator, and it slots into an architecture that was already
designed for a confidence ladder.

## Why it fits a 7B model perfectly

It is **constrained single-label classification**, not generation. The model picks
one ID from a fixed list of ~30 seeded categories. Qwen 2.5 7B handles this
reliably, especially with JSON-schema-constrained output (idea 00). Costa Rican
merchant names ("AUTOMERCADO", "GASOLINERA DELTA", "FARMACIA LA BOMBA",
"GLOBALVIA") are common enough to be in the model's knowledge, and the few that
aren't are guessable from context (amount, transaction code).

## Where it plugs in

- **`internal/importer/categorize.go`** — extend the categorizer with an optional
  `aiFallback` step. The existing function returns a category + confidence; add a
  new `ConfidenceAI` (or reuse `LOW`) tier for model-derived suggestions.
- **`internal/service/import_service.go`** — during preview generation, after the
  rule ladder runs, collect all still-uncategorized transactions and send them to
  the AI client in a **single batched call** (one prompt, N transactions) to keep
  latency low.
- **`internal/ai`** — new `CategorizeBatch(ctx, payees []PayeeContext, categories
  []Category) ([]Suggestion, error)`.
- **Frontend `Import.tsx`** — AI suggestions render in the existing confidence UI
  with a distinct "✨ suggested" badge (purple), clearly weaker than a green
  HIGH rule match so the user knows to glance at it.

## Data the model receives

For each uncategorized transaction:
- normalized payee (already produced by the import pipeline)
- amount sign + rough magnitude bucket (e.g. "outflow ~₡25,000")
- transaction code hint (`CP` card purchase, `TF` transfer, `PP` payroll)

The fixed category list (id + group + name) is injected once per prompt.

## Prompt sketch

**System:**
```
You categorize Costa Rican bank transactions for a personal budget app.
Choose exactly one category id from the provided list for each transaction.
If genuinely unclear, use category id "" (empty). Never invent ids.
Respond only with JSON matching the schema.
```

**User:**
```
Categories:
- 11 (Food & Drink / Groceries)
- 12 (Food & Drink / Restaurants)
- 21 (Transportation / Gas)
- 23 (Transportation / Tolls)
- 41 (Bills / Internet)
...

Transactions:
[
  {"i": 0, "payee": "AUTOMERCADO ESCAZU", "flow": "outflow ~₡42,000", "code": "CP"},
  {"i": 1, "payee": "GLOBALVIA RUTA 27",  "flow": "outflow ~₡1,200",  "code": "CP"},
  {"i": 2, "payee": "TEF A 952432326",    "flow": "outflow ~₡367,000","code": "TF"}
]
```

**Constrained JSON output:**
```json
{
  "results": [
    {"i": 0, "category_id": "11", "confidence": "high"},
    {"i": 1, "category_id": "23", "confidence": "high"},
    {"i": 2, "category_id": "",   "confidence": "low"}
  ]
}
```

Output schema passed via Ollama `format`:
```json
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "i": {"type": "integer"},
          "category_id": {"type": "string"},
          "confidence": {"type": "string", "enum": ["high","medium","low"]}
        },
        "required": ["i","category_id","confidence"]
      }
    }
  },
  "required": ["results"]
}
```

## Validation & safety

- **Reject hallucinated ids.** After parsing, drop any `category_id` not in the
  injected list. Treat as no-suggestion.
- **Never auto-commit.** AI suggestions are always *suggestions* in the import
  review screen, applied only when the user accepts (consistent with current
  MEDIUM/LOW behavior). They do not silently write transactions.
- **Learning loop reuse.** When the user accepts an AI suggestion, the existing
  payee-rule learning kicks in unchanged: a `payee_rules` row is created so the
  *next* time that merchant appears, the deterministic engine handles it and the
  model is never called for it again. The model's job shrinks over time.

## Fallback behavior

If `AI_ENABLED` is false, Ollama is unreachable, or the call times out, the
transaction simply stays uncategorized exactly as today. No regression.

## Effort

**S–M.** The hard parts (normalization, confidence UI, rule learning) already
exist. New work: the batch AI call, schema validation, one new confidence tier,
and a badge in `Import.tsx`. Reuses idea 00's client.

## Risks / notes

- Latency: batching all uncategorized rows from one import into a single call
  keeps it to one model round-trip per import (typically <10s on CPU for a
  handful of rows).
- Quality drift on obscure local merchants — mitigated by the user-accept gate
  and the learning loop, which quickly converts good guesses into hard rules.
