# 00 — AI Infrastructure (shared foundation)

Every other idea assumes this exists. It adds a local model server and a thin Go
client. Build this once.

## Model serving: Ollama as a fourth service

Add an Ollama container alongside `postgres`, `server`, and `frontend` in
`podman-compose.yml`:

```yaml
  ollama:
    image: docker.io/ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama:/root/.ollama
    # Optional GPU passthrough (Arch + NVIDIA):
    # devices:
    #   - nvidia.com/gpu=all

volumes:
  pgdata:
  ollama:
```

Wire the server to it:

```yaml
  server:
    environment:
      # ...existing...
      OLLAMA_URL: http://ollama:11434
      AI_MODEL: qwen2.5:7b-instruct
      AI_ENABLED: "true"
```

First-run model pull (one time, ~4.7 GB for the Q4_K_M quant):

```bash
podman compose exec ollama ollama pull qwen2.5:7b-instruct
```

> **Why Ollama:** it speaks a simple HTTP API, supports JSON-schema-constrained
> output (`format`), runs Qwen 2.5 7B out of the box, and persists pulled models
> in a volume. It also exposes an OpenAI-compatible endpoint if you ever want to
> swap clients.

### Quant guidance for Qwen 2.5 7B

- `qwen2.5:7b-instruct` (Q4_K_M) — default; ~5 GB VRAM / runs on CPU at a few
  tok/s. Good enough for classification and short summaries.
- `qwen2.5:7b-instruct-q8_0` — if you have the RAM/VRAM and want crisper JSON
  adherence.
- All ideas here are sized for the Q4 model; none need the context window beyond
  ~4–8k tokens.

## Go client: `internal/ai`

New package, mirrors the existing `internal/bccr` client style (plain
`net/http`, context-aware, testable via an injectable base URL).

```
server/internal/ai/
  client.go        // Client struct, Complete() and CompleteJSON() methods
  client_test.go   // table tests against an httptest server
  prompts.go       // prompt templates + builders (kept out of business logic)
```

Core surface:

```go
type Client struct {
    httpClient *http.Client
    baseURL    string // OLLAMA_URL
    model      string // AI_MODEL
    enabled    bool   // AI_ENABLED
}

// Complete returns free text for a prompt.
func (c *Client) Complete(ctx context.Context, system, user string) (string, error)

// CompleteJSON constrains output to a JSON schema and unmarshals into out.
// Uses Ollama's `format` field (JSON schema) so the model can't drift.
func (c *Client) CompleteJSON(ctx context.Context, system, user string, schema any, out any) error

// Enabled reports whether AI features should run (AI_ENABLED + reachable).
func (c *Client) Enabled() bool
```

Request shape sent to `POST {baseURL}/api/chat`:

```json
{
  "model": "qwen2.5:7b-instruct",
  "stream": false,
  "format": { "...": "json schema here (for CompleteJSON)" },
  "options": { "temperature": 0.1, "num_ctx": 8192 },
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

### Cross-cutting requirements

- **Timeouts & cancellation.** Every call takes a `context.Context` with a
  deadline (default 20s for single calls, longer for batch). On timeout, the
  caller falls back to non-AI behavior.
- **Feature flag.** `AI_ENABLED=false` (or an unreachable Ollama) makes
  `Enabled()` return false; handlers must check it and degrade gracefully.
- **Low temperature.** Default `temperature: 0.1` for deterministic-ish
  classification and extraction. Narrative ideas (04) can bump to ~0.4.
- **No money math in the model.** The client is only ever handed text to classify
  or summarize. All sums, balances, and rates stay in Go/SQL.
- **Observability.** Log model name, latency, prompt token estimate, and
  fallback events. A tiny `ai_calls` audit table is optional but handy for tuning.

### Testing approach

Follow the existing repo conventions (`internal/bccr/client_test.go`,
`internal/importer/*_test.go`): spin an `httptest.Server` that returns canned
Ollama responses, assert request body and parsed result. No live model needed in
CI. Add one optional integration test gated behind a build tag for local manual
runs against a real Ollama.

## Frontend touchpoints

No new framework needed. AI results arrive through existing or new REST
endpoints and render in the current React components (`Import.tsx`,
`Dashboard.tsx`, `Reports.tsx`, `Budget.tsx`). Each AI surface should show a
subtle "✨ AI" affordance and a non-blocking loading state, and silently hide
when `AI_ENABLED` is false.

## Effort

**M.** A day or two: compose change, ~150 LOC client + tests, env plumbing in
`internal/config`. Everything else builds on top.
