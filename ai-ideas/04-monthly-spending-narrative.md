# 04 — Monthly Spending Narrative

**Model fit:** Qwen 2.5 7B ✅ (summarize pre-computed numbers) · **Effort:** S ·
**Value:** ★★★★

## Concept

The Reports page already computes everything: spending by group/month, income vs
expense, net worth, age of money. This idea adds a short, plain-language
**narrative** on top — a few sentences that tell you what actually happened:

> "May spending was ₡1.18M, about 9% above your 3-month average. The jump came
> mostly from **Restaurants** (₡142k, up ₡48k) and a one-off **Medical** charge
> of ₡95k. **Groceries** held steady. You finished the month with ₡210k left
> unspent across categories — consider moving it to Emergency Fund."

It turns a wall of charts into something a human reads in ten seconds.

## Why it's ideal for a 7B model

The model **never computes anything**. Go/SQL produce all the deltas, averages,
and totals (reusing the existing reports + budget services). The model receives a
compact, already-calculated JSON brief and just writes prose. This is the safest
possible use of a small model — no arithmetic, no hallucinated figures, because
every number it's allowed to say is handed to it.

## Where it plugs in

- **`internal/service`:** a `NarrativeBrief` builder assembles the facts for a
  given month from existing report queries:
  - total spend, total income, net
  - per-group totals + delta vs trailing 3-month average
  - top 3 categories by spend and by *change*
  - notable one-offs (largest single transactions)
  - budget leftover / overspent categories (from `budget_service`)
- **New endpoint:** `GET /api/reports/narrative?month=YYYY-MM` → `{ "text": "..." }`.
  Cache the result keyed by `(month, data_version)`; regenerate only when that
  month's transactions change.
- **`internal/ai`:** `Narrate(ctx, brief) (string, error)`, temperature ~0.4.
- **Frontend `Reports.tsx` / `Dashboard.tsx`:** a "Month in review" card above the
  charts. Non-blocking: shows a skeleton, then the text; hidden if `AI_ENABLED`
  is false.

## Brief → prompt sketch

**System:**
```
You write a brief, friendly month-in-review for a personal budget app.
Use ONLY the numbers in the JSON; never invent or recompute figures.
3–5 sentences. Mention the biggest drivers and any overspent categories.
End with at most one gentle, optional suggestion. Currency: CRC.
```

**User (the computed brief):**
```json
{
  "month": "2026-05",
  "total_spend": 118000000,
  "avg_spend_3mo": 108300000,
  "income": 145000000,
  "net": 27000000,
  "top_changes": [
    {"group":"Restaurants","total":14200000,"delta":4800000},
    {"group":"Medical","total":9500000,"delta":9500000,"one_off":true}
  ],
  "steady": ["Groceries"],
  "overspent": [],
  "unassigned_leftover": 21000000
}
```

(Amounts are minor units; tell the model the divisor or pre-format to strings to
avoid any formatting mistakes — pre-formatting is safest.)

> **Tip:** pre-format every number as a display string in the brief
> (`"₡1,180,000"`) so the model only copies tokens, never formats digits.

## Validation & safety

- Because numbers are pre-formatted strings, the model can only echo them. Still,
  optionally post-check that every currency-looking token in the output appears in
  the brief; if not, fall back to a templated non-AI summary.
- Keep a deterministic fallback summary ("Spent X, earned Y, net Z") for when AI
  is disabled.

## Effort

**S.** The numbers exist; this is a brief-builder + one model call + a card.
Highest "wow per hour" on the list.

## Risks / notes

- Tone/length drift — controlled by the system prompt and low-ish temperature.
- Don't let it moralize; the prompt caps suggestions at one and marks them
  optional.
- Extension: a yearly review, or per-category mini-narratives on the budget page.
