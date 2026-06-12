package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestMonthlyPlanRepo_UpsertAndGet(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewMonthlyPlanRepo(pool)
	ctx := context.Background()

	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM monthly_plans WHERE month = '2026-05-01'`) })

	// Missing row → zero values, no error.
	p, err := repo.Get(ctx, "2026-05-01")
	if err != nil {
		t.Fatalf("Get missing: %v", err)
	}
	if p.ExpectedIncome != 0 || p.FlexBudget != 0 {
		t.Fatalf("expected zero plan, got %+v", p)
	}

	if err := repo.SetExpectedIncome(ctx, "2026-05-01", 1500000); err != nil {
		t.Fatalf("SetExpectedIncome: %v", err)
	}
	if err := repo.SetFlexBudget(ctx, "2026-05-01", 400000); err != nil {
		t.Fatalf("SetFlexBudget: %v", err)
	}

	p, err = repo.Get(ctx, "2026-05-01")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if p.ExpectedIncome != 1500000 {
		t.Errorf("ExpectedIncome = %d, want 1500000", p.ExpectedIncome)
	}
	if p.FlexBudget != 400000 {
		t.Errorf("FlexBudget = %d, want 400000", p.FlexBudget)
	}
}
