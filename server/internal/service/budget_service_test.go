package service_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"budgetapp/internal/repository"
	"budgetapp/internal/service"
	"budgetapp/internal/testutil"
)

func TestBudgetService_GetMonth_Empty(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	rateRepo := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()
	result, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatalf("GetMonth returned error: %v", err)
	}
	if result == nil {
		t.Fatal("GetMonth returned nil")
	}
	if result.Month != "2026-04" {
		t.Errorf("expected Month=2026-04, got %q", result.Month)
	}
}

func TestBudgetService_GetMonth_Rollover(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	rateRepo := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()

	// Seed a category.
	accID := testutil.SeedOnBudgetAccount(t, pool)
	catID := testutil.SeedCategory(t, pool)

	// March: assigned=100000, transaction=-60000 (activity).
	if err := budgetRepo.UpsertAssigned(ctx, catID, "2026-03-01", 100000); err != nil {
		t.Fatalf("UpsertAssigned march: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id = $1::uuid`, catID)
	})

	testutil.SeedTransaction(t, pool, accID, catID, "2026-03-15", -60000)

	// April: assigned=50000.
	if err := budgetRepo.UpsertAssigned(ctx, catID, "2026-04-01", 50000); err != nil {
		t.Fatalf("UpsertAssigned april: %v", err)
	}

	result, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	// Find the seeded category in the result.
	var found *struct {
		CarryIn   int64
		Assigned  int64
		Activity  int64
		Available int64
	}
	for _, g := range result.CategoryGroups {
		for _, c := range g.Categories {
			if c.ID == catID {
				found = &struct {
					CarryIn   int64
					Assigned  int64
					Activity  int64
					Available int64
				}{c.CarryIn, c.Assigned, c.Activity, c.Available}
				break
			}
		}
	}

	if found == nil {
		t.Fatalf("category %s not found in GetMonth result", catID)
	}

	// March: 100000 assigned + (-60000) activity = 40000 available → carries into April
	if found.CarryIn != 40000 {
		t.Errorf("expected CarryIn=40000, got %d", found.CarryIn)
	}
	if found.Assigned != 50000 {
		t.Errorf("expected Assigned=50000, got %d", found.Assigned)
	}
	// April has no transactions → Activity=0
	if found.Activity != 0 {
		t.Errorf("expected Activity=0, got %d", found.Activity)
	}
	// Available = 40000 carry + 50000 assigned + 0 activity
	if found.Available != 90000 {
		t.Errorf("expected Available=90000, got %d", found.Available)
	}
}

func TestBudgetService_AgeOfMoney(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	rateRepo := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()

	// Seed an on-budget account.
	accID := testutil.SeedOnBudgetAccount(t, pool)

	// Set account balance to 900000 via direct SQL UPDATE.
	_, err := pool.Exec(ctx, `UPDATE accounts SET balance = 900000 WHERE id = $1::uuid`, accID)
	if err != nil {
		t.Fatalf("update account balance: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `UPDATE accounts SET balance = 0 WHERE id = $1::uuid`, accID)
	})

	// Add a transaction for today with amount -30000 (no category needed for AoM).
	today := time.Now().UTC().Format("2006-01-02")
	testutil.SeedTransactionNoCategory(t, pool, accID, today, -30000)

	// GetMonth for current month.
	currentMonth := fmt.Sprintf("%d-%02d", time.Now().UTC().Year(), time.Now().UTC().Month())
	result, err := svc.GetMonth(ctx, currentMonth)
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	if result.AgeOfMoney == nil {
		t.Error("expected AgeOfMoney to be non-nil")
	} else {
		// AoM = 900000 * 30 / 30000 = 900 days
		if *result.AgeOfMoney != 900 {
			t.Errorf("expected AgeOfMoney=900, got %d", *result.AgeOfMoney)
		}
	}
}

func TestBudgetService_GetMonth_SystemCategoryInflowIncreasesRTA(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)
	rateRepo := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)
	ctx := context.Background()

	// Get the seeded system category ID.
	var sysCatID string
	err := pool.QueryRow(ctx,
		`SELECT id::text FROM categories WHERE is_system = true AND name = 'Inflow: Ready to Assign' LIMIT 1`,
	).Scan(&sysCatID)
	if err != nil {
		t.Skipf("system category not seeded (run migrations): %v", err)
	}

	// Create an on-budget account with a balance of 500000.
	accID := testutil.SeedOnBudgetAccount(t, pool)
	pool.Exec(ctx, `UPDATE accounts SET balance = 500000 WHERE id = $1::uuid`, accID)
	t.Cleanup(func() {
		pool.Exec(ctx, `UPDATE accounts SET balance = 0 WHERE id = $1::uuid`, accID)
	})

	// Inflow transaction categorized to the system category.
	txID := testutil.SeedTransaction(t, pool, accID, sysCatID, "2026-04-15", 500000)
	_ = txID

	result, err := svc.GetMonth(ctx, "2026-04")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	// RTA = balance (500000) - totalAvailable (0, system cat excluded) = 500000.
	if result.ReadyToAssign != 500000 {
		t.Errorf("want RTA=500000, got %d", result.ReadyToAssign)
	}

	// System group must NOT appear in CategoryGroups.
	for _, g := range result.CategoryGroups {
		if g.Name == "Inflows" {
			t.Errorf("system group 'Inflows' must not appear in budget CategoryGroups")
		}
	}
}

func TestBudgetService_GetMonth_MultiCurrencyRTA(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo    := repository.NewCategoryRepo(pool)
	rateRepo   := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()

	testutil.SeedExchangeRate(t, pool, "2026-06-01", 500.0)

	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "CRC", 50000000)
	testutil.SeedOnBudgetAccountWithCurrency(t, pool, "USD", 100000)

	result, err := svc.GetMonth(ctx, "2026-06")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}

	if result.RTABreakdown.CRCAccounts < 50000000 {
		t.Errorf("CRCAccounts should be >= 50000000, got %d", result.RTABreakdown.CRCAccounts)
	}
	if result.RTABreakdown.USDNative < 100000 {
		t.Errorf("USDNative should be >= 100000, got %d", result.RTABreakdown.USDNative)
	}
	if result.RTABreakdown.USDAccountsCRC < 50000000 {
		t.Errorf("USDAccountsCRC should be >= 50000000, got %d", result.RTABreakdown.USDAccountsCRC)
	}
}

func TestBudgetService_Move_CrossCurrencyRejected(t *testing.T) {
	pool := testutil.NewTestPool(t)
	budgetRepo := repository.NewBudgetRepo(pool)
	targetRepo := repository.NewTargetRepo(pool)
	catRepo    := repository.NewCategoryRepo(pool)
	rateRepo   := repository.NewExchangeRateRepo(pool)
	svc := service.NewBudgetService(budgetRepo, targetRepo, catRepo, rateRepo)

	ctx := context.Background()
	crcCat := testutil.SeedCategoryWithCurrency(t, pool, "CRC")
	usdCat := testutil.SeedCategoryWithCurrency(t, pool, "USD")

	err := svc.Move(ctx, "2026-06", crcCat, usdCat, 10000)
	if err == nil {
		t.Fatal("expected error moving money between different currencies, got nil")
	}
}
