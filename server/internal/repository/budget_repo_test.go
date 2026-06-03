// server/internal/repository/budget_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestBudgetRepo_UpsertAndGetAssigned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	if err := repo.UpsertAssigned(ctx, catID, "2026-04-01", 120000); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllAssignedUpToMonth(ctx, "2026-04-01")
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

func TestBudgetRepo_BulkUpsertAssigned(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID1 := testutil.SeedCategory(t, pool)
	catID2 := testutil.SeedCategory(t, pool)
	repo := repository.NewBudgetRepo(pool)
	ctx := context.Background()

	entries := []repository.BudgetAssignedEntry{
		{CategoryID: catID1, Month: "2026-04-01", Assigned: 50000},
		{CategoryID: catID2, Month: "2026-04-01", Assigned: 80000},
	}
	if err := repo.BulkUpsertAssigned(ctx, entries); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAllAssignedUpToMonth(ctx, "2026-04-01")
	if err != nil {
		t.Fatal(err)
	}
	if all[catID1]["2026-04-01"] != 50000 || all[catID2]["2026-04-01"] != 80000 {
		t.Errorf("bulk upsert failed: got %v", all)
	}
}
