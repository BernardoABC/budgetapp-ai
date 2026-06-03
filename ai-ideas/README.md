# AI Ideas for BudgetApp

Ways to leverage a **local LLM (Qwen 2.5 7B via Ollama)** inside this self-hosted
Costa Rica budgeting app. Since everything runs on your machine, financial data
never leaves it — so we can feed the model raw transaction text freely with zero
privacy tradeoff.

Each idea is its own file with a near-spec level of detail: concept, where it
plugs into the existing Go/React/Postgres stack, prompt sketch with example I/O,
output schema, fallbacks, and an effort estimate.

## Start here

**[00 — AI Infrastructure](./00-ai-infrastructure.md)** — the shared foundation.
Adds an Ollama service to `podman-compose.yml` and a Go `internal/ai` client.
Every idea below assumes this exists, so read it first.

## The ideas

| # | Idea | Model fit | Effort | Value |
|---|------|-----------|--------|-------|
| [01](./01-llm-categorization-fallback.md) | LLM categorization fallback | 7B ✅ | S–M | ★★★★★ |
| [02](./02-merchant-name-cleanup.md) | Merchant name cleanup & enrichment | 7B ✅ | S | ★★★★ |
| [03](./03-natural-language-search.md) | Natural-language transaction search | 7B ✅ | M | ★★★★ |
| [04](./04-monthly-spending-narrative.md) | Monthly spending narrative | 7B ✅ | S | ★★★★ |
| [05](./05-smart-budget-suggestions.md) | Smart budget assignment suggestions | 7B ✅ (hybrid) | M | ★★★★ |
| [06](./06-recurring-subscription-detection.md) | Recurring & subscription detection | 7B ✅ (hybrid) | M | ★★★ |
| [07](./07-anomaly-detection-alerts.md) | Anomaly / unusual-spend alerts | 7B ✅ (hybrid) | M | ★★★ |
| [08](./08-bulk-historical-categorization.md) | Bulk historical categorization (bootstrap) | 7B ✅ | S–M | ★★★★ |
| [09](./09-conversational-assistant.md) | Conversational finance assistant | Stretch ⚠️ | L | ★★★ |
| [10](./10-receipt-vision-extraction.md) | Receipt photo extraction | Stretch ⚠️ (vision) | L | ★★ |

✅ = runs well on Qwen 2.5 7B. ⚠️ = wants a larger model or a different
modality (tool-calling, vision); included to show the ceiling.

## Recommended sequencing

1. **00 infra** — one-time foundation.
2. **01 categorization fallback** — highest leverage; directly improves the app's
   flagship feature (auto-categorization) and reuses the existing `payee_rules`
   learning loop.
3. **02 merchant cleanup** — cheap, pairs naturally with 01, improves every screen.
4. **04 monthly narrative** — cheap, high "wow", numbers are already computed.
5. **08 bulk bootstrap** — one-shot batch job that makes 01 pay off immediately on
   existing data.
6. Then 03 / 05 / 06 / 07 as appetite allows.
7. **09 / 10** are stretch — revisit if you upgrade past a 7B text model.

## Design principles used throughout

- **Deterministic first, LLM second.** The model is a *fallback or enrichment*
  layer, never the source of truth for money math. All amounts, balances, and
  budget arithmetic stay in Go/SQL.
- **Constrained outputs.** The model classifies into a fixed category list or
  emits a strict JSON schema — never free-form SQL or free-form numbers.
- **Cache and learn.** LLM decisions feed back into the existing `payee_rules`
  table so the deterministic engine keeps getting smarter and the model is called
  less over time.
- **Graceful degradation.** If Ollama is down or slow, every feature falls back to
  current behavior (uncategorized, no summary, etc.). The app never blocks on the
  model.
