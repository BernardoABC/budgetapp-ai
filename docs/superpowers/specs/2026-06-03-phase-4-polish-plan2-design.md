# Phase 4 — Payee Rules CRUD + Polish Sweep (Plan 2)

## Scope

- Backend: Payee Rules CRUD (`GET`, `POST`, `PUT`, `DELETE /api/payee-rules`)
- Frontend: `api.ts` additions for payee rules
- Frontend: Import.tsx — tab bar + RulesManager (inline component)
- Frontend: Import preview uses live rules instead of `AppData.payeeRules`
- Frontend: Polish sweep — loading/error states and toast across Dashboard, Budget, Reports, Import

**Out of scope:** Keyboard shortcuts, CSV export, recurring transaction detection, Phase 5 features.

---

## 1. Backend — Payee Rules CRUD

### 1.1 Repo additions (`server/internal/repository/payee_rule_repo.go`)

Three new methods added to `PayeeRuleRepo`:

```go
func (r *PayeeRuleRepo) Create(ctx context.Context, pattern, categoryID string) (model.PayeeRule, error)
func (r *PayeeRuleRepo) Update(ctx context.Context, id, pattern, categoryID string) (model.PayeeRule, error)
func (r *PayeeRuleRepo) Delete(ctx context.Context, id string) error
```

- `Create`: INSERT into `payee_rules` with `match_count = 0`. Returns the new row. Conflicts on `payee_pattern` are an error (duplicate patterns not allowed).
- `Update`: UPDATE `payee_pattern` and `category_id` by `id::uuid`. Preserves `match_count`. Returns updated row.
- `Delete`: DELETE by `id::uuid`. Returns `repository.ErrNotFound` if no row matched.

### 1.2 Handler (`server/internal/handler/payee_rules.go`)

New file. `PayeeRuleHandler` wraps `*repository.PayeeRuleRepo`.

```go
type PayeeRuleHandler struct{ repo *repository.PayeeRuleRepo }
func NewPayeeRuleHandler(repo *repository.PayeeRuleRepo) *PayeeRuleHandler
```

Four methods:

| Method | Route | Behaviour |
|--------|-------|-----------|
| `List` | `GET /api/payee-rules` | Calls `repo.List`, returns JSON array |
| `Create` | `POST /api/payee-rules` | Reads `{payee_pattern, category_id}`, validates non-empty, calls `repo.Create`, returns 201 + body |
| `Update` | `PUT /api/payee-rules/{id}` | Reads `{payee_pattern, category_id}`, validates non-empty, calls `repo.Update`, returns 200 + body |
| `Delete` | `DELETE /api/payee-rules/{id}` | Calls `repo.Delete`, returns 204 on success, 404 if not found |

Validation errors return `HTTP 400 {"error":{"code":"VALIDATION_ERROR","message":"..."}}`.

Response shape: `model.PayeeRule` has no json tags, so handlers use an anonymous struct (same pattern as `CategoryHandler`):
```go
type ruleResp struct {
    ID         string `json:"id"`
    Pattern    string `json:"payee_pattern"`
    CategoryID string `json:"category_id"`
    MatchCount int    `json:"match_count"`
}
```
JSON wire format:
```json
{ "id": "uuid", "payee_pattern": "walmart", "category_id": "uuid", "match_count": 12 }
```

### 1.3 Routes (`server/main.go`)

```go
rules := handler.NewPayeeRuleHandler(ruleRepo)
mux.HandleFunc("GET /api/payee-rules",        rules.List)
mux.HandleFunc("POST /api/payee-rules",        rules.Create)
mux.HandleFunc("PUT /api/payee-rules/{id}",    rules.Update)
mux.HandleFunc("DELETE /api/payee-rules/{id}", rules.Delete)
```

Added after the Categories block.

---

## 2. Frontend — api.ts additions

### 2.1 New type

```ts
export interface PayeeRule {
  id: string;
  pattern: string;      // maps from payee_pattern
  category_id: string;
  match_count: number;
}
```

### 2.2 New functions

```ts
export async function fetchPayeeRules(): Promise<PayeeRule[]>
export async function createPayeeRule(pattern: string, categoryId: string): Promise<PayeeRule>
export async function updatePayeeRule(id: string, pattern: string, categoryId: string): Promise<PayeeRule>
export async function deletePayeeRule(id: string): Promise<void>
```

- `fetchPayeeRules`: maps `payee_pattern` → `pattern` on each item.
- `createPayeeRule` / `updatePayeeRule`: POST/PUT body uses `payee_pattern` (server field name); maps response back to `PayeeRule`.
- `deletePayeeRule`: expects 204 (already handled by `apiFetch` 204 guard).

---

## 3. Frontend — Import.tsx

### 3.1 Tab bar

Added above the existing content. Two tabs: **Import** and **Rules**. State: `const [tab, setTab] = useState<'import' | 'rules'>('import')`.

When `tab === 'import'`: existing wizard content renders unchanged.
When `tab === 'rules'`: `<RulesManager>` renders; the wizard is hidden (not unmounted — preserving wizard state if user switches back mid-flow).

Tab styling consistent with existing app inline style patterns.

### 3.2 RulesManager component (inline in Import.tsx)

```tsx
function RulesManager({ categoryGroups }: { categoryGroups: CategoryGroup[] })
```

State:
```ts
const [rules, setRules] = useState<PayeeRule[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [adding, setAdding] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);
const [form, setForm] = useState({ pattern: '', categoryId: '' });
```

**Load:** `useEffect` fetches `fetchPayeeRules()` on mount. Sets `loading = false` after. On error sets `error` message.

**Table:** Columns — Pattern (monospace), Category (name looked up from `categoryGroups`), Used (`{match_count}×`), Actions (✎ edit / ✕ delete buttons).

**Empty state:** "No rules yet — add one to auto-categorize imports."

**Add flow:** "+ Add Rule" button sets `adding = true`, reveals inline form below table. Form has pattern text input and category dropdown (populated from `categoryGroups`, flattened to all categories). Save calls `createPayeeRule` → `toast.success('Rule saved')` → refetch → `adding = false`. Cancel resets form.

**Edit flow:** Clicking ✎ sets `editingId = rule.id` and pre-fills `form`. The row renders as editable inputs in-place. Save calls `updatePayeeRule` → `toast.success('Rule updated')` → refetch → `editingId = null`. Cancel resets without saving.

**Delete:** Clicking ✕ calls `window.confirm('Delete this rule?')`. On confirm, calls `deletePayeeRule(id)` → `toast.success('Rule deleted')` → refetch.

### 3.3 Import preview uses live rules

`ImportWizard` component fetches `fetchPayeeRules()` on mount into `const [liveRules, setLiveRules] = useState<PayeeRule[]>([])`.

The `SAMPLE_PARSED` constant is replaced: when real file data is parsed in Step 2, it uses `liveRules` for auto-categorization via `categorize(payee, liveRules)`.

The `SAMPLE_PARSED`/`SAMPLE_RAW` constants remain for the demo/placeholder state (Step 1 before a file is chosen), but real parsed data always uses live rules.

---

## 4. Frontend — Polish Sweep

All views consume `useToast()` from the existing `ToastProvider` in `App.tsx`. No provider changes needed.

### 4.1 Dashboard

```ts
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState<string | null>(null);
```

`useEffect` wraps `fetchRecentTransactions(20)`:
- On success: `setTransactions(data); setLoading(false)`
- On error: `setLoadError(err.message); setLoading(false)`

Recent transactions section: while `loading`, show a subtle dim text "Loading…" in place of the table. On `loadError`, show an inline error message + "Retry" button (clicking resets `loadError`, `loading` to true and re-fetches).

### 4.2 Budget

No loading state changes (Budget already renders month data immediately on tab switch and fetches asynchronously — adding a full spinner would cause layout shift on every month change, which is undesirable).

Replace all `console.error` calls with `toast.error(err.message)`:
- `fetchBudget` failure → error banner at top of Budget view (persistent, with Retry button) in addition to toast
- `apiSetAssigned`, `copyPreviousBudget`, `moveBudgetMoney`, rename category, delete category, create category, delete group, create group, `upsertTarget`, `deleteTarget` → each catch block calls `toast.error(err.message)`

### 4.3 Reports

```ts
const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState<string | null>(null);
```

`useEffect` wraps `fetchSpendingReport(from, to)`:
- On success: `setData(rows); setLoading(false)`
- On error: `setLoadError(err.message); setLoading(false)`

Chart area: while `loading`, show a placeholder div with "Loading report…" text. On `loadError`, show error banner + Retry. The existing `data.length < 2` empty guard in the chart components is preserved.

### 4.4 Import — history section

The existing `fetchImportHistory` catch replaces `console.warn` with `toast.error(err.message)`. Add a loading state for the import history table: while loading show "Loading import history…"; on error show a small error message inline (no full banner needed — this is a secondary section).

---

## 5. Constraints

- Inline styles only — no CSS files, no Tailwind.
- No new dependencies.
- `go test ./...` and `npm run build` must pass before done.
- Money in centimos server-side; major-unit conversion in `api.ts` only (payee rules have no money fields).
