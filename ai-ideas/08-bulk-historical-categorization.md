# 08 — Bulk Historical Categorization (Bootstrap)

**Model fit:** Qwen 2.5 7B ✅ · **Effort:** S–M · **Value:** ★★★★

## Concept

A one-shot batch job that goes through **all existing uncategorized
transactions** and proposes categories for every distinct merchant at once, then
presents them for one bulk review-and-accept. This "primes the pump": it turns a
fresh install (or a pile of historical imports) into a fully categorized history
and, crucially, **seeds the `payee_rules` table** so the deterministic engine and
idea **[01](./01-llm-categorization-fallback.md)** immediately have something to
work with.

Where idea 01 runs *per import* on the few unmatched rows, this runs *once over
everything* to clear a backlog.

## Why it's a great 7B task

It's the same constrained classification as idea 01, just at scale and offline (no
latency pressure — it's a background job, not an interactive path). You can use a
larger batch size and, if desired, a higher-quality quant for this one-time run.

## Where it plugs in

- **Reuses idea 01's** `CategorizeBatch` entirely. The only new parts are job
  orchestration and the bulk-review UI.
- **`internal/service`:** `BootstrapCategorization.Run(ctx)`:
  1. `SELECT DISTINCT normalized_payee` from transactions where `category_id IS
     NULL`, with counts and sample amounts.
  2. Chunk into batches (e.g. 40 merchants/call) and classify.
  3. Group the proposals back to all matching transactions.
- **New endpoints:**
  - `POST /api/categorize/bootstrap` → kicks off the job, returns a job id.
  - `GET /api/categorize/bootstrap/{id}` → progress + proposals.
- Because it can be long-running, run it as a background goroutine with progress
  polling (or stream). Idempotent: re-running only touches still-uncategorized
  rows.
- **Frontend:** a "Categorize my history with AI" action (Settings or
  Dashboard). Shows a table grouped by merchant — proposed category, transaction
  count, total amount — with per-merchant accept/override and a global "Accept
  all high-confidence" button.

## Flow

```
uncategorized txns
   → distinct merchants (+counts, sample amounts, codes)
      → LLM batch classify (idea 01 prompt/schema)
         → group proposals to all txns of that merchant
            → bulk review UI
               → on accept: write category_id to txns
                          + create/Update payee_rules (existing learning loop)
```

## Validation & safety

- Same id-whitelist validation as idea 01 (drop hallucinated ids).
- **Nothing is written until the user accepts.** Accepting a merchant applies its
  category to every matching transaction in one transaction (DB), and creates the
  `payee_rules` row so it's permanent learned knowledge.
- Confidence sorting puts safe bulk-accepts at the top and "please check these" at
  the bottom.

## Effort

**S–M.** If idea 01 exists, the classification is free; the work is the job runner
(progress + chunking) and the grouped review table. Without 01, build 01's batch
call first — they share it.

## Risks / notes

- Large histories → many distinct merchants; chunk and show progress. Even a few
  hundred merchants is a handful of model calls.
- Great companion to a fresh import-heavy onboarding: import everything, then run
  bootstrap once to categorize months of history in a single review pass.
