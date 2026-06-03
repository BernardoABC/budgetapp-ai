// server/internal/repository/target_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"budgetapp/internal/model"
)

type TargetRepo struct{ pool *pgxpool.Pool }

func NewTargetRepo(pool *pgxpool.Pool) *TargetRepo { return &TargetRepo{pool: pool} }

// GetAll returns all targets keyed by category_id.
func (r *TargetRepo) GetAll(ctx context.Context) (map[string]*model.Target, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category_id::text, type, amount, deadline::text
		FROM category_targets
	`)
	if err != nil {
		return nil, fmt.Errorf("get all targets: %w", err)
	}
	defer rows.Close()

	out := make(map[string]*model.Target)
	for rows.Next() {
		var categoryID string
		var targetType string
		var amount int64
		var deadline *string

		if err := rows.Scan(&categoryID, &targetType, &amount, &deadline); err != nil {
			return nil, fmt.Errorf("scan target: %w", err)
		}

		out[categoryID] = &model.Target{
			Type:     targetType,
			Amount:   amount,
			Deadline: deadline,
		}
	}
	return out, rows.Err()
}

// Upsert creates or replaces a target for a category.
func (r *TargetRepo) Upsert(ctx context.Context, categoryID string, t model.Target) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO category_targets (category_id, type, amount, deadline)
		VALUES ($1::uuid, $2, $3, $4::date)
		ON CONFLICT (category_id) DO UPDATE
		SET type = EXCLUDED.type,
		    amount = EXCLUDED.amount,
		    deadline = EXCLUDED.deadline,
		    updated_at = NOW()
	`, categoryID, t.Type, t.Amount, t.Deadline)
	if err != nil {
		return fmt.Errorf("upsert target %s: %w", categoryID, err)
	}
	return nil
}

// Delete removes a target for a category (no-op if not set).
func (r *TargetRepo) Delete(ctx context.Context, categoryID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM category_targets WHERE category_id = $1::uuid
	`, categoryID)
	if err != nil {
		return fmt.Errorf("delete target %s: %w", categoryID, err)
	}
	return nil
}
