package repository

import (
	"context"
	"errors"
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

// Create inserts a new payee rule with match_count = 0.
func (r *PayeeRuleRepo) Create(ctx context.Context, pattern, categoryID string) (model.PayeeRule, error) {
	var p model.PayeeRule
	err := r.pool.QueryRow(ctx, `
		INSERT INTO payee_rules (payee_pattern, category_id, match_count)
		VALUES ($1, $2::uuid, 0)
		RETURNING id::text, payee_pattern, category_id::text, match_count
	`, pattern, categoryID).Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount)
	if err != nil {
		return p, fmt.Errorf("create payee rule: %w", err)
	}
	return p, nil
}

// Update changes the pattern and category of an existing rule, preserving match_count.
func (r *PayeeRuleRepo) Update(ctx context.Context, id, pattern, categoryID string) (model.PayeeRule, error) {
	var p model.PayeeRule
	err := r.pool.QueryRow(ctx, `
		UPDATE payee_rules
		SET payee_pattern = $1, category_id = $2::uuid, updated_at = NOW()
		WHERE id = $3::uuid
		RETURNING id::text, payee_pattern, category_id::text, match_count
	`, pattern, categoryID, id).Scan(&p.ID, &p.Pattern, &p.CategoryID, &p.MatchCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return p, ErrNotFound
		}
		return p, fmt.Errorf("update payee rule: %w", err)
	}
	return p, nil
}

// Delete removes a payee rule by ID. Returns ErrNotFound if no row was deleted.
func (r *PayeeRuleRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM payee_rules WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("delete payee rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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
