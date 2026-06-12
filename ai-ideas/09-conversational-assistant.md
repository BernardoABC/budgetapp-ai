# 09 — Conversational Finance Assistant (STRETCH)

**Model fit:** Stretch ⚠️ — works on Qwen 2.5 7B for simple turns but benefits a
lot from a larger / stronger tool-calling model · **Effort:** L · **Value:** ★★★

## Concept

A chat panel where you ask open-ended questions and get answers grounded in your
real data, across turns:

> "Can I afford a ₡400k trip in August?"
> → "You've averaged ₡180k/mo surplus over 4 months and Travel has ₡220k saved.
> At that pace you'd reach ₡400k by late August without touching Emergency Fund."

It's idea **[03](./03-natural-language-search.md)** (NL → query) plus
**[04](./04-monthly-spending-narrative.md)** (narrate numbers) plus
**multi-turn reasoning and tool use**: the model decides *which* lookups to run,
runs them via whitelisted tools, and composes an answer.

## Why it's flagged stretch

- **Tool-calling reliability.** The assistant is only safe if the model reliably
  emits well-formed tool calls against a fixed schema and never fabricates
  figures. Qwen 2.5 7B can do basic function-calling but gets shakier with
  multi-step plans, follow-up disambiguation, and "don't make up numbers" under
  pressure. A 14B/32B (or a hosted model, if you ever relax the local-only
  constraint) is markedly more dependable here.
- **Compounding error.** Multi-turn + multi-tool means small parsing errors
  cascade. The other ideas are single-shot and easy to validate; this one isn't.

You *can* ship a constrained version on 7B (see below) and upgrade the model later
without rearchitecting.

## Architecture (tool-use, read-only)

The model is given a small set of **whitelisted, read-only tools** — it never
writes data and never does money math itself:

| Tool | Backed by | Returns |
|------|-----------|---------|
| `search_transactions(filter)` | idea 03's validated DSL + repo | rows + sum |
| `category_activity(month, group?)` | reports/budget services | computed totals |
| `plan_status(month)` | plan service | planned/actual/remaining, left to budget |
| `recurring_commitments()` | idea 06 | series list + monthly total |
| `net_worth(range)` | reports service | computed series |

Loop: user message → model proposes a tool call (constrained JSON) → Go validates
& executes → result fed back → model answers or calls another tool → final prose
answer citing the returned numbers.

## Where it plugs in

- **`internal/ai`:** an agent loop with a tool registry; strict JSON tool-call
  schema via Ollama `format`; a hard cap on tool-call iterations per turn (e.g.
  4) to bound latency and runaway loops.
- **`internal/service`:** each tool maps to an existing service method — no new
  data access, just a safe dispatch layer over what ideas 03–07 already build.
- **New endpoint:** `POST /api/assistant/chat` with a server-held short
  conversation context (or stateless with client-sent history).
- **Frontend:** a slide-over chat panel; render tool calls as transparent
  "looked up: Restaurants, May" chips so answers are auditable.

## Validation & safety

- **Read-only tools only.** No tool can mutate; the assistant cannot move money,
  edit the plan, or delete anything (those stay manual actions).
- **Every number must come from a tool result.** Post-validate that figures in the
  answer appear in tool outputs; otherwise append a "based on a rough estimate"
  hedge or refuse.
- **Iteration cap + timeout** prevent loops.
- Honest uncertainty: prompt the model to say "I'm not sure" rather than
  fabricate.

## Effort

**L.** The agent loop, tool registry, validation, and chat UI are substantial —
and most valuable *after* ideas 03–07 exist, since the tools are those features.

## Recommendation

Treat this as the **capstone**, not an early build. Ship the single-shot ideas
first (they deliver most of the value with far less risk), then layer chat on top.
Re-evaluate model choice when you start it — if 7B tool-calling proves flaky,
either gate the feature behind a bigger local model or keep it to 1–2 tool hops.

## Risks / notes

- Conversation context can balloon tokens; summarize older turns.
- Resist scope creep into write-actions ("set my grocery budget to X") — keep it
  advisory in v1; write-capable agents need a much higher safety bar.
