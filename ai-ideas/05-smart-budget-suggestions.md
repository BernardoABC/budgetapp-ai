# 05 — Smart Budget Assignment Suggestions

**Model fit:** Qwen 2.5 7B ✅ as a *hybrid* (math in Go, rationale from LLM) ·
**Effort:** M · **Value:** ★★★★

## Concept

Zero-based budgeting's friction is the blank page: every month you must assign
"Ready to Assign" across categories until it hits zero. This idea proposes a
plan: "Here's how to distribute your ₡1,450,000 this month," pre-filled per
category, with a one-line reason each, that the user accepts wholesale or tweaks.

## Hybrid split — what's deterministic vs LLM

**Deterministic (Go/SQL — the numbers):**
- Trailing 3–6 month average *activity* per category (already queryable).
- Known fixed obligations (rent, internet, insurance) detected as recurring
  (see **[06](./06-recurring-subscription-detection.md)**).
- The hard constraint: suggested assignments **must sum to exactly** Ready to
  Assign. Go does the allocation arithmetic and the final balancing so it always
  zeroes out — the model is never trusted to make figures add up.

**LLM (the judgment & explanation):**
- Prioritization when money is tight (cover obligations first, then variable, then
  goals) — phrased as ranking, not arithmetic.
- A short human reason per category ("based on your ~₡130k/mo groceries average").
- Optional nudges ("you underfunded Emergency Fund the last 2 months").

> If you want to keep v1 fully deterministic, the allocation can be 100% rule
> math and the LLM only writes the rationale text. The model is additive, never
> load-bearing for correctness.

## Where it plugs in

- **`internal/service/budget_service.go`:** add `SuggestAssignments(ctx, month)`
  returning `[]{category_id, suggested_assigned, basis}`. This computes averages,
  applies a priority waterfall, and balances to Ready-to-Assign.
- **`internal/ai`:** `ExplainBudgetPlan(ctx, plan) (map[categoryID]string, error)`
  — takes the finished allocation and returns one-line reasons. Pure text.
- **New endpoint:** `GET /api/budget/suggest?month=YYYY-MM`.
- **Frontend `Budget.tsx`:** a "✨ Suggest a plan" button fills the Assigned
  column with ghosted suggested values + reason tooltips; "Apply all" commits,
  or the user edits any cell (existing inline-edit flow).

## Allocation waterfall (deterministic)

1. Fund recurring obligations to their detected amount.
2. Fund variable categories to trailing average × (smoothing factor).
3. Distribute remainder to savings-goal categories (by target if present —
   `category_targets` already exists per migration `003`).
4. Rounding remainder lands in a configurable default (e.g. Ready-to-Assign stays
   0 by dumping the last colón into Emergency Fund).

## Prompt sketch (rationale only)

**System:**
```
Given a finished monthly budget allocation, write a <=12-word reason for each
category. Do not change any numbers. Respond only with JSON {id: reason}.
```

**User:**
```json
{ "month":"2026-06",
  "allocations":[
    {"id":"11","name":"Groceries","assigned":"₡135,000","avg":"₡132,400"},
    {"id":"41","name":"Internet","assigned":"₡28,000","recurring":true},
    {"id":"61","name":"Emergency Fund","assigned":"₡90,000","target":"₡100,000/mo"}
  ]}
```

**Output:**
```json
{ "11":"Matches your ~₡132k monthly average",
  "41":"Fixed recurring bill",
  "61":"Toward your ₡100k/mo goal" }
```

## Validation & safety

- Go re-verifies the suggested assignments sum to Ready-to-Assign before
  returning; if the LLM were ever in the allocation path, a mismatch forces the
  deterministic plan.
- Suggestions are never auto-applied; the user clicks Apply.

## Effort

**M.** The averaging queries and inline-edit UI exist; new work is the waterfall
allocator, the rationale call, and the suggest button. Bulk of effort is the
deterministic allocator, which is valuable even with AI off.

## Risks / notes

- "Average" can be skewed by one-offs — exclude flagged one-offs (anomaly idea
  07) or use median.
- Multi-currency: do the waterfall in canonical CRC using stamped exchange rates,
  consistent with the budgeting model.
