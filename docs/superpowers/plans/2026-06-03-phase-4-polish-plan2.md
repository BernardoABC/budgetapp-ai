# Phase 4 Polish Plan 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Payee Rules CRUD (backend + frontend tab in Import) and replace silent console errors with toast notifications + loading/error states across Dashboard, Budget, Reports, and Import.

**Architecture:** Backend gains Create/Update/Delete methods on PayeeRuleRepo and a new PayeeRuleHandler with four routes. Frontend adds api.ts CRUD functions, a RulesManager tab inside Import.tsx (using live rules for auto-categorization preview), and polish pass replacing all console.error/warn calls with useToast across four views.

**Tech Stack:** Go 1.26 / pgx v5 / PostgreSQL backend; React 19 + TypeScript + Vite frontend; inline styles only (no CSS files or Tailwind); money in centimos server-side, major-unit conversion in api.ts only.

---

## File Map

**Create:**
- `server/internal/repository/payee_rule_repo_test.go` — repo CRUD tests
- `server/internal/handler/payee_rules.go` — HTTP handler (List/Create/Update/Delete)

**Modify:**
- `server/internal/repository/payee_rule_repo.go` — add Create, Update, Delete methods
- `server/main.go` — register 4 payee rule routes
- `frontend/src/api.ts` — add PayeeRule interface + 4 CRUD functions
- `frontend/src/App.tsx` — pass categoryIdByName to ImportWizard
- `frontend/src/components/Import.tsx` — tab bar, RulesManager, live rules, history polish
- `frontend/src/components/Dashboard.tsx` — loading/error state for recent transactions
- `frontend/src/components/Budget.tsx` — useToast replacing all console.error calls + error banner
- `frontend/src/components/Reports.tsx` — loading/error state for spending chart

---

### Task 1: PayeeRuleRepo — Create, Update, Delete

**Files:**
- Modify: `server/internal/repository/payee_rule_repo.go`
- Create: `server/internal/repository/payee_rule_repo_test.go`

- [ ] **Step 1: Write failing tests**

Create `server/internal/repository/payee_rule_repo_test.go`:

```go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestPayeeRuleCRUD(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewPayeeRuleRepo(pool)
	ctx := context.Background()
	catID := testutil.SeedCategory(t, pool)

	// Create
	rule, err := repo.Create(ctx, "walmart", catID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rule.Pattern != "walmart" {
		t.Errorf("Pattern = %q, want %q", rule.Pattern, "walmart")
	}
	if rule.MatchCount != 0 {
		t.Errorf("MatchCount = %d, want 0", rule.MatchCount)
	}
	if rule.ID == "" {
		t.Error("ID is empty")
	}

	// List includes new rule
	rules, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	found := false
	for _, r := range rules {
		if r.ID == rule.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("created rule not found in List")
	}

	// Update pattern
	updated, err := repo.Update(ctx, rule.ID, "walmart-cr", catID)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Pattern != "walmart-cr" {
		t.Errorf("updated Pattern = %q", updated.Pattern)
	}
	if updated.MatchCount != 0 {
		t.Errorf("Update should preserve MatchCount, got %d", updated.MatchCount)
	}

	// Delete
	if err := repo.Delete(ctx, rule.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	rules2, _ := repo.List(ctx)
	for _, r := range rules2 {
		if r.ID == rule.ID {
			t.Error("rule still present after Delete")
		}
	}
}

func TestPayeeRuleDeleteNotFound(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewPayeeRuleRepo(pool)
	ctx := context.Background()

	err := repo.Delete(ctx, "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("expected ErrNotFound, got nil")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/Berny/budgetapp-ai/server
go test ./internal/repository/ -run TestPayeeRule -v
```

Expected: FAIL with "undefined: repository.PayeeRuleRepo.Create"

- [ ] **Step 3: Implement Create, Update, Delete in payee_rule_repo.go**

Add these three methods at the end of `server/internal/repository/payee_rule_repo.go`, before the closing line. Also add `"github.com/jackc/pgx/v5"` to the imports block alongside the existing imports:

```go
// Create inserts a new rule with match_count = 0.
func (r *PayeeRuleRepo) Create(ctx context.Context, pattern, categoryID string) (model.PayeeRule, error) {
	var p model.PayeeRule
	err := r.pool.QueryRow(ctx, `
		INSERT INTO payee_rules (payee_pattern, category_id, match_count)
		VALUES ($1, $2::uuid, 0)
		RETURNING id::text, payee_pattern, category_id::text, match_count
	`, pattern, categoryID).Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount)
	if err != nil {
		return p, fmt.Errorf("create payee rule: %w", err)
	}
	return p, nil
}

// Update changes the pattern and category of an existing rule, preserving match_count.
func (r *PayeeRuleRepo) Update(ctx context.Context, id, pattern, categoryID string) (model.PayeeRule, error) {
	var p model.PayeeRule
	err := r.pool.QueryRow(ctx, `
		UPDATE payee_rules
		SET payee_pattern = $1, category_id = $2::uuid, updated_at = NOW()
		WHERE id = $3::uuid
		RETURNING id::text, payee_pattern, category_id::text, match_count
	`, pattern, categoryID, id).Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return p, ErrNotFound
		}
		return p, fmt.Errorf("update payee rule: %w", err)
	}
	return p, nil
}

// Delete removes a rule by ID. Returns ErrNotFound if the rule does not exist.
func (r *PayeeRuleRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM payee_rules WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("delete payee rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
```

Also update the import block at the top of `payee_rule_repo.go` to add two packages:

```go
import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/Berny/budgetapp-ai/server
go test ./internal/repository/ -run TestPayeeRule -v
```

Expected: PASS (or SKIP if no test DB — that is also acceptable)

- [ ] **Step 5: Verify build**

```bash
cd /home/Berny/budgetapp-ai/server
go build ./...
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add server/internal/repository/payee_rule_repo.go server/internal/repository/payee_rule_repo_test.go
git commit -m "feat: add PayeeRuleRepo Create/Update/Delete methods"
```

---

### Task 2: Payee Rules HTTP Handler + Routes

**Files:**
- Create: `server/internal/handler/payee_rules.go`
- Modify: `server/main.go`

- [ ] **Step 1: Create server/internal/handler/payee_rules.go**

```go
package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/repository"
)

type PayeeRuleHandler struct {
	repo *repository.PayeeRuleRepo
}

func NewPayeeRuleHandler(repo *repository.PayeeRuleRepo) *PayeeRuleHandler {
	return &PayeeRuleHandler{repo: repo}
}

type ruleResp struct {
	ID         string `json:"id"`
	Pattern    string `json:"payee_pattern"`
	CategoryID string `json:"category_id"`
	MatchCount int    `json:"match_count"`
}

func toRuleResp(p interface{ GetID() string }) ruleResp { return ruleResp{} }

func (h *PayeeRuleHandler) List(w http.ResponseWriter, r *http.Request) {
	rules, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]ruleResp, len(rules))
	for i, p := range rules {
		resp[i] = ruleResp{ID: p.ID, Pattern: p.Pattern, CategoryID: p.CategoryID, MatchCount: p.MatchCount}
	}
	writeJSON(w, http.StatusOK, resp)
}

type ruleReq struct {
	PayeePattern string `json:"payee_pattern"`
	CategoryID   string `json:"category_id"`
}

func (h *PayeeRuleHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Create(r.Context(), req.PayeePattern, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Update(r.Context(), id, req.PayeePattern, req.CategoryID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

Note: the `toRuleResp` stub is unused — remove it. The file uses `ruleResp` directly inline.

- [ ] **Step 2: Fix the unused stub — replace the handler file with the clean version**

The `toRuleResp` function in Step 1 was a mistake. Replace the entire file with:

```go
package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/repository"
)

type PayeeRuleHandler struct {
	repo *repository.PayeeRuleRepo
}

func NewPayeeRuleHandler(repo *repository.PayeeRuleRepo) *PayeeRuleHandler {
	return &PayeeRuleHandler{repo: repo}
}

type ruleResp struct {
	ID         string `json:"id"`
	Pattern    string `json:"payee_pattern"`
	CategoryID string `json:"category_id"`
	MatchCount int    `json:"match_count"`
}

type ruleReq struct {
	PayeePattern string `json:"payee_pattern"`
	CategoryID   string `json:"category_id"`
}

func (h *PayeeRuleHandler) List(w http.ResponseWriter, r *http.Request) {
	rules, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]ruleResp, len(rules))
	for i, p := range rules {
		resp[i] = ruleResp{ID: p.ID, Pattern: p.Pattern, CategoryID: p.CategoryID, MatchCount: p.MatchCount}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *PayeeRuleHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Create(r.Context(), req.PayeePattern, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Update(r.Context(), id, req.PayeePattern, req.CategoryID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 3: Register routes in server/main.go**

In `server/main.go`, after the line `cats := handler.NewCategoryHandler(catRepo)` (around line 84), add:

```go
rules    := handler.NewPayeeRuleHandler(ruleRepo)
```

After the Categories routes block (after line 119 `mux.HandleFunc("DELETE /api/categories/{id}/target", budgets.DeleteTarget)`... actually after the categories block, before imports), add this block after the categories handler registrations:

```go
// Payee Rules
mux.HandleFunc("GET /api/payee-rules",        rules.List)
mux.HandleFunc("POST /api/payee-rules",        rules.Create)
mux.HandleFunc("PUT /api/payee-rules/{id}",    rules.Update)
mux.HandleFunc("DELETE /api/payee-rules/{id}", rules.Delete)
```

Place it after the Categories block (after `mux.HandleFunc("DELETE /api/categories/{id}", cats.DeleteCategory)`) and before the Imports block.

- [ ] **Step 4: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/server
go build ./...
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add server/internal/handler/payee_rules.go server/main.go
git commit -m "feat: add PayeeRules HTTP handler and routes"
```

---

### Task 3: api.ts — PayeeRule type + CRUD functions

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add PayeeRule interface and functions**

In `frontend/src/api.ts`, after the `// ─── Import History ───` section at the end of the file, add:

```ts
// ─── Payee Rules ──────────────────────────────────────────────────────────────

export interface PayeeRule {
  id: string;
  pattern: string;
  category_id: string;
  match_count: number;
}

export async function fetchPayeeRules(): Promise<PayeeRule[]> {
  const data = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }[]>('/payee-rules');
  return (data ?? []).map(r => ({ id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count }));
}

export async function createPayeeRule(pattern: string, categoryId: string): Promise<PayeeRule> {
  const r = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }>('/payee-rules', {
    method: 'POST',
    body: JSON.stringify({ payee_pattern: pattern, category_id: categoryId }),
  });
  return { id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count };
}

export async function updatePayeeRule(id: string, pattern: string, categoryId: string): Promise<PayeeRule> {
  const r = await apiFetch<{ id: string; payee_pattern: string; category_id: string; match_count: number }>(`/payee-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ payee_pattern: pattern, category_id: categoryId }),
  });
  return { id: r.id, pattern: r.payee_pattern, category_id: r.category_id, match_count: r.match_count };
}

export async function deletePayeeRule(id: string): Promise<void> {
  return apiFetch(`/payee-rules/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/api.ts
git commit -m "feat: add PayeeRule api.ts CRUD functions"
```

---

### Task 4: App.tsx — pass categoryIdByName to ImportWizard

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Import.tsx` (Props interface only)

This task threads `categoryIdByName` down to `ImportWizard` so `RulesManager` can map category IDs to names without an extra API call.

- [ ] **Step 1: Update ImportWizard Props interface in Import.tsx**

In `frontend/src/components/Import.tsx`, find the Props interface at line 177:

```ts
interface Props {
  accounts: typeof AppData.accounts;
  categoryGroups: CategoryGroup[];
  onNavigate: (page: string) => void;
}
```

Replace it with:

```ts
interface Props {
  accounts: typeof AppData.accounts;
  categoryGroups: CategoryGroup[];
  categoryIdByName: Record<string, string>;
  onNavigate: (page: string) => void;
}
```

And update the function signature at line 183 to destructure the new prop:

```ts
export function ImportWizard({ accounts, categoryGroups, categoryIdByName, onNavigate }: Props) {
```

- [ ] **Step 2: Pass categoryIdByName from App.tsx**

In `frontend/src/App.tsx`, find line 152:

```tsx
{page === 'import' && <ImportWizard accounts={accounts} categoryGroups={categoryGroups} onNavigate={navigate} />}
```

Replace with:

```tsx
{page === 'import' && <ImportWizard accounts={accounts} categoryGroups={categoryGroups} categoryIdByName={categoryIdByName} onNavigate={navigate} />}
```

- [ ] **Step 3: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Import.tsx frontend/src/App.tsx
git commit -m "feat: thread categoryIdByName into ImportWizard"
```

---

### Task 5: Import.tsx — tab bar + RulesManager

**Files:**
- Modify: `frontend/src/components/Import.tsx`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/components/Import.tsx`, replace the existing import block with:

```ts
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { T } from '../theme';
import { categorize } from '../engine';
import { AppData } from '../data';
import type { CategoryGroup } from '../data';
import type { Account } from '../data';
import { fetchImportHistory, fetchAccounts, fetchPayeeRules, createPayeeRule, updatePayeeRule, deletePayeeRule } from '../api';
import type { ImportRecord, PayeeRule as ApiPayeeRule } from '../api';
import { useToast } from './Toast';
```

- [ ] **Step 2: Add tab state to ImportWizard and wrap with tab bar**

Replace the `ImportWizard` function body opening (the lines starting at `export function ImportWizard`) up through the `return (` opening. The current return starts at line 202. Replace with:

```tsx
export function ImportWizard({ accounts, categoryGroups, categoryIdByName, onNavigate }: Props) {
  const [tab, setTab] = useState<'import' | 'rules'>('import');
  const [step, setStep] = useState(0);
  const [uploadInfo, setUploadInfo] = useState<{ file: { name: string }; accountId: string } | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>(SAMPLE_PARSED);
  const [done, setDone] = useState(false);
  const handleChangeParsed = (id: number, key: string, val: string | null) =>
    setParsed(rows => rows.map(r => r.id === id ? { ...r, [key]: val } : r));

  const idToName = Object.fromEntries(Object.entries(categoryIdByName).map(([name, id]) => [id, name]));
  const allCategoryNames = categoryGroups.flatMap(g => g.categories);

  if (done) {
    return (
      <div style={st.doneWrap}>
        <div style={st.doneCircle}><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: T.text, margin: 0, letterSpacing: '-0.03em' }}>Import complete</h2>
        <p style={{ color: T.textDim, margin: 0, fontSize: 14 }}>{parsed.length} transactions added to your account.</p>
        <button onClick={() => onNavigate('dashboard')} style={{ ...st.primaryBtn, marginTop: 14 }}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <>
      {/* Tab bar */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 24px 0' }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, gap: 0 }}>
          {(['import', 'rules'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t ? 'var(--accent)' : T.textDim,
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize' as const,
            }}>{t === 'import' ? 'Import' : 'Rules'}</button>
          ))}
        </div>
      </div>

      {tab === 'import' && (
        <>
          <div style={{ padding: '28px 24px 0', maxWidth: 760, margin: '0 auto' }}>
            <StepIndicator step={step} />
            <div style={{ marginTop: 28 }}>
              {step === 0 && <Step1 accounts={accounts} onNext={info => { setUploadInfo(info); setStep(1); }} />}
              {step === 1 && <Step2 parsed={parsed} onChangeParsed={handleChangeParsed} categoryGroups={categoryGroups} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
              {step === 2 && <Step3 parsed={parsed} uploadInfo={uploadInfo ?? { file: { name: 'estado_cuenta_abril.csv' } }} onBack={() => setStep(1)} onConfirm={() => setDone(true)} />}
            </div>
          </div>
          <ImportHistory />
        </>
      )}

      {tab === 'rules' && (
        <RulesManager
          categoryGroups={categoryGroups}
          categoryIdByName={categoryIdByName}
          idToName={idToName}
          allCategoryNames={allCategoryNames}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Add RulesManager component**

Add the following component after the `ImportHistory` function and before the `stHistory` style object:

```tsx
function RulesManager({ categoryGroups, categoryIdByName, idToName, allCategoryNames }: {
  categoryGroups: CategoryGroup[];
  categoryIdByName: Record<string, string>;
  idToName: Record<string, string>;
  allCategoryNames: string[];
}) {
  const toast = useToast();
  const [rules, setRules] = useState<ApiPayeeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ pattern: '', categoryId: '' });

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetchPayeeRules()
      .then(r => { setRules(r); setLoading(false); })
      .catch(err => { setLoadError(err.message); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const startAdd = () => { setAdding(true); setForm({ pattern: '', categoryId: categoryIdByName[allCategoryNames[0]] ?? '' }); };
  const startEdit = (r: ApiPayeeRule) => { setEditingId(r.id); setForm({ pattern: r.pattern, categoryId: r.category_id }); };
  const cancelForm = () => { setAdding(false); setEditingId(null); };

  const saveAdd = async () => {
    if (!form.pattern || !form.categoryId) return;
    try {
      await createPayeeRule(form.pattern, form.categoryId);
      toast.success('Rule saved');
      setAdding(false);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const saveEdit = async () => {
    if (!editingId || !form.pattern || !form.categoryId) return;
    try {
      await updatePayeeRule(editingId, form.pattern, form.categoryId);
      toast.success('Rule updated');
      setEditingId(null);
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await deletePayeeRule(id);
      toast.success('Rule deleted');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const CategorySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...st.select, padding: '7px 10px', fontSize: 13 }}>
      {allCategoryNames.map(name => (
        <option key={name} value={categoryIdByName[name] ?? ''}>{name}</option>
      ))}
    </select>
  );

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Payee Rules</div>
          <div style={{ fontSize: 12, color: T.textDim, marginTop: 3 }}>
            Patterns are matched as case-insensitive substrings against payee names during import.
          </div>
        </div>
        {!adding && <button onClick={startAdd} style={st.primaryBtn}>+ Add Rule</button>}
      </div>

      {loadError && (
        <div style={{ padding: '12px 14px', background: 'rgba(255,80,80,0.08)', border: `1px solid rgba(255,80,80,0.2)`, borderRadius: 8, color: T.neg, fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>{loadError}</span>
          <button onClick={load} style={{ background: 'none', border: 'none', color: T.neg, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '8px 14px', background: 'rgba(255,255,255,0.03)', fontSize: 10.5, fontWeight: 700, color: T.textDim, letterSpacing: '0.07em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${T.border}` }}>
            <span>Pattern</span><span>Category</span><span>Used</span><span></span>
          </div>

          {rules.length === 0 && !adding && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: T.textDim, fontSize: 13 }}>
              No rules yet — add one to auto-categorize imports.
            </div>
          )}

          {rules.map(rule => (
            editingId === rule.id ? (
              <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '8px 14px', alignItems: 'center', borderBottom: `1px solid ${T.border}`, background: 'rgba(61,220,151,0.04)' }}>
                <input
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  style={{ ...st.select, padding: '6px 9px', fontSize: 13, fontFamily: T.mono }}
                  placeholder="payee pattern"
                  autoFocus
                />
                <CategorySelect value={form.categoryId} onChange={v => setForm(f => ({ ...f, categoryId: v }))} />
                <span style={{ fontSize: 12, color: T.textFaint }}>{rule.match_count}×</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveEdit} style={{ ...st.primaryBtn, padding: '5px 10px', fontSize: 12 }}>Save</button>
                  <button onClick={cancelForm} style={{ ...st.ghostBtn, padding: '5px 8px', fontSize: 12 }}>✕</button>
                </span>
              </div>
            ) : (
              <div key={rule.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', padding: '10px 14px', alignItems: 'center', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 13 }}>
                <span style={{ color: T.text, fontFamily: T.mono, fontSize: 12.5 }}>{rule.pattern}</span>
                <span style={{ color: T.textMid }}>{idToName[rule.category_id] ?? rule.category_id}</span>
                <span style={{ color: T.textFaint, fontSize: 12 }}>{rule.match_count}×</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => startEdit(rule)} style={{ background: 'none', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✎</button>
                  <button onClick={() => handleDelete(rule.id)} style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
                </span>
              </div>
            )
          ))}

          {adding && (
            <div style={{ padding: '10px 14px', borderTop: rules.length > 0 ? `1px solid ${T.border}` : undefined, background: 'rgba(61,220,151,0.04)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px 72px', alignItems: 'center', gap: 0 }}>
                <input
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  style={{ ...st.select, padding: '7px 10px', fontSize: 13, fontFamily: T.mono }}
                  placeholder="e.g. walmart"
                  autoFocus
                />
                <CategorySelect value={form.categoryId} onChange={v => setForm(f => ({ ...f, categoryId: v }))} />
                <span />
                <span style={{ display: 'flex', gap: 6 }}>
                  <button onClick={saveAdd} style={{ ...st.primaryBtn, padding: '6px 10px', fontSize: 12 }}>Save</button>
                  <button onClick={cancelForm} style={{ ...st.ghostBtn, padding: '6px 8px', fontSize: 12 }}>✕</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Import.tsx
git commit -m "feat: add Rules tab and RulesManager to Import page"
```

---

### Task 6: Import.tsx — live rules for import preview + history polish

**Files:**
- Modify: `frontend/src/components/Import.tsx`

- [ ] **Step 1: Fetch live rules in ImportWizard and use for preview**

In `ImportWizard`, add state for live rules right after the `idToName` line:

```tsx
const [liveRules, setLiveRules] = useState<ApiPayeeRule[]>([]);
useEffect(() => {
  fetchPayeeRules().then(setLiveRules).catch(() => {});
}, []);
```

Then update the `SAMPLE_PARSED` initialization. The initial `parsed` state uses `SAMPLE_PARSED` for demo purposes — that's fine. The real import preview in Step 2 uses `onChangeParsed` which already works. But the initial `setParsed(SAMPLE_PARSED)` line should use live rules when available. Add a `useEffect` to re-categorize when `liveRules` loads:

```tsx
useEffect(() => {
  if (liveRules.length === 0) return;
  setParsed(rows => rows.map(r => {
    const mapped = liveRules.map(lr => ({ id: lr.id, match: lr.pattern, category: idToName[lr.category_id] ?? '' }));
    const cat = categorize(r.payee, mapped);
    return { ...r, category: cat, autoCat: !!cat };
  }));
}, [liveRules]);
```

Place both `useEffect` calls after the `idToName` and `allCategoryNames` lines, before the `if (done)` check.

- [ ] **Step 2: Replace console.warn in ImportHistory with toast + add loading state**

The `ImportHistory` function currently has `console.warn` at line 224. Replace the entire `ImportHistory` function with:

```tsx
function ImportHistory() {
  const toast = useToast();
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchImportHistory(),
      fetchAccounts().then(accs => [...accs.budget, ...accs.tracking]).catch(() => [] as Account[]),
    ])
      .then(([recs, accs]) => { setRecords(recs); setAccounts(accs); })
      .catch(err => toast.error('Failed to load import history: ' + err.message))
      .finally(() => setLoading(false));
  }, []);

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return s; }
  };

  if (loading) return (
    <div style={{ maxWidth: 760, margin: '0 auto 28px', padding: '0 24px' }}>
      <div style={{ ...stHistory.panel }}>
        <div style={stHistory.header}>Import History</div>
        <div style={{ padding: '24px 18px', color: T.textDim, fontSize: 13 }}>Loading…</div>
      </div>
    </div>
  );

  if (records.length === 0) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto 28px', padding: '0 24px' }}>
      <div style={stHistory.panel}>
        <div style={stHistory.header}>Import History</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['File', 'Account', 'Transactions', 'Date', 'Status'].map(h => (
                  <th key={h} style={{ ...stHistory.th, textAlign: h === 'Transactions' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={stHistory.td}>{r.filename}</td>
                  <td style={stHistory.td}>{accountName(r.account_id)}</td>
                  <td style={{ ...stHistory.td, textAlign: 'right', fontFamily: T.mono }}>{r.transaction_count}</td>
                  <td style={{ ...stHistory.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{fmtDate(r.imported_at)}</td>
                  <td style={stHistory.td}>
                    <span style={{ ...stHistory.badge, background: r.status === 'completed' ? 'rgba(61,220,151,0.12)' : 'rgba(246,196,90,0.12)', color: r.status === 'completed' ? T.pos : T.warn }}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

Note: `useToast()` is now called inside `ImportHistory`. Since `ImportHistory` is always rendered inside `ImportWizard` which is inside `ToastProvider`, this is safe.

- [ ] **Step 3: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Import.tsx
git commit -m "feat: live rules for import preview, history loading state + toast"
```

---

### Task 7: Dashboard polish — loading/error states

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

- [ ] **Step 1: Add loading/error state and useToast import**

Replace the current imports at the top of `frontend/src/components/Dashboard.tsx`:

```ts
import { useMemo, useState, useEffect, useCallback } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { Transaction, CategoryGroup } from '../data';
import { fetchRecentTransactions } from '../api';
import { useToast } from './Toast';
```

- [ ] **Step 2: Replace the useEffect and add loading/error state to Dashboard function**

Replace the current `Dashboard` function body opening (lines 72-78):

```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    fetchRecentTransactions(20)
      .then(setTransactions)
      .catch(err => console.warn('Failed to load recent transactions:', err.message));
  }, []);
```

With:

```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const toast = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [txnError, setTxnError] = useState<string | null>(null);

  const loadTxns = useCallback(() => {
    setLoadingTxns(true);
    setTxnError(null);
    fetchRecentTransactions(20)
      .then(data => { setTransactions(data); setLoadingTxns(false); })
      .catch(err => { setTxnError(err.message); setLoadingTxns(false); });
  }, []);

  useEffect(() => { loadTxns(); }, [loadTxns]);
```

- [ ] **Step 3: Replace the recent transactions section with loading/error states**

Find the Recent Transactions panel (around line 138):

```tsx
      <div style={st.panel}>
        <div style={st.panelHeader}>
          <span>Recent Transactions</span>
          <button onClick={() => onNavigate('accounts', 'bac')} style={st.linkBtn}>View all →</button>
        </div>
        <table style={st.table}>
```

Replace the entire panel content (table and all) with:

```tsx
      <div style={st.panel}>
        <div style={st.panelHeader}>
          <span>Recent Transactions</span>
          <button onClick={() => onNavigate('accounts', 'bac')} style={st.linkBtn}>View all →</button>
        </div>
        {txnError ? (
          <div style={{ padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: T.neg, flex: 1 }}>{txnError}</span>
            <button onClick={loadTxns} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, color: T.textMid, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : loadingTxns ? (
          <div style={{ padding: '24px 18px', color: T.textDim, fontSize: 13 }}>Loading…</div>
        ) : (
        <table style={st.table}>
          <thead>
            <tr>
              {['Date', 'Payee', 'Category', 'Amount'].map(h => (
                <th key={h} style={{ ...st.th, textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(t => {
              const grp = categoryGroups.find(g => g.categories.includes(t.category ?? ''));
              const catColor = grp ? GROUP_COLORS[grp.name] : T.textMid;
              return (
                <tr key={t.id} style={st.tr}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ ...st.td, fontFamily: T.mono, fontSize: 12, color: T.textDim }}>{t.date.slice(5).replace('-', '/')}</td>
                  <td style={{ ...st.td, fontWeight: 600 }}>{t.payee}</td>
                  <td style={st.td}>
                    {t.category
                      ? <span style={{ ...st.catTag, color: catColor }}><span style={{ width: 6, height: 6, borderRadius: 2, background: 'currentColor', opacity: 0.9 }} />{t.category}</span>
                      : <span style={{ color: T.textFaint, fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ ...st.td, textAlign: 'right', fontFamily: T.mono, fontSize: 13, fontWeight: 500 }}>
                    {t.inflow > 0 ? <span style={{ color: T.pos }}>+{fmt(t.inflow)}</span> : <span style={{ color: T.textMid }}>−{fmt(t.outflow)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
```

Also remove the unused `toast` variable warning — `useToast()` is called but `toast` isn't currently used. Either remove it or keep it for future use. Since the spec says to use a persistent banner (not a toast) for initial load failure, remove the toast import and `useToast()` call — the error banner already handles the failure:

Replace the Dashboard function opening to remove `useToast`:

```tsx
export function Dashboard({ categoryGroups, fmt, onNavigate }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(true);
  const [txnError, setTxnError] = useState<string | null>(null);

  const loadTxns = useCallback(() => {
    setLoadingTxns(true);
    setTxnError(null);
    fetchRecentTransactions(20)
      .then(data => { setTransactions(data); setLoadingTxns(false); })
      .catch(err => { setTxnError(err.message); setLoadingTxns(false); });
  }, []);

  useEffect(() => { loadTxns(); }, [loadTxns]);
```

And remove `useToast` from the import line:

```ts
import { useMemo, useState, useEffect, useCallback } from 'react';
import { T, GROUP_COLORS } from '../theme';
import type { Transaction, CategoryGroup } from '../data';
import { fetchRecentTransactions } from '../api';
```

- [ ] **Step 4: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Dashboard.tsx
git commit -m "feat: loading/error state for Dashboard recent transactions"
```

---

### Task 8: Budget polish — toast on all mutations + error banner

**Files:**
- Modify: `frontend/src/components/Budget.tsx`

- [ ] **Step 1: Add useToast import and budgetError state**

In `frontend/src/components/Budget.tsx`, find the existing import from `../api`:

```ts
import { fetchBudget, setAssigned as apiSetAssigned, copyPreviousBudget, moveBudgetMoney, upsertCategoryTarget, deleteCategoryTarget, createCategoryGroup, deleteCategoryGroup, createCategory, deleteCategory, updateCategory, fetchNearestRate } from '../api';
```

Add a new import line after it:

```ts
import { useToast } from './Toast';
```

- [ ] **Step 2: Add budgetError state and toast inside the Budget function**

Find the existing state declarations inside `export function Budget(...)` (around line 216). After the `const [loading, setLoading] = useState(true);` line add:

```ts
const [budgetError, setBudgetError] = useState<string | null>(null);
const toast = useToast();
```

- [ ] **Step 3: Replace fetchBudget console.error with toast + error banner state**

Find the `.catch` block for `fetchBudget` (around line 269):

```ts
    }).catch(err => {
      console.error('fetchBudget failed', err);
    }).finally(() => setLoading(false));
```

Replace with:

```ts
    }).catch(err => {
      setBudgetError(err.message);
    }).finally(() => setLoading(false));
```

Also reset `budgetError` when a successful fetch completes — find the line that calls `setLocalBudget(...)` (the last setter before the `.catch`) and add `setBudgetError(null);` right after `setAom(data.age_of_money);`:

```ts
      setAom(data.age_of_money);
      setBudgetError(null);
      setLocalBudget({ [currentDisplayMonth]: newBudgetMonth });
```

- [ ] **Step 4: Replace all remaining console.error calls with toast.error**

Make these targeted replacements in `Budget.tsx`:

Replace `apiSetAssigned` catch:
```ts
      apiSetAssigned(currentYM, catId, value).catch(err => console.error('setAssigned failed', err));
```
→
```ts
      apiSetAssigned(currentYM, catId, value).catch(err => toast.error(err.message));
```

Replace `copyPreviousBudget` catch:
```ts
        .catch(err => console.error('copyPrevious failed', err));
```
→
```ts
        .catch(err => toast.error(err.message));
```

Replace `moveBudgetMoney` catch block:
```ts
      moveBudgetMoney(currentYM, fromId, toId, amount).catch(err => {
        console.error('moveBudgetMoney failed, reverting', err);
        setLocalBudget(prev => {
```
→
```ts
      moveBudgetMoney(currentYM, fromId, toId, amount).catch(err => {
        toast.error(err.message);
        setLocalBudget(prev => {
```

Replace rename category catch:
```ts
        .catch(err => console.error('rename category failed:', err));
```
→
```ts
        .catch(err => toast.error(err.message));
```

Replace delete category catch:
```ts
          console.error('delete category failed:', err);
```
→
```ts
          toast.error(err.message);
```

Replace create category catch:
```ts
        console.error('create category failed:', err);
```
→
```ts
        toast.error(err.message);
```

Replace delete group catch:
```ts
        console.error('delete group failed:', err);
```
→
```ts
        toast.error(err.message);
```

Replace create group catch:
```ts
      .catch(err => console.error('create group failed:', err));
```
→
```ts
      .catch(err => toast.error(err.message));
```

Replace deleteTarget catch:
```ts
      deleteCategoryTarget(catId).catch(err => console.error('deleteTarget failed', err));
```
→
```ts
      deleteCategoryTarget(catId).catch(err => toast.error(err.message));
```

Replace upsertTarget catch:
```ts
        .catch(err => console.error('upsertTarget failed', err));
```
→
```ts
        .catch(err => toast.error(err.message));
```

- [ ] **Step 5: Add error banner in the Budget JSX**

Find the Budget return JSX — the `<div>` wrapping `<div style={st.topBar}>`. After the opening `<div>` and before `<div style={st.topBar}>`, add:

```tsx
  return (
    <div>
      {budgetError && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: 'rgba(255,80,80,0.08)', border: `1px solid rgba(255,80,80,0.2)`, borderRadius: 8, color: T.neg, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>Failed to load budget: {budgetError}</span>
          <button onClick={() => setFetchCounter(c => c + 1)} style={{ background: 'none', border: 'none', color: T.neg, cursor: 'pointer', fontWeight: 700, fontSize: 13, textDecoration: 'underline' }}>Retry</button>
        </div>
      )}
      <div style={st.topBar}>
```

- [ ] **Step 6: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds with no TypeScript errors

- [ ] **Step 7: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Budget.tsx
git commit -m "feat: replace Budget console.error with toast, add fetchBudget error banner"
```

---

### Task 9: Reports polish — loading/error states

**Files:**
- Modify: `frontend/src/components/Reports.tsx`

- [ ] **Step 1: Add loading/error state**

In `frontend/src/components/Reports.tsx`, replace the current `Reports` function opening (lines 193–205):

```tsx
export function Reports({ fmt }: Props) {
  const [activeReport, setActiveReport] = useState('trend');
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);

  useEffect(() => {
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    fetchSpendingReport(from, to)
      .then(setMonthlySpending)
      .catch(err => console.warn('Failed to load spending report:', err.message));
  }, []);
```

With:

```tsx
export function Reports({ fmt }: Props) {
  const [activeReport, setActiveReport] = useState('trend');
  const [monthlySpending, setMonthlySpending] = useState<MonthlySpendingRow[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadReport = () => {
    setLoadingReport(true);
    setReportError(null);
    const now = new Date();
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    fetchSpendingReport(from, to)
      .then(data => { setMonthlySpending(data); setLoadingReport(false); })
      .catch(err => { setReportError(err.message); setLoadingReport(false); });
  };

  useEffect(() => { loadReport(); }, []);
```

- [ ] **Step 2: Add loading/error UI in the Reports JSX**

Find the `<div style={st.panel}>` that wraps chart content (around line 247). Replace the entire panel `<div style={st.panel}>` content with a wrapper that shows loading/error first:

```tsx
      <div style={st.panel}>
        {reportError ? (
          <div style={{ padding: '32px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: T.neg, flex: 1 }}>{reportError}</span>
            <button onClick={loadReport} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, color: T.textMid, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : loadingReport ? (
          <div style={{ padding: '60px 18px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading report…</div>
        ) : (
          <>
            {activeReport === 'trend' && ( ... existing trend content ... )}
            {activeReport === 'donut' && ( ... existing donut content ... )}
            {activeReport === 'income' && ( ... existing income content ... )}
            {activeReport === 'networth' && ( ... existing networth content ... )}
            {activeReport === 'age' && ( ... existing age content ... )}
          </>
        )}
      </div>
```

To be concrete: wrap the existing `{activeReport === 'trend' && ...}` ... `{activeReport === 'age' && ...}` JSX block in the else branch of the loading/error conditional. The existing chart content is unchanged — just wrapped inside `{...loadingReport ? <loading> : reportError ? <error> : <existing content>}`.

Find the opening `<div style={st.panel}>` at line 247. Replace it and insert the loading/error guards. The full replacement for the panel's opening tag and first child is:

```tsx
      <div style={st.panel}>
        {reportError ? (
          <div style={{ padding: '32px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: T.neg, flex: 1 }}>{reportError}</span>
            <button onClick={loadReport} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 12, color: T.textMid, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : loadingReport ? (
          <div style={{ padding: '60px 18px', textAlign: 'center', color: T.textDim, fontSize: 13 }}>Loading report…</div>
        ) : <>
          {activeReport === 'trend' && (
            <>
              <div style={st.panelHeader}><span>Spending by Category Group</span><span style={st.panelMeta}>Nov 2025 – Apr 2026</span></div>
              <div style={{ display: 'flex', gap: 16, padding: '12px 18px', flexWrap: 'wrap' }}>
                {Object.entries(GROUP_COLORS).map(([g, color]) => (
                  <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2.5, background: color, boxShadow: `0 0 7px ${color}66` }} />
                    <span style={{ fontSize: 12, color: T.textMid, fontWeight: 500 }}>{g}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 14px 16px' }}><LineChart data={monthlySpending} /></div>
            </>
          )}
          {activeReport === 'donut' && (
            <>
              <div style={st.panelHeader}><span>Spending Breakdown</span><span style={st.panelMeta}>Last 6 months</span></div>
              <div style={{ padding: '24px 28px' }}><DonutChart data={monthlySpending} fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'income' && (
            <>
              <div style={st.panelHeader}><span>Income vs Expense</span><span style={st.panelMeta}>Nov 2025 – Apr 2026</span></div>
              <div style={{ display: 'flex', gap: 16, padding: '12px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2.5, background: T.pos }} /><span style={{ fontSize: 12, color: T.textMid }}>Income</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2.5, background: T.neg }} /><span style={{ fontSize: 12, color: T.textMid }}>Expense</span></div>
              </div>
              <div style={{ padding: '0 14px 16px' }}><IncomeExpenseChart data={D.incomeExpense} fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'networth' && (
            <>
              <div style={st.panelHeader}><span>Net Worth</span><span style={st.panelMeta}>{fmt(latestNW.assets - latestNW.debt)} today</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={D.netWorthHistory} valueOf={d => (d as typeof latestNW).assets - (d as typeof latestNW).debt} color="#5b9dff" fmt={fmt} /></div>
            </>
          )}
          {activeReport === 'age' && (
            <>
              <div style={st.panelHeader}><span>Age of Money</span><span style={st.panelMeta}>{latestAge.days} days</span></div>
              <div style={{ padding: '12px 14px 16px' }}><AreaLineChart data={D.ageOfMoney} valueOf={d => (d as typeof latestAge).days} color="#3ddc97" fmt={fmt} suffix="d" /></div>
            </>
          )}
        </>}
      </div>
```

Delete the old panel block (from its opening `<div style={st.panel}>` through its closing `</div>`) and replace it entirely with the block above.

- [ ] **Step 3: Build to verify**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
cd /home/Berny/budgetapp-ai
git add frontend/src/components/Reports.tsx
git commit -m "feat: loading/error state for Reports spending chart"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run Go tests**

```bash
cd /home/Berny/budgetapp-ai/server
go test ./... 2>&1
```

Expected: all tests pass or SKIP (no failures)

- [ ] **Step 2: Run frontend build**

```bash
cd /home/Berny/budgetapp-ai/frontend
npm run build 2>&1
```

Expected: Build succeeds. Output ends with something like `✓ built in Xs`

- [ ] **Step 3: Commit if any fixes were needed**

If any test failures or build errors required fixes, commit them now. If everything was clean, no additional commit needed.
