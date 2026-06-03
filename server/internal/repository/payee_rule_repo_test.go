package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestPayeeRuleCRUD(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewPayeeRuleRepo(pool)
	ctx := context.Background()
	catID := testutil.SeedCategory(t, pool)

	// Create
	rule, err := repo.Create(ctx, "walmart", catID)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rule.Pattern != "walmart" {
		t.Errorf("Pattern = %q, want %q", rule.Pattern, "walmart")
	}
	if rule.MatchCount != 0 {
		t.Errorf("MatchCount = %d, want 0", rule.MatchCount)
	}
	if rule.ID == "" {
		t.Error("ID is empty")
	}

	// List includes new rule
	rules, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	found := false
	for _, r := range rules {
		if r.ID == rule.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("created rule not found in List")
	}

	// Update pattern
	updated, err := repo.Update(ctx, rule.ID, "walmart-cr", catID)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Pattern != "walmart-cr" {
		t.Errorf("updated Pattern = %q", updated.Pattern)
	}
	if updated.MatchCount != 0 {
		t.Errorf("Update should preserve MatchCount, got %d", updated.MatchCount)
	}

	// Delete
	if err := repo.Delete(ctx, rule.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	rules2, _ := repo.List(ctx)
	for _, r := range rules2 {
		if r.ID == rule.ID {
			t.Error("rule still present after Delete")
		}
	}
}

func TestPayeeRuleDeleteNotFound(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewPayeeRuleRepo(pool)
	ctx := context.Background()

	err := repo.Delete(ctx, "00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("expected ErrNotFound, got nil")
	}
}
