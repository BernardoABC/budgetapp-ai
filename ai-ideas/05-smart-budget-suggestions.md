# 05 — Smart Plan Suggestions

**Model fit:** Qwen 2.5 7B ✅ as a *hybrid* (math in Go, rationale from LLM) ·
**Effort:** M · **Value:** ★★★★

## Concept

The spending plan's friction is the blank page: each month you set an expected
income and planned amounts per category. This idea proposes a pre-filled plan:
"Here's a suggested plan for June," with a planned amount per category and a
one-line reason each, that the user accepts wholesale or tweaks. Unlike the old
zero-sum model there is no requirement to allocate every colón — whatever
expected income isn't planned simply shows as planned savings.

## Hybrid split — what's deterministic vs LLM

**Deterministic (Go/SQL — the numbers):**
- Trailing 3–6 month average *activity* per category (already queryable).
- Known fixed obligations (rent, internet, insurance) detected as recurring
  (see **[06](./06-recurring-subscription-detection.md)**) — these map naturally
  to `flexibility = 'fixed'` categories.
- The soft constraint: total suggested planned should not exceed expected income
  (`monthly_plans.expected_income`); Go reports the implied planned savings.
  The model is never trusted to make figures add up.

**LLM (the judgment & explanation):**
- Prioritization when money is tight (fixed obligations first, then flexible,
  then non-monthly accruals) — phrased as ranking, not arithmetic.
- A short human reason per category ("based on your ~₡130k/mo groceries average").
- Optional nudges ("your Vacaciones fund balance is still negative from April").

> If you want to keep v1 fully deterministic, the suggestion can be 100% rule
> math and the LLM only writes the rationale text. The model is additive, never
> load-bearing for correctness.

## Where it plugs in

- **`internal/service/budget_service.go`** (the plan service): add
  `SuggestPlan(ctx, month)` returning `[]{category_id, suggested_planned, basis}`.
  This computes averages, applies a priority waterfall, and reports the implied
  left-to-budget.
- **`internal/ai`:** `ExplainPlan(ctx, plan) (map[categoryID]string, error)`
  — takes the finished suggestion and returns one-line reasons. Pure text.
- **New endpoint:** `GET /api/plan/{month}/suggest`.
- **Frontend `Budget.tsx`:** a "✨ Suggest a plan" button fills the Budgeted
  column with ghosted suggested values + reason tooltips; "Apply all" commits,
  or the user edits any cell (existing inline-edit flow). Works in both
  Category and Flex modes (in Flex mode it can also suggest the single
  flexible-budget number from combined flexible-category history).

## Suggestion waterfall (deterministic)

1. Fund `fixed` categories to their detected recurring amount.
2. Fund `flexible` categories to trailing average × (smoothing factor).
3. Suggest accruals for `non_monthly` categories (e.g., 1/n of an annual
   expense, or top-up when the rollover balance is negative).
4. If the total exceeds expected income, scale back in reverse priority order
   and surface the shortfall instead of forcing a balance.

## Prompt sketch (rationale only)

**System:**
```
Given a finished monthly spending plan, write a <=12-word reason for each
category. Do not change any numbers. Respond only with JSON {id: reason}.
```

**User:**
```json
{ "month":"2026-06",
  "expected_income":"₡1,450,000",
  "plans":[
    {"id":"11","name":"Groceries","planned":"₡135,000","avg":"₡132,400","flexibility":"flexible"},
    {"id":"41","name":"Internet","planned":"₡28,000","flexibility":"fixed","recurring":true},
    {"id":"61","name":"Vacaciones","planned":"₡90,000","flexibility":"non_monthly","rollover_balance":"-₡40,000"}
  ]}
```

**Output:**
```json
{ "11":"Matches your ~₡132k monthly average",
  "41":"Fixed recurring bill",
  "61":"Rebuilds your fund after April's overdraw" }
```

## Validation & safety

- Go re-verifies the suggestion totals and computes left-to-budget before
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
- Multi-currency: do the waterfall in canonical CRC using current/stamped
  exchange rates, consistent with how the plan service converts totals; suggest
  per-category amounts in each category's native currency.
