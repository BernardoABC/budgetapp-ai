// server/internal/repository/target_repo_test.go
package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestTargetRepo_UpsertAndGetAll(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	deadline := "2026-06-01"
	target := model.Target{
		Type:     "savings",
		Amount:   500000,
		Deadline: &deadline,
	}

	if err := repo.Upsert(ctx, catID, target); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result := all[catID]
	if result == nil {
		t.Fatal("target not found")
	}
	if result.Type != "savings" {
		t.Errorf("want type 'savings' got %q", result.Type)
	}
	if result.Amount != 500000 {
		t.Errorf("want amount 500000 got %d", result.Amount)
	}
	if result.Deadline == nil || *result.Deadline != "2026-06-01" {
		t.Errorf("want deadline '2026-06-01' got %v", result.Deadline)
	}
}

func TestTargetRepo_UpsertOverwrite(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	// First upsert
	deadline1 := "2026-06-01"
	target1 := model.Target{
		Type:     "savings",
		Amount:   500000,
		Deadline: &deadline1,
	}
	if err := repo.Upsert(ctx, catID, target1); err != nil {
		t.Fatal(err)
	}

	// Second upsert with different values
	deadline2 := "2026-07-01"
	target2 := model.Target{
		Type:     "monthly",
		Amount:   300000,
		Deadline: &deadline2,
	}
	if err := repo.Upsert(ctx, catID, target2); err != nil {
		t.Fatal(err)
	}

	// Verify GetAll returns the second value
	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result := all[catID]
	if result == nil {
		t.Fatal("target not found")
	}
	if result.Type != "monthly" {
		t.Errorf("want type 'monthly' got %q", result.Type)
	}
	if result.Amount != 300000 {
		t.Errorf("want amount 300000 got %d", result.Amount)
	}
	if result.Deadline == nil || *result.Deadline != "2026-07-01" {
		t.Errorf("want deadline '2026-07-01' got %v", result.Deadline)
	}
}

func TestTargetRepo_Delete(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	// Upsert a target
	deadline := "2026-06-01"
	target := model.Target{
		Type:     "monthly",
		Amount:   100000,
		Deadline: &deadline,
	}
	if err := repo.Upsert(ctx, catID, target); err != nil {
		t.Fatal(err)
	}

	// Verify it exists
	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if all[catID] == nil {
		t.Fatal("target should exist before delete")
	}

	// Delete it
	if err := repo.Delete(ctx, catID); err != nil {
		t.Fatal(err)
	}

	// Verify it's gone
	all, err = repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if all[catID] != nil {
		t.Fatal("target should not exist after delete")
	}
}

func TestTargetRepo_UpsertNilDeadline(t *testing.T) {
	pool := testutil.NewTestPool(t)
	catID := testutil.SeedCategory(t, pool)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	target := model.Target{Type: "monthly", Amount: 100000, Deadline: nil}
	if err := repo.Upsert(ctx, catID, target); err != nil {
		t.Fatal(err)
	}

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	result := all[catID]
	if result == nil {
		t.Fatal("target not found")
	}
	if result.Deadline != nil {
		t.Errorf("want nil deadline got %q", *result.Deadline)
	}
}

func TestTargetRepo_GetAllEmpty(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewTargetRepo(pool)
	ctx := context.Background()

	all, err := repo.GetAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Errorf("want empty map got %d entries", len(all))
	}
}
