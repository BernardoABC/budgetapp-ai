package repository_test

import (
	"context"
	"testing"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/testutil"
)

func TestCategoryRepo_Currency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	catID := testutil.SeedCategoryWithCurrency(t, pool, "USD")

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}

	var found string
	for _, g := range groups {
		for _, c := range g.Categories {
			if c.ID == catID {
				found = c.Currency
			}
		}
	}
	if found != "USD" {
		t.Errorf("expected currency USD, got %q", found)
	}
}

func TestCategoryRepo_CreateCategory_Currency(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	groupID := testutil.SeedGroup(t, pool)
	cat, err := repo.CreateCategory(ctx, model.CreateCategoryReq{
		GroupID:  groupID,
		Name:     "Rent",
		Currency: "USD",
	})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if cat.Currency != "USD" {
		t.Errorf("expected USD, got %q", cat.Currency)
	}
}
