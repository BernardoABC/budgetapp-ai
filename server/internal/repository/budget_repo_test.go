// server/internal/repository/budget_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestBudgetRepo_UpsertAndGetPlanned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	if err := repo.UpsertPlanned(ctx, catID, "2026-04-01", 120000); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllPlannedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	if all[catID]["2026-04-01"] != 120000 {
		t.Errorf("want 120000 got %d", all[catID]["2026-04-01"])
	}
}

func TestBudgetRepo_GetAllActivityUpToMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	accID := testutil.SeedOnBudgetAccount(t, pool)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-10", -45000)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-15", -30000)
	testutil.SeedTransaction(t, pool, accID, catID, "2026-05-01", -10000) // outside range

	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-04-30")
	if err != nil {
		t.Fatal(err)
	}
	if activity[catID]["2026-04-01"] != -75000 {
		t.Errorf("want -75000 got %d", activity[catID]["2026-04-01"])
	}
	if activity[catID]["2026-05-01"] != 0 {
		t.Errorf("may txn should be excluded, got %d", activity[catID]["2026-05-01"])
	}
}

func TestBudgetRepo_BulkInsertPlannedIfAbsent(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID1 := testutil.SeedCategory(t, pool)
	catID2 := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	entries := []repository.PlannedEntry{
		{CategoryID: catID1, Month: "2026-04-01", Planned: 50000},
		{CategoryID: catID2, Month: "2026-04-01", Planned: 80000},
	}
	if err := repo.BulkInsertPlannedIfAbsent(ctx, entries); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllPlannedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	if all[catID1]["2026-04-01"] != 50000 || all[catID2]["2026-04-01"] != 80000 {
		t.Errorf("bulk upsert failed: got %v", all)
	}
}

func TestBudgetRepo_ActivityCurrencyConversion(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// CRC category, USD transaction at rate 520 CRC/USD
	crcCatID := testutil.SeedCategoryWithCurrency(t, pool, "CRC")
	usdAccID := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 0)
	rate := 520.0
	testutil.SeedTransactionWithCurrency(t, pool, usdAccID, crcCatID, "2026-06-01", -10000, "USD", &rate)
	// -10000 USD cents × 520 = -5,200,000 CRC centimos

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-06-30")
	if err != nil {
		t.Fatalf("GetAllActivityUpToMonth: %v", err)
	}

	got := activity[crcCatID]["2026-06-01"]
	if got != -5200000 {
		t.Errorf("expected -5200000 CRC centimos, got %d", got)
	}
}

func TestBudgetRepo_ActivityCurrencyConversionUSDCat(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// USD category, CRC transaction at rate 520 CRC/USD
	usdCatID := testutil.SeedCategoryWithCurrency(t, pool, "USD")
	crcAccID := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 0)
	rate := 520.0
	testutil.SeedTransactionWithCurrency(t, pool, crcAccID, usdCatID, "2026-06-01", -5200000, "CRC", &rate)
	// -5,200,000 CRC centimos / 520 = -10000 USD cents

	activity, err := repo.GetAllActivityUpToMonth(ctx, "2026-06-30")
	if err != nil {
		t.Fatalf("GetAllActivityUpToMonth: %v", err)
	}

	got := activity[usdCatID]["2026-06-01"]
	if got != -10000 {
		t.Errorf("expected -10000 USD cents, got %d", got)
	}
}

func TestBudgetRepo_GetActivityBreakdownForMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	crcCatID := testutil.SeedCategoryWithCurrency(t, pool, "CRC")
	usdAccID := testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 0)
	rate := 520.0
	testutil.SeedTransactionWithCurrency(t, pool, usdAccID, crcCatID, "2026-07-15", -5000, "USD", &rate)
	// -5000 USD cents × 520 = -2,600,000 CRC centimos

	breakdown, err := repo.GetActivityBreakdownForMonth(ctx, "2026-07")
	if err != nil {
		t.Fatalf("GetActivityBreakdownForMonth: %v", err)
	}

	var found bool
	for _, row := range breakdown {
		if row.CategoryID == crcCatID && row.TxnCurrency == "USD" {
			found = true
			if row.Amount != -5000 {
				t.Errorf("expected Amount=-5000, got %d", row.Amount)
			}
			if row.ConvertedAmount != -2600000 {
				t.Errorf("expected ConvertedAmount=-2600000, got %d", row.ConvertedAmount)
			}
		}
	}
	if !found {
		t.Error("no breakdown row found for crcCatID with USD txn currency")
	}
}

func TestBudgetRepo_ClearAllPlanned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	catID := testutil.SeedCategory(t, pool)
	if err := repo.UpsertPlanned(ctx, catID, "2026-07-01", 10000); err != nil {
		t.Fatalf("UpsertPlanned: %v", err)
	}
	if err := repo.UpsertPlanned(ctx, catID, "2026-08-01", 20000); err != nil {
		t.Fatalf("UpsertPlanned: %v", err)
	}

	if err := repo.ClearAllPlanned(ctx, catID); err != nil {
		t.Fatalf("ClearAllPlanned: %v", err)
	}

	all, err := repo.GetAllPlannedUpToMonth(ctx, "2026-12-01")
	if err != nil {
		t.Fatalf("GetAllPlannedUpToMonth: %v", err)
	}
	if len(all[catID]) != 0 {
		t.Errorf("expected no planned rows after clear, got %v", all[catID])
	}
}

func TestBudgetRepo_GetCashFlowByMonth(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	var incomeCat string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM categories WHERE is_system=true AND name='Income' LIMIT 1`).Scan(&incomeCat); err != nil {
		t.Skipf("Income system category not seeded: %v", err)
	}

	accID := testutil.SeedOnBudgetAccount(t, pool)
	spendCat := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	// Use a far-off month to avoid interference from other tests
	testutil.SeedTransaction(t, pool, accID, incomeCat, "2031-03-10", 1200000) // income
	testutil.SeedTransaction(t, pool, accID, spendCat, "2031-03-12", -300000)  // spending

	rows, err := repo.GetCashFlowByMonth(ctx, "2031-03", "2031-03")
	if err != nil {
		t.Fatalf("GetCashFlowByMonth: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].Month != "2031-03" {
		t.Errorf("Month = %q, want 2031-03", rows[0].Month)
	}
	if rows[0].Income != 1200000 {
		t.Errorf("Income = %d, want 1200000", rows[0].Income)
	}
	if rows[0].Spending != 300000 {
		t.Errorf("Spending = %d, want 300000", rows[0].Spending)
	}
}

func TestBudgetRepo_ActualIncomeAndSpending(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	// Income system category.
	var incomeCat string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM categories WHERE is_system=true AND name='Income' LIMIT 1`).Scan(&incomeCat); err != nil {
		t.Skipf("Income system category not seeded: %v", err)
	}

	accID := testutil.SeedOnBudgetAccount(t, pool)
	spendCat := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	testutil.SeedTransaction(t, pool, accID, incomeCat, "2026-05-10", 1200000) // income
	testutil.SeedTransaction(t, pool, accID, spendCat, "2026-05-12", -300000)  // spending

	income, err := repo.GetActualIncomeForMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetActualIncomeForMonth: %v", err)
	}
	if income != 1200000 {
		t.Errorf("income = %d, want 1200000", income)
	}

	spending, err := repo.GetActualSpendingForMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetActualSpendingForMonth: %v", err)
	}
	if spending != 300000 {
		t.Errorf("spending = %d, want 300000 (positive)", spending)
	}
}
