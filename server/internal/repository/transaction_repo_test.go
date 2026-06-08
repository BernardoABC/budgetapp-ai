// server/internal/repository/transaction_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestTransactionRepo_FilterSearch(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "ZARA", "shirt", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "NIKE", "zapatos", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-03", -3000, "WALMART", "ZARA-brand socks", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// search matches payee (ZARA) and memo (ZARA-brand socks) -> 2 rows
	txns, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Search: "zara"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Errorf("want total 2 got %d (txns len %d)", total, len(txns))
	}
}

func TestTransactionRepo_FilterDateRange(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-15", -2000, "B", "", false)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-05-01", -3000, "C", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{FromDate: "2026-04-10", ToDate: "2026-04-30"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 got %d", total)
	}
}

func TestTransactionRepo_FilterCleared(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	cleared := true

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Cleared: &cleared})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 cleared got %d", total)
	}
}

func TestTransactionRepo_FilterUncategorized(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, total, _, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{CategoryID: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Errorf("want 1 uncategorized got %d", total)
	}
}

func TestTransactionRepo_SortAndSummary(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "AAA", "", true)  // outflow, cleared
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", 5000, "BBB", "", false)  // inflow, uncleared

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	txns, total, summary, err := repo.ListByAccount(ctx, acc, repository.TxnFilter{Sort: "amount_asc"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 {
		t.Fatalf("want 2 got %d", total)
	}
	if txns[0].Amount != -1000 {
		t.Errorf("amount_asc: want first -1000 got %d", txns[0].Amount)
	}
	if summary.TotalInflow != 5000 {
		t.Errorf("want inflow 5000 got %d", summary.TotalInflow)
	}
	if summary.TotalOutflow != 1000 {
		t.Errorf("want outflow magnitude 1000 got %d", summary.TotalOutflow)
	}
	if summary.ClearedBalance != -1000 {
		t.Errorf("want cleared_balance -1000 got %d", summary.ClearedBalance)
	}
	if summary.UnclearedBalance != 5000 {
		t.Errorf("want uncleared_balance 5000 got %d", summary.UnclearedBalance)
	}
}

func TestTransactionRepo_BatchCategorize(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-01", -1000, "A", "", false)
	id2 := testutil.SeedTransactionFull(t, pool, acc, "", "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	n, err := repo.BatchUpdate(ctx, []string{id1, id2}, "categorize", cat)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("want 2 affected got %d", n)
	}
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{CategoryID: cat})
	if total != 2 {
		t.Errorf("want 2 in category got %d", total)
	}
}

func TestTransactionRepo_BatchClear(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	if _, err := repo.BatchUpdate(ctx, []string{id1}, "clear", ""); err != nil {
		t.Fatal(err)
	}
	cleared := true
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{Cleared: &cleared})
	if total != 1 {
		t.Errorf("want 1 cleared got %d", total)
	}
}

func TestTransactionRepo_BatchDeleteReversesBalance(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool) // balance starts at 0
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)
	id2 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	n, err := repo.BatchUpdate(ctx, []string{id1, id2}, "delete", "")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("want 2 deleted got %d", n)
	}
	// rows gone
	_, total, _, _ := repo.ListByAccount(ctx, acc, repository.TxnFilter{})
	if total != 0 {
		t.Errorf("want 0 remaining got %d", total)
	}
	// balance reversed: 0 - (-3000) = 3000
	var bal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, acc).Scan(&bal)
	if bal != 3000 {
		t.Errorf("want balance 3000 after reversal got %d", bal)
	}
}

func TestTransactionRepo_BatchUnknownAction(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	id1 := testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", false)

	repo := repository.NewTransactionRepo(pool)
	if _, err := repo.BatchUpdate(context.Background(), []string{id1}, "bogus", ""); err == nil {
		t.Error("want error for unknown action, got nil")
	}
}

func TestTransactionRepo_NetWorthByMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	// Starting balance equivalent: +500000 in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-01", 500000)
	// Spend in Jan: -100000
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-15", -100000)
	// Income in Feb: +200000
	testutil.SeedTransaction(t, pool, acc, cat, "2026-02-10", 200000)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	rows, err := repo.NetWorthByMonth(ctx, "2026-01", "2026-02")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows got %d", len(rows))
	}
	// End of Jan: 500000 - 100000 = 400000
	if rows[0].Month != "2026-01" {
		t.Errorf("want month 2026-01 got %s", rows[0].Month)
	}
	if rows[0].NetWorth != 400000 {
		t.Errorf("want net_worth 400000 got %d", rows[0].NetWorth)
	}
	// End of Feb: 400000 + 200000 = 600000
	if rows[1].Month != "2026-02" {
		t.Errorf("want month 2026-02 got %s", rows[1].Month)
	}
	if rows[1].NetWorth != 600000 {
		t.Errorf("want net_worth 600000 got %d", rows[1].NetWorth)
	}
}

func TestTransactionRepo_UpdateSplits_StoresAndClearsRows(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat1 := testutil.SeedCategory(t, pool)
	cat2 := testutil.SeedCategory(t, pool)
	txnID := testutil.SeedTransactionFull(t, pool, acc, cat1, "2026-04-01", -5000, "SUPER", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	// first update: store two splits
	_, err := repo.Update(ctx, txnID, model.UpdateTransactionReq{
		Date: "2026-04-01", Payee: "SUPER", CategoryID: cat1, Amount: -5000,
		Splits: []model.SplitRow{
			{CategoryID: cat1, Amount: 3000},
			{CategoryID: cat2, Amount: 2000},
		},
	})
	if err != nil {
		t.Fatalf("first update: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = $1::uuid`, txnID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("after first update want 2 splits, got %d", count)
	}

	// second update: clear splits
	_, err = repo.Update(ctx, txnID, model.UpdateTransactionReq{
		Date: "2026-04-01", Payee: "SUPER", CategoryID: cat1, Amount: -5000,
		Splits: nil,
	})
	if err != nil {
		t.Fatalf("second update: %v", err)
	}

	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transaction_splits WHERE transaction_id = $1::uuid`, txnID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("after clear update want 0 splits, got %d", count)
	}
}

func TestTransactionRepo_ListWithSplits(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat1 := testutil.SeedCategory(t, pool)
	cat2 := testutil.SeedCategory(t, pool)
	txnID := testutil.SeedTransactionFull(t, pool, acc, cat1, "2026-04-01", -5000, "SUPER", "", false)

	// Insert splits directly to test the read path independently
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO transaction_splits (transaction_id, category_id, amount)
		VALUES ($1::uuid, $2::uuid, 3000), ($1::uuid, $3::uuid, 2000)
	`, txnID, cat1, cat2); err != nil {
		t.Fatalf("seed splits: %v", err)
	}

	repo := repository.NewTransactionRepo(pool)
	txns, _, _, err := repo.ListByAccount(context.Background(), acc, repository.TxnFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(txns) == 0 {
		t.Fatal("expected at least one transaction")
	}
	if len(txns[0].Splits) != 2 {
		t.Errorf("want 2 splits, got %d", len(txns[0].Splits))
	}
	total := txns[0].Splits[0].Amount + txns[0].Splits[1].Amount
	if total != 5000 {
		t.Errorf("want split total 5000, got %d", total)
	}
}

func TestTransactionRepo_IncomeExpenseByMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	// income in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-15", 100000)
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-20", 50000)
	// expense in Jan
	testutil.SeedTransaction(t, pool, acc, cat, "2026-01-25", -30000)
	// income in Feb
	testutil.SeedTransaction(t, pool, acc, cat, "2026-02-10", 200000)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()
	rows, err := repo.IncomeExpenseByMonth(ctx, "2026-01", "2026-02")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows got %d", len(rows))
	}
	if rows[0].Month != "2026-01" {
		t.Errorf("want month 2026-01 got %s", rows[0].Month)
	}
	if rows[0].Income != 150000 {
		t.Errorf("want income 150000 got %d", rows[0].Income)
	}
	if rows[0].Expense != 30000 {
		t.Errorf("want expense 30000 got %d", rows[0].Expense)
	}
	if rows[1].Month != "2026-02" {
		t.Errorf("want month 2026-02 got %s", rows[1].Month)
	}
	if rows[1].Income != 200000 {
		t.Errorf("want income 200000 got %d", rows[1].Income)
	}
	if rows[1].Expense != 0 {
		t.Errorf("want expense 0 got %d", rows[1].Expense)
	}
}

func TestTransactionRepo_Reconcile_NoAdjustment(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-02", -2000, "B", "", true)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-03", -3000, "C", "", false)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	count, err := repo.Reconcile(ctx, acc, 0)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("want 2 reconciled, got %d", count)
	}

	var reconciledInDB int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE account_id = $1::uuid AND reconciled = true`, acc,
	).Scan(&reconciledInDB) //nolint:errcheck
	if reconciledInDB != 2 {
		t.Errorf("want 2 reconciled rows in DB, got %d", reconciledInDB)
	}
}

func TestTransactionRepo_Reconcile_WithAdjustment(t *testing.T) {
	pool := testutil.NewTestPool(t)
	acc := testutil.SeedOnBudgetAccount(t, pool)
	cat := testutil.SeedCategory(t, pool)
	testutil.SeedTransactionFull(t, pool, acc, cat, "2026-04-01", -1000, "A", "", true)

	repo := repository.NewTransactionRepo(pool)
	ctx := context.Background()

	_, err := repo.Reconcile(ctx, acc, 500)
	if err != nil {
		t.Fatal(err)
	}

	var adjCount int
	pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE account_id = $1::uuid AND payee = 'Reconciliation Adjustment'`, acc,
	).Scan(&adjCount) //nolint:errcheck
	if adjCount != 1 {
		t.Errorf("want 1 adjustment transaction, got %d", adjCount)
	}

	var balance int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, acc).Scan(&balance) //nolint:errcheck
	if balance != 500 {
		t.Errorf("want account balance 500, got %d", balance)
	}
}

func TestTransactionRepo_DeleteTransfer_CascadePeer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        3000,
		Cleared:       false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	if err := repo.Delete(ctx, from.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	if _, err := repo.Get(ctx, to.ID); err == nil {
		t.Error("peer transaction still exists after deleting one transfer leg")
	}

	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != 0 {
		t.Errorf("from account balance want 0 got %d", fromBal)
	}
	if toBal != 0 {
		t.Errorf("to account balance want 0 got %d", toBal)
	}
}

func TestTransactionRepo_CreateTransfer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        5000, // ₡50.00
		Cleared:       true,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	if from.Amount != -5000 {
		t.Errorf("from.Amount want -5000 got %d", from.Amount)
	}
	if to.Amount != 5000 {
		t.Errorf("to.Amount want 5000 got %d", to.Amount)
	}
	if from.TransferPeerID != to.ID {
		t.Errorf("from.TransferPeerID %q != to.ID %q", from.TransferPeerID, to.ID)
	}
	if to.TransferPeerID != from.ID {
		t.Errorf("to.TransferPeerID %q != from.ID %q", to.TransferPeerID, from.ID)
	}

	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != -5000 {
		t.Errorf("from account balance want -5000 got %d", fromBal)
	}
	if toBal != 5000 {
		t.Errorf("to account balance want 5000 got %d", toBal)
	}
}

func TestTransactionRepo_UpdateTransfer_MirrorsPeer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	fromAccID := testutil.SeedOnBudgetAccount(t, pool)
	toAccID   := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	from, to, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: fromAccID,
		ToAccountID:   toAccID,
		Date:          "2026-06-04",
		Amount:        2000,
		Cleared:       false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	_, err = repo.Update(ctx, from.ID, model.UpdateTransactionReq{
		Date:    "2026-06-04",
		Payee:   from.Payee,
		Amount:  -4000,
		Cleared: false,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	peer, err := repo.Get(ctx, to.ID)
	if err != nil {
		t.Fatalf("Get peer: %v", err)
	}
	if peer.Amount != 4000 {
		t.Errorf("peer.Amount want 4000 got %d", peer.Amount)
	}

	var fromBal, toBal int64
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, fromAccID).Scan(&fromBal)
	pool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1::uuid`, toAccID).Scan(&toBal)
	if fromBal != -4000 {
		t.Errorf("from balance want -4000 got %d", fromBal)
	}
	if toBal != 4000 {
		t.Errorf("to balance want 4000 got %d", toBal)
	}
}

func TestTransactionRepo_TransferCandidates(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	// One candidate: opposite amount, no peer.
	testutil.SeedTransactionFull(t, pool, accB, "", "2026-06-01", 5000, "Salary", "", false)
	// Not a candidate: same amount sign.
	testutil.SeedTransactionFull(t, pool, accB, "", "2026-06-01", -5000, "Other", "", false)

	// Create a linked pair so we can verify already-linked rows are excluded.
	_, _, err := repo.CreateTransfer(ctx, model.CreateTransferReq{
		FromAccountID: accA, ToAccountID: accB, Date: "2026-06-02", Amount: 3000, Cleared: false,
	})
	if err != nil {
		t.Fatalf("CreateTransfer: %v", err)
	}

	// accA outflow = -5000; candidates in accB should have amount = +5000, no peer.
	cands, err := repo.TransferCandidates(ctx, accB, -5000)
	if err != nil {
		t.Fatalf("TransferCandidates: %v", err)
	}
	if len(cands) != 1 {
		t.Fatalf("want 1 candidate got %d", len(cands))
	}
	if cands[0].Payee != "Salary" {
		t.Errorf("want payee Salary got %q", cands[0].Payee)
	}
}

func TestTransactionRepo_LinkTransfer(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "Transfer", "", false)
	idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "Transfer", "", false)

	if err := repo.LinkTransfer(ctx, idA, idB); err != nil {
		t.Fatalf("LinkTransfer: %v", err)
	}

	a, _ := repo.Get(ctx, idA)
	b, _ := repo.Get(ctx, idB)

	if a.TransferPeerID != idB {
		t.Errorf("a.TransferPeerID want %q got %q", idB, a.TransferPeerID)
	}
	if b.TransferPeerID != idA {
		t.Errorf("b.TransferPeerID want %q got %q", idA, b.TransferPeerID)
	}
}

func TestTransactionRepo_LinkTransfer_Validations(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	t.Run("same account", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", 5000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err == nil {
			t.Error("expected error for same account, got nil")
		}
	})
	t.Run("amounts don't sum to zero", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 3000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err == nil {
			t.Error("expected error for mismatched amounts, got nil")
		}
	})
	t.Run("already linked", func(t *testing.T) {
		idA := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-03", -5000, "T", "", false)
		idB := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-03", 5000, "T", "", false)
		idC := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-03", 5000, "T", "", false)
		if err := repo.LinkTransfer(ctx, idA, idB); err != nil {
			t.Fatalf("first link: %v", err)
		}
		if err := repo.LinkTransfer(ctx, idA, idC); err == nil {
			t.Error("expected error linking already-linked transaction, got nil")
		}
	})
}

func TestTransactionRepo_LinkTransferBatch(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA1 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
	idB1 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "T", "", false)
	idA2 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -3000, "T", "", false)
	idB2 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 3000, "T", "", false)

	linked, err := repo.LinkTransferBatch(ctx, [][2]string{{idA1, idB1}, {idA2, idB2}})
	if err != nil {
		t.Fatalf("LinkTransferBatch: %v", err)
	}
	if linked != 2 {
		t.Errorf("want linked=2 got %d", linked)
	}

	a1, _ := repo.Get(ctx, idA1)
	if a1.TransferPeerID != idB1 {
		t.Errorf("a1 peer want %q got %q", idB1, a1.TransferPeerID)
	}
}

func TestTransactionRepo_LinkTransferBatch_RollbackOnError(t *testing.T) {
	pool := testutil.NewTestPool(t)
	accA := testutil.SeedOnBudgetAccount(t, pool)
	accB := testutil.SeedOnBudgetAccount(t, pool)
	cat  := testutil.SeedCategory(t, pool)

	repo := repository.NewTransactionRepo(pool)
	ctx  := context.Background()

	idA1 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-01", -5000, "T", "", false)
	idB1 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-01", 5000, "T", "", false)
	// Second pair has mismatched amounts — should cause rollback.
	idA2 := testutil.SeedTransactionFull(t, pool, accA, cat, "2026-06-02", -3000, "T", "", false)
	idB2 := testutil.SeedTransactionFull(t, pool, accB, cat, "2026-06-02", 9999, "T", "", false)

	_, err := repo.LinkTransferBatch(ctx, [][2]string{{idA1, idB1}, {idA2, idB2}})
	if err == nil {
		t.Fatal("expected error from batch with invalid pair, got nil")
	}

	// First pair must NOT be linked (rolled back).
	a1, _ := repo.Get(ctx, idA1)
	if a1.TransferPeerID != "" {
		t.Errorf("pair 1 should not be linked after rollback, got peer %q", a1.TransferPeerID)
	}
}
