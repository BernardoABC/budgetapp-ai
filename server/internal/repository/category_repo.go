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
		SELECT g.id::text, g.name, g.sort_order, g.hidden, g.is_system, g.is_income,
		       c.id::text, c.name, c.hidden, c.sort_order, c.is_system, c.currency,
		       c.rollover, c.flexibility
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
		var gHidden, gSystem, gIncome bool
		var cID, cName *string
		var cHidden *bool
		var cSort *int
		var cSystem *bool
		var cCurrency *string
		var cRollover *bool
		var cFlexibility *string

		if err := rows.Scan(&gID, &gName, &gSort, &gHidden, &gSystem, &gIncome,
			&cID, &cName, &cHidden, &cSort, &cSystem, &cCurrency, &cRollover, &cFlexibility); err != nil {
			return nil, fmt.Errorf("scan category row: %w", err)
		}

		if _, ok := groupMap[gID]; !ok {
			groupMap[gID] = &model.CategoryGroup{
				ID: gID, Name: gName, SortOrder: gSort, Hidden: gHidden, IsSystem: gSystem, IsIncome: gIncome,
			}
			order = append(order, gID)
		}

		if cID != nil {
			sys := false
			if cSystem != nil {
				sys = *cSystem
			}
			cur := "CRC"
			if cCurrency != nil {
				cur = *cCurrency
			}
			roll := false
			if cRollover != nil {
				roll = *cRollover
			}
			flex := "flexible"
			if cFlexibility != nil {
				flex = *cFlexibility
			}
			groupMap[gID].Categories = append(groupMap[gID].Categories, model.Category{
				ID: *cID, GroupID: gID, Name: *cName,
				Currency: cur, Hidden: *cHidden, SortOrder: *cSort, IsSystem: sys,
				Rollover: roll, Flexibility: flex,
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
		RETURNING id::text, name, sort_order, hidden, is_system
	`, req.Name, req.SortOrder).Scan(&g.ID, &g.Name, &g.SortOrder, &g.Hidden, &g.IsSystem)
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
		RETURNING id::text, name, sort_order, hidden, is_system
	`, req.Name, req.SortOrder, req.Hidden, id).Scan(&g.ID, &g.Name, &g.SortOrder, &g.Hidden, &g.IsSystem)
	if err != nil {
		return g, fmt.Errorf("update category group: %w", err)
	}
	return g, nil
}

func (r *CategoryRepo) DeleteGroup(ctx context.Context, id string) error {
	var isSystem bool
	if err := r.pool.QueryRow(ctx,
		`SELECT is_system FROM category_groups WHERE id = $1`, id,
	).Scan(&isSystem); err != nil {
		return fmt.Errorf("check group exists: %w", err)
	}
	if isSystem {
		return fmt.Errorf("cannot delete system category group")
	}
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
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		INSERT INTO categories (group_id, name, sort_order, currency)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency
	`, req.GroupID, req.Name, req.SortOrder, currency).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency,
	)
	if err != nil {
		return c, fmt.Errorf("create category: %w", err)
	}
	return c, nil
}

func (r *CategoryRepo) UpdateCategory(ctx context.Context, id string, req model.UpdateCategoryReq) (model.Category, error) {
	currency := req.Currency
	if currency == "" {
		if err := r.pool.QueryRow(ctx,
			`SELECT currency FROM categories WHERE id = $1::uuid`, id,
		).Scan(&currency); err != nil {
			return model.Category{}, fmt.Errorf("get existing currency: %w", err)
		}
	}
	flexibility := req.Flexibility
	if flexibility == "" {
		flexibility = "flexible"
	}
	var c model.Category
	err := r.pool.QueryRow(ctx, `
		UPDATE categories
		SET name=$1, hidden=$2, sort_order=$3, currency=$4, rollover=$5, flexibility=$6, updated_at=NOW()
		WHERE id=$7
		RETURNING id::text, group_id::text, name, hidden, sort_order, currency, rollover, flexibility
	`, req.Name, req.Hidden, req.SortOrder, currency, req.Rollover, flexibility, id).Scan(
		&c.ID, &c.GroupID, &c.Name, &c.Hidden, &c.SortOrder, &c.Currency, &c.Rollover, &c.Flexibility,
	)
	if err != nil {
		return c, fmt.Errorf("update category: %w", err)
	}
	return c, nil
}

// UpdateCategoryCurrency sets the currency for a category without touching other fields.
func (r *CategoryRepo) UpdateCategoryCurrency(ctx context.Context, id, currency string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE categories SET currency = $1, updated_at = NOW() WHERE id = $2::uuid`,
		currency, id,
	)
	if err != nil {
		return fmt.Errorf("update category currency %s: %w", id, err)
	}
	return nil
}

// GetCurrencies returns a map of category ID → currency for the given IDs.
func (r *CategoryRepo) GetCurrencies(ctx context.Context, ids []string) (map[string]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, currency FROM categories WHERE id::text = ANY($1)`, ids,
	)
	if err != nil {
		return nil, fmt.Errorf("get currencies: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string, len(ids))
	for rows.Next() {
		var cid, cur string
		if err := rows.Scan(&cid, &cur); err != nil {
			return nil, fmt.Errorf("scan currency: %w", err)
		}
		out[cid] = cur
	}
	return out, rows.Err()
}

func (r *CategoryRepo) DeleteCategory(ctx context.Context, id string) error {
	var isSystem bool
	if err := r.pool.QueryRow(ctx,
		`SELECT is_system FROM categories WHERE id = $1`, id,
	).Scan(&isSystem); err != nil {
		return fmt.Errorf("check category exists: %w", err)
	}
	if isSystem {
		return fmt.Errorf("cannot delete system category")
	}
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
