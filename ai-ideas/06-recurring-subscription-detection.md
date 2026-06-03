# 06 — Recurring & Subscription Detection

**Model fit:** Qwen 2.5 7B ✅ as a *hybrid* (detection in Go, labeling by LLM) ·
**Effort:** M · **Value:** ★★★

## Concept

Surface the user's recurring commitments — rent, internet, insurance (INS),
streaming subscriptions, gym, loan payments — automatically. Show a "Recurring"
panel: what repeats, how often, how much, next expected date, and a total monthly
commitment. Flag likely price increases and "haven't seen this in a while"
(possible cancellation or missed payment).

## Hybrid split

**Deterministic (Go/SQL — the detection):**
Recurrence is a pattern-matching problem, not a language problem. Group
transactions by normalized payee; within each group detect:
- roughly constant amount (within a tolerance band)
- regular cadence (monthly / biweekly / yearly) via gaps between dates
- ≥3 occurrences to qualify
Output: candidate recurring series with period, typical amount, last seen, next
expected. This is deterministic and testable like the existing importer logic.

**LLM (the semantics):**
- Decide whether a detected series is a true **subscription/bill** vs incidental
  repetition (you buy groceries weekly, but that's not a "subscription").
- Produce a clean label and type: `{name, kind: subscription|utility|rent|loan|
  insurance|membership|other}`.
- Optionally guess cadence label from the merchant when data is sparse.

## Where it plugs in

- **`internal/service`:** new `RecurringService.Detect(ctx)` doing the grouping +
  cadence math (pure Go over `transaction_repo`).
- **`internal/ai`:** `ClassifyRecurring(ctx, series []SeriesSummary) ([]Label,
  error)` — batch classify the candidate series into kind + display name.
- **New endpoint:** `GET /api/insights/recurring`.
- **Frontend:** a "Recurring & Subscriptions" card on `Dashboard.tsx` (and a
  feed-in to budget suggestions, idea 05). Shows monthly commitment total,
  upcoming charges, and ⚠️ for amount jumps or overdue series.

## Series summary → prompt sketch

**System:**
```
Classify each recurring transaction series for a budget app. Decide if it's a
genuine subscription/bill/loan/insurance/membership/utility, or just incidental
repetition (e.g. groceries, restaurants). Provide a clean display name.
Respond only with JSON.
```

**User:**
```json
[
  {"i":0,"payee":"NETFLIX.COM","amount":"₡6,900","period":"monthly","count":7},
  {"i":1,"payee":"INS SEGUROS","amount":"₡42,000","period":"monthly","count":12},
  {"i":2,"payee":"AUTOMERCADO ESCAZU","amount":"~₡40,000","period":"weekly","count":30}
]
```

**Output:**
```json
{ "series":[
  {"i":0,"is_recurring_commitment":true,"kind":"subscription","name":"Netflix"},
  {"i":1,"is_recurring_commitment":true,"kind":"insurance","name":"INS Insurance"},
  {"i":2,"is_recurring_commitment":false,"kind":"other","name":"Automercado groceries"}
]}
```

## Validation & safety

- Amounts, cadence, and next-date math are all Go-computed; the model only labels.
- "Price increase" alerts come from the deterministic amount band, not the model.
- No mutations — this is a read-only insight surface (optionally lets the user
  pin/dismiss a series, stored in a small `recurring_series` table if you want
  persistence + next-charge reminders).

## Effort

**M.** The cadence detector is the real work (and is genuinely useful even with
AI off — it can fall back to "every merchant seen ≥3× on a regular cadence").
The LLM layer is a single batch classification call.

## Risks / notes

- Variable-amount subscriptions (usage-based bills like electricity/ICE) need a
  wider tolerance band — tune per `kind`.
- Feeds idea **[05](./05-smart-budget-suggestions.md)** (fund obligations first)
  and could power proactive "Netflix charges in 3 days" reminders.
