# Transfer Auto-Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After manually linking one transfer pair, automatically propose all same-payee matches (by date + payee + opposite amount) and create missing peers, then link the whole batch atomically.

**Architecture:** New backend endpoint `POST /api/transfers/link-or-create-batch` handles both link-existing and create-then-link cases in one DB transaction. Frontend captures the target payee from the first confirmed link, matches remaining same-source-payee transactions by fetching the target account's transactions filtered by target payee, then passes the full batch to the new endpoint. "Will create" rows appear in the existing batch review modal with a "New" badge.

**Tech Stack:** Go (pgx/v5, net/http), React, TypeScript, inline styles

---

### Task 1: Backend — `LinkOrCreatePair` model + `LinkOrCreateBatch` repo method + tests

**Files:**
- Modify: `server/internal/model/transaction.go`
- Modify: `server/internal/repository/transaction_repo.go`
- Modify: `server/internal/repository/transaction_repo_test.go`

**Context:** The existing `LinkTransferBatch` in `transaction_repo.go` validates and links pre-existing transaction pairs. We need a new method that also handles "create then link" cases. The `model.LinkOrCreatePair` struct carries either a `TargetID` (link existing) or `TargetAccountID + TargetPayee + TargetDate + TargetAmount` (create then link). `TargetAmount` is signed centimos — positive means the new transaction is an inflow in the target account, negative means outflow.

- [ ] **Step 1: Add `LinkOrCreatePair` to the model**

In `server/internal/model/transaction.go`, append after the `CreateTransferReq` struct:

```go
// LinkOrCreatePair is one item in a link-or-create-batch request.
// Either TargetID is set (link two existing transactions) or
// TargetAccountID+TargetPayee+TargetDate+TargetAmount are set (create then link).
type LinkOrCreatePair struct {
	SourceID        string
	TargetID        string // link existing
	TargetAccountID string // create: account to insert into
	TargetPayee     string // create: payee for the new transaction
	TargetDate      string // create: "YYYY-MM-DD"
	TargetAmount    int64  // create: signed centimos (+inflow, -outflow)
}
```

- [ ] **Step 2: Write failing tests**

Append to `server/internal/repository/transaction_repo_test.go`:

```go
func TestTransactionRepo_LinkOrCreateBatch_LinkExisting(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	// Seed two unlinked transactions that sum to zero
	idA := testutil.SeedTransactionFull(t, pool, accA, "", "2026-05-10", -8000, "TEF DE: 123", "", false)
	idB := testutil.SeedTransactionFull(t, pool, accB, "", "2026-05-10", 8000, "TEF A: 456", "", false)

	repo := repository.NewTransactionRepo(pool)
	linked, created, err := repo.LinkOrCreateBatch(context.Background(), []model.LinkOrCreatePair{
		{SourceID: idA, TargetID: idB},
	})
	if err != nil {
		t.Fatal(err)
	}
	if linked != 1 {
		t.Errorf("want linked=1 got %d", linked)
	}
	if created != 0 {
		t.Errorf("want created=0 got %d", created)
	}
	txA, err := repo.Get(context.Background(), idA)
	if err != nil {
		t.Fatal(err)
	}
	if txA.TransferPeerID != idB {
		t.Errorf("want peer %s got %q", idB, txA.TransferPeerID)
	}
}

func TestTransactionRepo_LinkOrCreateBatch_CreateAndLink(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	idA := testutil.SeedTransactionFull(t, pool, accA, "", "2026-05-10", -8000, "TEF DE: 123", "", false)

	repo := repository.NewTransactionRepo(pool)
	linked, created, err := repo.LinkOrCreateBatch(context.Background(), []model.LinkOrCreatePair{
		{SourceID: idA, TargetAccountID: accB, TargetPayee: "TEF A: 456", TargetDate: "2026-05-10", TargetAmount: 8000},
	})
	if err != nil {
		t.Fatal(err)
	}
	if linked != 0 {
		t.Errorf("want linked=0 got %d", linked)
	}
	if created != 1 {
		t.Errorf("want created=1 got %d", created)
	}
	txA, err := repo.Get(context.Background(), idA)
	if err != nil {
		t.Fatal(err)
	}
	if txA.TransferPeerID == "" {
		t.Error("source not linked after create")
	}
	txB, err := repo.Get(context.Background(), txA.TransferPeerID)
	if err != nil {
		t.Fatal(err)
	}
	if txB.Amount != 8000 {
		t.Errorf("want peer amount 8000 got %d", txB.Amount)
	}
	if txB.Payee != "TEF A: 456" {
		t.Errorf("want payee %q got %q", "TEF A: 456", txB.Payee)
	}
	if !txB.Cleared {
		t.Error("want peer cleared=true")
	}
	if txB.AccountID != accB {
		t.Errorf("want peer in account %s got %s", accB, txB.AccountID)
	}
}

func TestTransactionRepo_LinkOrCreateBatch_IdempotentCreate(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	idA := testutil.SeedTransactionFull(t, pool, accA, "", "2026-05-10", -8000, "TEF DE: 123", "", false)
	// Pre-seed the peer transaction
	idB := testutil.SeedTransactionFull(t, pool, accB, "", "2026-05-10", 8000, "TEF A: 456", "", true)

	repo := repository.NewTransactionRepo(pool)
	linked, created, err := repo.LinkOrCreateBatch(context.Background(), []model.LinkOrCreatePair{
		{SourceID: idA, TargetAccountID: accB, TargetPayee: "TEF A: 456", TargetDate: "2026-05-10", TargetAmount: 8000},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Found existing → counts as linked, not created
	if linked != 1 {
		t.Errorf("want linked=1 got %d", linked)
	}
	if created != 0 {
		t.Errorf("want created=0 got %d", created)
	}
	txA, err := repo.Get(context.Background(), idA)
	if err != nil {
		t.Fatal(err)
	}
	// Must have linked to the pre-existing transaction, not a new duplicate
	if txA.TransferPeerID != idB {
		t.Errorf("want peer %s got %q (possible duplicate created)", idB, txA.TransferPeerID)
	}
}
```

Make sure `"budgetapp/internal/model"` is imported in the test file (it already imports `repository` and `testutil`).

- [ ] **Step 3: Run to confirm they fail**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_LinkOrCreateBatch
```

Expected: compile error — `repo.LinkOrCreateBatch` undefined, `model.LinkOrCreatePair` undefined.

- [ ] **Step 4: Implement `LinkOrCreateBatch` in `transaction_repo.go`**

Append to `server/internal/repository/transaction_repo.go` (after `LinkTransferBatch`):

```go
// LinkOrCreateBatch atomically processes a batch of link-or-create pairs in one
// DB transaction. Pairs with TargetID set link two existing transactions (same
// validation as LinkTransferBatch). Pairs with TargetAccountID set find an
// existing unlinked transaction matching all fields (idempotency), or create one,
// then link both directions. Returns (linked, created, error).
func (r *TransactionRepo) LinkOrCreateBatch(ctx context.Context, pairs []model.LinkOrCreatePair) (linked, created int, err error) {
	if len(pairs) == 0 {
		return 0, 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, pair := range pairs {
		if pair.TargetID != "" {
			// ── Link existing pair ──────────────────────────────────────────
			type row struct {
				accountID string
				amount    int64
				peerID    *string
			}
			var a, b row
			if err := tx.QueryRow(ctx,
				`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, pair.SourceID,
			).Scan(&a.accountID, &a.amount, &a.peerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get source %s: %w", pair.SourceID, err)
			}
			if err := tx.QueryRow(ctx,
				`SELECT account_id::text, amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, pair.TargetID,
			).Scan(&b.accountID, &b.amount, &b.peerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get target %s: %w", pair.TargetID, err)
			}
			if a.peerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.SourceID)
			}
			if b.peerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.TargetID)
			}
			if a.accountID == b.accountID {
				return 0, 0, fmt.Errorf("transactions %s and %s belong to the same account", pair.SourceID, pair.TargetID)
			}
			if a.amount+b.amount != 0 {
				return 0, 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", pair.SourceID, pair.TargetID)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
				pair.TargetID, pair.SourceID); err != nil {
				return 0, 0, fmt.Errorf("link source %s: %w", pair.SourceID, err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
				pair.SourceID, pair.TargetID); err != nil {
				return 0, 0, fmt.Errorf("link target %s: %w", pair.TargetID, err)
			}
			linked++

		} else {
			// ── Create-and-link ─────────────────────────────────────────────
			// Validate source exists and amounts sum to zero.
			var sourceAmount int64
			var sourcePeerID *string
			if err := tx.QueryRow(ctx,
				`SELECT amount, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, pair.SourceID,
			).Scan(&sourceAmount, &sourcePeerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get source %s: %w", pair.SourceID, err)
			}
			if sourcePeerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.SourceID)
			}
			if sourceAmount+pair.TargetAmount != 0 {
				return 0, 0, fmt.Errorf("source amount %d and target amount %d do not sum to zero", sourceAmount, pair.TargetAmount)
			}

			// Idempotency: find existing unlinked transaction matching all create fields.
			var targetID string
			idempotErr := tx.QueryRow(ctx,
				`SELECT id::text FROM transactions
				 WHERE account_id = $1::uuid AND date = $2::date AND amount = $3
				   AND payee = $4 AND transfer_peer_id IS NULL
				 LIMIT 1`,
				pair.TargetAccountID, pair.TargetDate, pair.TargetAmount, pair.TargetPayee,
			).Scan(&targetID)

			if idempotErr == nil {
				// Found existing — link it.
				linked++
			} else {
				// Create new peer transaction.
				if err := tx.QueryRow(ctx,
					`INSERT INTO transactions (account_id, date, amount, currency, payee, cleared)
					 VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, true)
					 RETURNING id::text`,
					pair.TargetAccountID, pair.TargetDate, pair.TargetAmount, pair.TargetPayee,
				).Scan(&targetID); err != nil {
					return 0, 0, fmt.Errorf("insert peer transaction: %w", err)
				}
				if _, err := tx.Exec(ctx,
					`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
					pair.TargetAmount, pair.TargetAccountID,
				); err != nil {
					return 0, 0, fmt.Errorf("update target balance: %w", err)
				}
				created++
			}

			// Link both directions.
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
				targetID, pair.SourceID); err != nil {
				return 0, 0, fmt.Errorf("link source %s: %w", pair.SourceID, err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
				pair.SourceID, targetID); err != nil {
				return 0, 0, fmt.Errorf("link target %s: %w", targetID, err)
			}
		}
	}

	return linked, created, tx.Commit(ctx)
}
```

- [ ] **Step 5: Add `"budgetapp/internal/model"` import to test file if missing**

Check the imports block at the top of `server/internal/repository/transaction_repo_test.go`. It should already have:
```go
import (
    "context"
    "testing"

    "budgetapp/internal/model"
    "budgetapp/internal/repository"
    "budgetapp/internal/testutil"
)
```

If `"budgetapp/internal/model"` is missing, add it.

- [ ] **Step 6: Run the tests**

```bash
cd /home/Berny/budgetapp-ai && make test-run T=TestTransactionRepo_LinkOrCreateBatch
```

Expected: PASS (or SKIP if no test DB — that's fine).

- [ ] **Step 7: Run full test suite**

```bash
cd /home/Berny/budgetapp-ai && make test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/internal/model/transaction.go \
        server/internal/repository/transaction_repo.go \
        server/internal/repository/transaction_repo_test.go
git commit -m "feat: add LinkOrCreateBatch repo method for transfer auto-match"
```

---

### Task 2: Backend — handler + route

**Files:**
- Modify: `server/internal/handler/transactions.go`
- Modify: `server/main.go`

**Context:** The existing `LinkBatch` handler at line ~344 of `handler/transactions.go` is a good template. The new handler maps JSON to `[]model.LinkOrCreatePair` and calls `repo.LinkOrCreateBatch`. Route is registered in `server/main.go` alongside the existing transfer routes (lines 121–124).

- [ ] **Step 1: Add `LinkOrCreateBatch` handler to `handler/transactions.go`**

Append after the `LinkBatch` function:

```go
func (h *TransactionHandler) LinkOrCreateBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pairs []struct {
			SourceID        string `json:"source_id"`
			TargetID        string `json:"target_id"`
			TargetAccountID string `json:"target_account_id"`
			TargetPayee     string `json:"target_payee"`
			TargetDate      string `json:"target_date"`
			TargetAmount    int64  `json:"target_amount"`
		} `json:"pairs"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.Pairs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "pairs must be non-empty")
		return
	}
	pairs := make([]model.LinkOrCreatePair, len(req.Pairs))
	for i, p := range req.Pairs {
		pairs[i] = model.LinkOrCreatePair{
			SourceID:        p.SourceID,
			TargetID:        p.TargetID,
			TargetAccountID: p.TargetAccountID,
			TargetPayee:     p.TargetPayee,
			TargetDate:      p.TargetDate,
			TargetAmount:    p.TargetAmount,
		}
	}
	linked, created, err := h.repo.LinkOrCreateBatch(r.Context(), pairs)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": linked, "created": created})
}
```

- [ ] **Step 2: Register the route in `server/main.go`**

In `server/main.go`, after line 124 (`mux.HandleFunc("POST /api/transfers/link-batch", txns.LinkBatch)`), add:

```go
mux.HandleFunc("POST /api/transfers/link-or-create-batch", txns.LinkOrCreateBatch)
```

- [ ] **Step 3: Build to confirm no compile errors**

```bash
cd /home/Berny/budgetapp-ai && make build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add server/internal/handler/transactions.go server/main.go
git commit -m "feat: add link-or-create-batch HTTP handler and route"
```

---

### Task 3: Frontend — `api.ts`

**Files:**
- Modify: `frontend/src/api.ts`

**Context:** `linkTransferBatch` at line ~271 is the existing batch-link function. We need a new `linkOrCreateBatch` that sends a union-typed array of pairs to `POST /api/transfers/link-or-create-batch`.

- [ ] **Step 1: Add `linkOrCreateBatch` to `api.ts`**

In `frontend/src/api.ts`, append after `linkTransferBatch`:

```ts
export type LinkOrCreatePair =
  | { source_id: string; target_id: string }
  | { source_id: string; target_account_id: string; target_payee: string; target_date: string; target_amount: number };

export async function linkOrCreateBatch(
  pairs: LinkOrCreatePair[],
): Promise<{ linked: number; created: number }> {
  return apiFetch('/transfers/link-or-create-batch', {
    method: 'POST',
    body: JSON.stringify({ pairs }),
  });
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add linkOrCreateBatch API function"
```

---

### Task 4: Frontend — `Accounts.tsx` matching logic + modal UI

**Files:**
- Modify: `frontend/src/components/Accounts.tsx`

**Context:** Four changes in this file:

1. **Import** `linkOrCreateBatch` and `LinkOrCreatePair` from `../api`
2. **`batchReview` state** — add `targetPayee: string` field
3. **`handleLinkConfirm`** — capture target payee from link result; fetch target account transactions by payee search; match by exact payee + date + amount; set `include: true` for all rows (including no-candidate)
4. **`handleBatchLink`** — call `linkOrCreateBatch` instead of `linkTransferBatch`; build correct payload distinguishing link vs create pairs
5. **Batch modal UI** — update column header; render "Will create" rows with ghost layout and "New" badge; enable checkboxes for all rows

**Current `batchReview` state type (line ~211):**
```ts
const [batchReview, setBatchReview] = useState<{
  payee: string;
  targetAccountId: string;
  pairs: Array<{ source: Transaction; candidate: Transaction | null; include: boolean }>;
} | null>(null);
```

**Current `handleLinkConfirm` (lines 386–416):**
```ts
const handleLinkConfirm = async (candidateId: string) => {
  if (!linkModal) return;
  try {
    await linkTransfer(linkModal.txn.id, candidateId);
    reload();
    const savedModal = linkModal;
    setLinkModal(null);

    const samePay = page?.transactions.filter(
      t => t.payee === savedModal.txn.payee && !t.transfer_peer_id && t.id !== savedModal.txn.id
    ) ?? [];
    if (samePay.length > 0) {
      const tgtAccId = savedModal.targetAccountId;
      const amount = savedModal.txn.outflow > 0 ? -savedModal.txn.outflow : savedModal.txn.inflow;
      const allCands = await fetchTransferCandidates(tgtAccId, amount).catch(() => []);
      const pairs = samePay.map(src => {
        const best = allCands
          .filter(c => !c.transfer_peer_id)
          .sort((a, b) =>
            Math.abs(new Date(a.date).getTime() - new Date(src.date).getTime()) -
            Math.abs(new Date(b.date).getTime() - new Date(src.date).getTime())
          )[0] ?? null;
        return { source: src, candidate: best, include: best !== null };
      });
      setBatchReview({ payee: savedModal.txn.payee, targetAccountId: tgtAccId, pairs });
    }
  } catch (e: any) {
    alert('Link failed: ' + e.message);
  }
};
```

**Current `handleBatchLink` (lines 418–431):**
```ts
const handleBatchLink = async () => {
  if (!batchReview) return;
  const pairs: [string, string][] = batchReview.pairs
    .filter(p => p.include && p.candidate)
    .map(p => [p.source.id, p.candidate!.id]);
  if (pairs.length === 0) { setBatchReview(null); return; }
  try {
    await linkTransferBatch(pairs);
    reload();
    setBatchReview(null);
  } catch (e: any) {
    alert('Batch link failed: ' + e.message);
  }
};
```

- [ ] **Step 1: Update the import line at the top of Accounts.tsx**

The current import line (line 2) is:
```ts
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkTransferBatch, updateAccount, deleteAccount, type TxnPage, type TxnFilterParams } from '../api';
```

Replace with (add `linkOrCreateBatch` and `type LinkOrCreatePair`, keep everything else):
```ts
import { updateTransaction, deleteTransaction, createTransaction, createTransfer, fetchTransactionsPage, batchTransactions, reconcileAccount, fetchTransferCandidates, linkTransfer, linkTransferBatch, linkOrCreateBatch, updateAccount, deleteAccount, type TxnPage, type TxnFilterParams, type LinkOrCreatePair } from '../api';
```

- [ ] **Step 2: Add `targetPayee` to `batchReview` state type**

Find the `batchReview` useState declaration (around line 211):
```ts
const [batchReview, setBatchReview] = useState<{
  payee: string;
  targetAccountId: string;
  pairs: Array<{ source: Transaction; candidate: Transaction | null; include: boolean }>;
} | null>(null);
```

Replace with:
```ts
const [batchReview, setBatchReview] = useState<{
  payee: string;
  targetPayee: string;
  targetAccountId: string;
  pairs: Array<{ source: Transaction; candidate: Transaction | null; include: boolean }>;
} | null>(null);
```

- [ ] **Step 3: Replace `handleLinkConfirm`**

Replace the entire `handleLinkConfirm` function with:

```ts
const handleLinkConfirm = async (candidateId: string) => {
  if (!linkModal) return;
  try {
    const result = await linkTransfer(linkModal.txn.id, candidateId);
    reload();
    const savedModal = linkModal;
    setLinkModal(null);

    // Capture the payee mapping from the first confirmed link.
    const targetPayee = result.to.payee;
    const tgtAccId = savedModal.targetAccountId;

    // Find all other unlinked source-side transactions with the same payee.
    const samePay = page?.transactions.filter(
      t => t.payee === savedModal.txn.payee && !t.transfer_peer_id && t.id !== savedModal.txn.id
    ) ?? [];

    if (samePay.length > 0) {
      // Fetch target account transactions matching the target payee (search is ILIKE).
      const targetPage = await fetchTransactionsPage(tgtAccId, { search: targetPayee, per_page: 200 }).catch(() => null);
      const targetCands = (targetPage?.transactions ?? []).filter(c => !c.transfer_peer_id && c.payee === targetPayee);

      const pairs = samePay.map(src => {
        const srcAmt = src.outflow > 0 ? src.outflow : src.inflow;
        // Match: same target payee (already filtered), same date, same magnitude.
        const best = targetCands.find(
          c => c.date === src.date && Math.abs((c.inflow || c.outflow) - srcAmt) < 0.001
        ) ?? null;
        return { source: src, candidate: best, include: true };
      });

      setBatchReview({ payee: savedModal.txn.payee, targetPayee, targetAccountId: tgtAccId, pairs });
    }
  } catch (e: any) {
    alert('Link failed: ' + (e as Error).message);
  }
};
```

- [ ] **Step 4: Replace `handleBatchLink`**

Replace the entire `handleBatchLink` function with:

```ts
const handleBatchLink = async () => {
  if (!batchReview) return;
  const selected = batchReview.pairs.filter(p => p.include);
  if (selected.length === 0) { setBatchReview(null); return; }
  try {
    const payload: LinkOrCreatePair[] = selected.map(p =>
      p.candidate
        ? { source_id: p.source.id, target_id: p.candidate.id }
        : {
            source_id: p.source.id,
            target_account_id: batchReview.targetAccountId,
            target_payee: batchReview.targetPayee,
            target_date: p.source.date,
            target_amount: Math.round(
              (p.source.outflow > 0 ? p.source.outflow : -p.source.inflow) * 100
            ) * -1,
          }
    );
    await linkOrCreateBatch(payload);
    reload();
    setBatchReview(null);
  } catch (e: any) {
    alert('Batch link failed: ' + (e as Error).message);
  }
};
```

Note on `target_amount` math: the source has `outflow > 0` (negative in DB, e.g. -8000 centimos). The peer should be the opposite: +8000. So `target_amount = -Math.round(outflow * 100)` = `-(-8000)` = `+8000`. For an inflow source (amount > 0 in DB), `target_amount = -Math.round(inflow * 100)` which is negative.

Actually let me be more explicit. The math is:
- Source amount in DB = negative for outflow, positive for inflow.
- Target amount must be the sign-flip: `target_amount = -(source amount in centimos)`.
- `source outflow in major = X > 0` → `source amount in centimos = -X*100` → `target_amount = X*100` (positive).
- `source inflow in major = X > 0` → `source amount in centimos = X*100` → `target_amount = -X*100` (negative).

In code:
```ts
target_amount: p.source.outflow > 0
  ? Math.round(p.source.outflow * 100)   // positive: inflow for target
  : -Math.round(p.source.inflow * 100),  // negative: outflow for target
```

Update the payload map to use this cleaner form:
```ts
const payload: LinkOrCreatePair[] = selected.map(p =>
  p.candidate
    ? { source_id: p.source.id, target_id: p.candidate.id }
    : {
        source_id: p.source.id,
        target_account_id: batchReview.targetAccountId,
        target_payee: batchReview.targetPayee,
        target_date: p.source.date,
        target_amount: p.source.outflow > 0
          ? Math.round(p.source.outflow * 100)
          : -Math.round(p.source.inflow * 100),
      }
);
```

- [ ] **Step 5: Update the batch review modal UI**

Find the batch review modal block (around line 716). Make three changes:

**a) Column header** — find `'Target account'` in the thead and replace with `'Peer (existing / to create)'`:
```tsx
{['', 'This account', '', 'Peer (existing / to create)'].map((h, i) => (
  <th key={i} style={{ fontSize: 10.5, fontWeight: 700, color: T.textDim, textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${T.border}` }}>{h}</th>
))}
```

**b) Checkbox** — remove `disabled={!pair.candidate}` so all rows are always enabled:
```tsx
<input
  type="checkbox"
  checked={pair.include}
  onChange={() => setBatchReview(br => br ? {
    ...br,
    pairs: br.pairs.map((p, j) => j === i ? { ...p, include: !p.include } : p)
  } : null)}
/>
```

**c) Right-side cell** — replace the `{pair.candidate ? ... : <span>No candidate found</span>}` with a "Will create" ghost row:
```tsx
<td style={{ padding: '8px 8px', fontSize: 12 }}>
  {pair.candidate
    ? <>
        <div style={{ fontWeight: 600, color: T.text }}>{pair.candidate.date}</div>
        <div style={{ color: T.textDim }}>{fmt(pair.candidate.inflow || pair.candidate.outflow)}</div>
      </>
    : <>
        <div style={{ fontWeight: 600, color: T.textDim }}>{pair.source.date}</div>
        <div style={{ color: T.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>
          {fmt(pair.source.inflow || pair.source.outflow)}
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 3, padding: '1px 4px' }}>New</span>
        </div>
      </>
  }
</td>
```

**d) Button label** — update "Link X pairs" to "Link / Create X pairs":
```tsx
Link / Create {batchReview.pairs.filter(p => p.include).length} pairs
```

- [ ] **Step 6: TypeScript check**

```bash
cd /home/Berny/budgetapp-ai/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run Go tests**

```bash
cd /home/Berny/budgetapp-ai && make test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Accounts.tsx
git commit -m "feat: auto-match transfers by payee+date+amount with create-if-missing"
```

---

### Task 5: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Deploy**

```bash
cd /home/Berny/budgetapp-ai && make ship
```

Wait for the deploy to complete.

- [ ] **Step 2: Link one transfer pair manually**

On `http://budget.home.arpa`, navigate to an account that has imported transactions with payee like `TEF DE: 953435013`. Click "Link" on one, choose the target account, and confirm the match.

After confirming, the batch review modal should appear.

- [ ] **Step 3: Verify smart matching**

In the batch review modal, verify:
- Rows where a same-date + same-amount transaction exists in the target account show the existing transaction on the right (no "New" badge, date and amount match exactly)
- Rows where no matching transaction exists show a ghost row with the source date + amount + a yellow `New` badge
- All checkboxes are enabled and checked by default (including "New" rows)

- [ ] **Step 4: Confirm the batch**

Click "Link / Create N pairs". After reload:
- Rows that linked existing transactions show the `⇄ AccountName` badge
- Rows that created new transactions also show the `⇄ AccountName` badge (the peer was created)
- Navigate to the target account and verify the created transactions appear there as cleared transfers

- [ ] **Step 5: Verify idempotency**

Refresh the page. The linked rows should still show as linked. No duplicate transactions should appear in the target account.
