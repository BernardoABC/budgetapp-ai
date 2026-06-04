// server/internal/repository/transaction_repo_test.go
package repository_test

import (
	"context"
	"testing"

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
