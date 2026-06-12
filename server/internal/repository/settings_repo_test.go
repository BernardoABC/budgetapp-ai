package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestSettingsRepo_GetWithDefaultAndSet(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewSettingsRepo(pool)
	ctx := context.Background()
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM app_settings WHERE key = 'budget_mode'`) })

	// Missing key → default.
	v, err := repo.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		t.Fatalf("GetWithDefault: %v", err)
	}
	if v != "category" {
		t.Errorf("default = %q, want category", v)
	}

	if err := repo.Set(ctx, "budget_mode", "flex"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	v, err = repo.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		t.Fatalf("GetWithDefault 2: %v", err)
	}
	if v != "flex" {
		t.Errorf("after set = %q, want flex", v)
	}
}
