# 02 — Merchant Name Cleanup & Enrichment

**Model fit:** Qwen 2.5 7B ✅ · **Effort:** S · **Value:** ★★★★

## Concept

Bank descriptions are ugly: `"WALMART CURRIDABAT OCN00PSAN J"`,
`"TEF A : 952432326             "`, `"PAGO POS 4099 AUTOMERCADO ESC"`. The
deterministic normalizer in `internal/importer/normalize.go` strips known
suffixes and collapses whitespace for *matching*, but the result is still not a
clean *display* name.

This idea uses the LLM to turn raw bank strings into a tidy, human-readable
**merchant name** for display — `"Walmart"`, `"Automercado (Escazú)"`,
`"Transfer to 952432326"` — while keeping the raw string untouched for audit.

## Why a 7B model is enough

Pure text-to-text normalization with a short output. No reasoning about money.
Qwen 2.5 7B is more than capable; even smaller models do this well. JSON-schema
output keeps it tidy.

## Where it plugs in

- **Schema:** add a nullable `payee_display VARCHAR(255)` column to
  `transactions` (new migration `004_payee_display.sql`). Raw `payee` stays the
  source of truth; `payee_display` is a derived convenience field.
- **`internal/importer`:** during import preview, batch-clean all distinct raw
  payees in one model call (dedupe first — many rows share a merchant).
- **Caching:** key cleaned names by normalized payee in a small
  `merchant_aliases(normalized_payee PK, display_name, source)` table so each
  distinct merchant is cleaned **once, ever**. Subsequent imports look it up
  instead of calling the model.
- **Frontend:** transaction lists (`Accounts.tsx`), dashboard recent activity,
  and reports show `payee_display ?? payee`. A small "edit name" affordance lets
  the user correct it, which updates the alias table (and becomes the learned
  truth).

## Prompt sketch

**System:**
```
You clean Costa Rican bank transaction descriptions into short, human-readable
merchant or counterparty names for a budgeting UI. Keep it under 40 chars.
Preserve a location in parentheses only if clearly present. For transfers and
generic codes, produce a sensible label like "Transfer" or "ATM withdrawal".
Respond only with JSON matching the schema.
```

**User:**
```
[
  {"i":0,"raw":"WALMART CURRIDABAT OCN00PSAN J"},
  {"i":1,"raw":"PAGO POS 4099 AUTOMERCADO ESC"},
  {"i":2,"raw":"TEF A : 952432326             "},
  {"i":3,"raw":"GLOBALVIA RUTA 27 SAN J"}
]
```

**Output:**
```json
{
  "names": [
    {"i":0,"display":"Walmart (Curridabat)"},
    {"i":1,"display":"Automercado (Escazú)"},
    {"i":2,"display":"Transfer to 952432326"},
    {"i":3,"display":"Globalvía (Ruta 27)"}
  ]
}
```

## Validation & safety

- Clamp length; if the model returns empty or absurd output, fall back to the
  deterministic normalized payee.
- Never overwrite a user-edited `payee_display`.
- Pure display-layer — no effect on categorization, balances, or budgets.

## Synergy

Pairs tightly with **[01](./01-llm-categorization-fallback.md)**: clean a payee
and classify it in adjacent steps over the same deduped merchant list. Consider a
single combined call that returns `{display, category_id}` per merchant to halve
round-trips.

## Effort

**S.** One migration, one alias table, one batch call with caching, a display
fallback in the frontend. Cheap and immediately visible on every screen.

## Risks / notes

- Over-cleaning could merge two distinct merchants under one display name —
  mitigated because `payee_display` is display-only and matching still uses the
  raw/normalized payee.
- Spanish accents: ask the model to restore proper accents ("Escazú"); validate
  UTF-8.
