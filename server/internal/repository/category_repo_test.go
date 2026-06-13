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

func TestCategoryRepo_ListGroups_IncomeFlag(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	gid := testutil.SeedIncomeGroup(t, pool)

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	var found *model.CategoryGroup
	for i := range groups {
		if groups[i].ID == gid {
			found = &groups[i]
		}
	}
	if found == nil {
		t.Fatal("income group not found in ListGroups result")
	}
	if !found.IsIncome {
		t.Errorf("IsIncome = false, want true")
	}
}

func TestCategoryRepo_UpdateRolloverAndFlexibility(t *testing.T) {
	pool := testutil.NewTestPool(t)
	repo := repository.NewCategoryRepo(pool)
	ctx := context.Background()

	groupID := testutil.SeedGroup(t, pool)
	var catID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid,'FlexTest',1) RETURNING id::text`,
		groupID).Scan(&catID); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM categories WHERE id=$1::uuid`, catID) })

	_, err := repo.UpdateCategory(ctx, catID, model.UpdateCategoryReq{
		Name: "FlexTest", SortOrder: 1, Currency: "CRC",
		Rollover: true, Flexibility: "non_monthly",
	})
	if err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}

	groups, err := repo.ListGroups(ctx)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	var found *model.Category
	for _, g := range groups {
		for i := range g.Categories {
			if g.Categories[i].ID == catID {
				found = &g.Categories[i]
			}
		}
	}
	if found == nil {
		t.Fatal("category not found")
	}
	if !found.Rollover {
		t.Error("Rollover not persisted")
	}
	if found.Flexibility != "non_monthly" {
		t.Errorf("Flexibility = %q, want non_monthly", found.Flexibility)
	}
}
