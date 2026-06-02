package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type PayeeRuleRepo struct{ pool *pgxpool.Pool }

func NewPayeeRuleRepo(pool *pgxpool.Pool) *PayeeRuleRepo { return &PayeeRuleRepo{pool: pool} }

// List returns all payee rules for the categorizer to match against.
func (r *PayeeRuleRepo) List(ctx context.Context) ([]model.PayeeRule, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, payee_pattern, category_id::text, match_count
		FROM payee_rules
	`)
	if err != nil {
		return nil, fmt.Errorf("list payee rules: %w", err)
	}
	defer rows.Close()
	var out []model.PayeeRule
	for rows.Next() {
		var p model.PayeeRule
		if err := rows.Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount); err != nil {
			return nil, fmt.Errorf("scan payee rule: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Learn upserts a rule for a normalized pattern within an existing transaction.
// Returns created=true if a new rule was inserted, false if an existing one was
// updated (category reassigned, match_count incremented).
func (r *PayeeRuleRepo) Learn(ctx context.Context, tx pgx.Tx, pattern, categoryID string) (bool, error) {
	var created bool
	err := tx.QueryRow(ctx, `
		INSERT INTO payee_rules (payee_pattern, category_id, match_count, last_used_at)
		VALUES ($1, $2, 1, NOW())
		ON CONFLICT (payee_pattern) DO UPDATE
		SET category_id  = EXCLUDED.category_id,
		    match_count  = payee_rules.match_count + 1,
		    last_used_at = NOW(),
		    updated_at   = NOW()
		RETURNING (xmax = 0) AS created
	`, pattern, categoryID).Scan(&created)
	if err != nil {
		return false, fmt.Errorf("learn payee rule: %w", err)
	}
	return created, nil
}
