package service_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/service"
	"budgetapp/internal/testutil"
)

func TestPlanService_LeftToBudget(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	catID := testutil.SeedCategory(t, pool)
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
		pool.Exec(ctx, `DELETE FROM monthly_plans WHERE month='2026-05-01'`)
	})

	if err := svc.SetExpectedIncome(ctx, "2026-05", 1000000); err != nil {
		t.Fatalf("SetExpectedIncome: %v", err)
	}
	if err := svc.SetPlanned(ctx, catID, "2026-05", 300000); err != nil {
		t.Fatalf("SetPlanned: %v", err)
	}

	pm, err := svc.GetMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	if pm.ExpectedIncome != 1000000 {
		t.Errorf("ExpectedIncome = %d, want 1000000", pm.ExpectedIncome)
	}
	if pm.PlannedTotal != 300000 {
		t.Errorf("PlannedTotal = %d, want 300000", pm.PlannedTotal)
	}
	if pm.LeftToBudget != 700000 {
		t.Errorf("LeftToBudget = %d, want 700000", pm.LeftToBudget)
	}
}

func TestPlanService_RolloverAccumulatesWithNegativeCarry(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	accID := testutil.SeedOnBudgetAccount(t, pool)
	catID := testutil.SeedCategory(t, pool)
	if _, err := pool.Exec(ctx, `UPDATE categories SET rollover=true WHERE id=$1::uuid`, catID); err != nil {
		t.Fatalf("set rollover: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	// April: planned 100000, spent 150000 → month remaining -50000, carries.
	if err := svc.SetPlanned(ctx, catID, "2026-04", 100000); err != nil {
		t.Fatal(err)
	}
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-15", -150000)
	// May: planned 100000, no spend → balance = -50000 + 100000 = 50000.
	if err := svc.SetPlanned(ctx, catID, "2026-05", 100000); err != nil {
		t.Fatal(err)
	}

	pm, err := svc.GetMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	var found *struct{ Remaining, RolloverBalance int64 }
	for _, g := range pm.CategoryGroups {
		for _, c := range g.Categories {
			if c.ID == catID {
				found = &struct{ Remaining, RolloverBalance int64 }{c.Remaining, c.RolloverBalance}
			}
		}
	}
	if found == nil {
		t.Fatal("category not found")
	}
	if found.Remaining != 100000 {
		t.Errorf("month Remaining = %d, want 100000", found.Remaining)
	}
	if found.RolloverBalance != 50000 {
		t.Errorf("RolloverBalance = %d, want 50000", found.RolloverBalance)
	}
}

func TestPlanService_NonMonthlyAccumulatesWithoutRolloverFlag(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	ctx := context.Background()

	accID := testutil.SeedOnBudgetAccount(t, pool)
	catID := testutil.SeedCategory(t, pool)
	// non_monthly flexibility, rollover flag deliberately left false
	if _, err := pool.Exec(ctx, `UPDATE categories SET flexibility='non_monthly' WHERE id=$1::uuid`, catID); err != nil {
		t.Fatalf("set flexibility: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM budgets WHERE category_id=$1::uuid`, catID)
		pool.Exec(ctx, `DELETE FROM transactions WHERE account_id=$1::uuid`, accID)
	})

	// April: planned 200000, spent 50000. May: planned 200000.
	if err := svc.SetPlanned(ctx, catID, "2026-04", 200000); err != nil {
		t.Fatal(err)
	}
	testutil.SeedTransaction(t, pool, accID, catID, "2026-04-20", -50000)
	if err := svc.SetPlanned(ctx, catID, "2026-05", 200000); err != nil {
		t.Fatal(err)
	}

	pm, err := svc.GetMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	var got *int64
	for _, g := range pm.CategoryGroups {
		for _, c := range g.Categories {
			if c.ID == catID {
				v := c.RolloverBalance
				got = &v
			}
		}
	}
	if got == nil {
		t.Fatal("category not found")
	}
	// 200000 - 50000 + 200000 = 350000 accumulated despite rollover=false
	if *got != 350000 {
		t.Errorf("RolloverBalance = %d, want 350000", *got)
	}
}

func TestPlanService_GetMonth_Empty(t *testing.T) {
	pool := testutil.NewTestPool(t)
	svc := service.NewBudgetService(
		repository.NewBudgetRepo(pool),
		repository.NewMonthlyPlanRepo(pool),
		repository.NewCategoryRepo(pool),
		repository.NewExchangeRateRepo(pool),
		repository.NewSettingsRepo(pool),
	)
	pm, err := svc.GetMonth(context.Background(), "2026-04")
	if err != nil {
		t.Fatalf("GetMonth: %v", err)
	}
	if pm.Month != "2026-04" {
		t.Errorf("Month = %q", pm.Month)
	}
	if pm.Mode != "category" && pm.Mode != "flex" {
		t.Errorf("Mode = %q, want category|flex", pm.Mode)
	}
}
