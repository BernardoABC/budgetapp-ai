# Assign Input Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to type math expressions (`10+5`, `100/4`, `50*2-10`) in any assign input cell and have them evaluated to a number on Enter or blur.

**Architecture:** Modify the `commit` function in the `BudgetCell` component to sanitize input and evaluate it as a math expression via `new Function()`, falling back to plain float parsing for plain numbers, and discarding on failure.

**Tech Stack:** React, TypeScript (frontend only — no backend changes)

---

### Task 1: Add calculator evaluation to BudgetCell commit

**Files:**
- Modify: `frontend/src/components/Budget.tsx:55`

Current `commit` function (line 55):
```typescript
const commit = () => { const num = parseFloat(input.replace(/[^0-9.-]/g, '')); if (!isNaN(num)) onSave(toRaw ? toRaw(num) : num); setEditing(false); };
```

- [ ] **Step 1: Replace the `commit` function with expression-evaluating version**

In `frontend/src/components/Budget.tsx`, replace line 55:

```typescript
const commit = () => {
  const sanitized = input.replace(/[^0-9+\-*/.() ]/g, '');
  let num: number | null = null;
  if (sanitized.trim()) {
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function('return ' + sanitized)() as number;
      if (typeof result === 'number' && isFinite(result)) num = result;
    } catch { /* invalid expression */ }
    if (num === null) {
      const fallback = parseFloat(sanitized.replace(/[^0-9.-]/g, ''));
      if (!isNaN(fallback)) num = fallback;
    }
  }
  if (num !== null) onSave(toRaw ? toRaw(num) : num);
  setEditing(false);
};
```

Note: This replaces the single-line `commit` — the surrounding `if (editing)` block and JSX remain unchanged.

- [ ] **Step 2: Verify TypeScript compiles without errors**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Start the dev server and manually verify**

```bash
cd /home/Berny/budgetapp-ai && make dev
```

Open the budget view and test these cases in any assign cell:

| Input | Expected result |
|-------|----------------|
| `150` | 150 (plain number, unchanged behavior) |
| `10+5` | 15 |
| `100-20` | 80 |
| `50*2` | 100 |
| `200/4` | 50 |
| `10+5+3` | 18 (chained) |
| `(100-20)/4` | 20 (parentheses) |
| `2+3*4` | 14 (precedence: `*` before `+`) |
| `abc` | no save, cell reverts |
| (empty) | no save, cell reverts |
| `10/0` | no save, cell reverts |

Test both Enter and blur (click away / Tab) to confirm both trigger evaluation.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Budget.tsx
git commit -m "feat: add inline calculator to assign inputs"
```
