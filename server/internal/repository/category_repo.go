package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type CategoryRepo struct{ pool *pgxpool.Pool }

func NewCategoryRepo(pool *pgxpool.Pool) *CategoryRepo { return &CategoryRepo{pool: pool} }

func (r *CategoryRepo) ListGroups(ctx context.Context) ([]model.CategoryGroup, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system,
		       c.id::text, c.name, c.hidden, c.sort_order, c.is_system
		FROM category_groups g
		LEFT JOIN categories c ON c.group_id = g.id AND c.hidden = false
		ORDER BY g.sort_order, g.name, c.sort_order, c.name
	`)
	if err != nil {
		return nil, fmt.Errorf("list category groups: %w", err)
	}
	defer rows.Close()

	groupMap := make(map[string]*model.CategoryGroup)
	var order []string

	for rows.Next() {
		var gID, gName string
		var gSort int
		var gHidden, gSystem bool
		var cID, cName *string
		var cHidden *bool
		var cSort *int
		var cSystem *bool

		if err := rows.Scan(&gID, &gName, &gSort, &gHidden, &gSystem,
			&cID, &cName, &cHidden, &cSort, &cSystem); err != nil {
			return nil, fmt.Errorf("scan category row: %w", err)
		}

		if _, ok := groupMap[gID]; !ok {
			groupMap[gID] = &model.CategoryGroup{
				ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden, IsSystem: gSystem,
			}
			order = append(order, gID)
		}

		if cID != nil {
			sys := false
			if cSystem != nil {
				sys = *cSystem
			}
			groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
				ID: *cID, GroupID: gID, Name: *cName,
				Hidden: *cHidden, SortOrder: *cSort, IsSystem: sys,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	groups := make([]model.CategoryGroup, 0, len(order))
	for _, id := range order {
		groups = append(groups, *groupMap[id])
	}
	return groups, nil
}

func (r *CategoryRepo) CreateGroup(ctx context.Context, req model.CreateGroupReq) (model.CategoryGroup, error) {
	var g model.CategoryGroup
	err := r.pool.QueryRow(ctx, `
		INSERT INTO category_groups (name, sort_order)
		VALUES ($1, $2)
		RETURNING id::text, name, sort_order, hidden
	`, req.Name, req.SortOrder).Scan(&g.ID, &g.Name, &g.SortOrder, &g.Hidden)
	if err != nil {
		return g, fmt.Errorf("create category group: %w", err)
	}
	return g, nil
}

func (r *CategoryRepo) UpdateGroup(ctx context.Context, id string, req model.UpdateGroupReq) (model.CategoryGroup, error) {
	var g model.CategoryGroup
	err := r.pool.QueryRow(ctx, `
		UPDATE category_groups SET name=$1, sort_order=$2, hidden=$3, updated_at=NOW()
		WHERE id=$4
		RETURNING id::text, name, sort_order, hidden
	`, req.Name, req.SortOrder, req.Hidden, id).Scan(&g.ID, &g.Name, &g.SortOrder, &g.Hidden)
	if err != nil {
		return g, fmt.Errorf("update category group: %w", err)
	}
	return g, nil
}

func (r *CategoryRepo) DeleteGroup(ctx context.Context, id string) error {
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM categories WHERE group_id = $1`, id,
	).Scan(&count); err != nil {
		return fmt.Errorf("check group children: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("group has %d categories; delete them first", count)
	}
	_, err := r.pool.Exec(ctx, `DELETE FROM category_groups WHERE id = $1`, id)
	return err
}

func (r *CategoryRepo) CreateCategory(ctx context.Context, req model.CreateCategoryReq) (model.Category, error) {
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		INSERT INTO categories (group_id, name, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id::text, group_id::text, name, hidden, sort_order
	`, req.GroupID, req.Name, req.SortOrder).Scan(&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder)
	if err != nil {
		return c, fmt.Errorf("create category: %w", err)
	}
	return c, nil
}

func (r *CategoryRepo) UpdateCategory(ctx context.Context, id string, req model.UpdateCategoryReq) (model.Category, error) {
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		UPDATE categories SET name=$1, hidden=$2, sort_order=$3, updated_at=NOW()
		WHERE id=$4
		RETURNING id::text, group_id::text, name, hidden, sort_order
	`, req.Name, req.Hidden, req.SortOrder, id).Scan(&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder)
	if err != nil {
		return c, fmt.Errorf("update category: %w", err)
	}
	return c, nil
}

func (r *CategoryRepo) DeleteCategory(ctx context.Context, id string) error {
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE category_id = $1`, id,
	).Scan(&count); err != nil {
		return fmt.Errorf("check category transactions: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("category has %d transactions; re-categorize them first", count)
	}
	_, err := r.pool.Exec(ctx, `DELETE FROM categories WHERE id = $1`, id)
	return err
}
