// server/internal/repository/budget_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type BudgetRepo struct{ pool *pgxpool.Pool }

func NewBudgetRepo(pool *pgxpool.Pool) *BudgetRepo { return &BudgetRepo{pool: pool} }

type BudgetAssignedEntry struct {
	CategoryID string
	Month      string // YYYY-MM-DD (first of month)
	Assigned   int64
}

// GetAllAssignedUpToMonth returns all budget rows up to and including the given month.
// Result: map[categoryID][YYYY-MM-01] = assigned.
func (r *BudgetRepo) GetAllAssignedUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category_id::text, month::text, assigned
		FROM budgets
		WHERE month <= $1::date
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get assigned up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]int64)
	for rows.Next() {
		var catID, m string
		var assigned int64
		if err := rows.Scan(&catID, &m, &assigned); err != nil {
			return nil, fmt.Errorf("scan assigned: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]int64)
		}
		out[catID][m] = assigned
	}
	return out, rows.Err()
}

// UpsertAssigned creates or updates the assigned amount for a category in a month.
func (r *BudgetRepo) UpsertAssigned(ctx context.Context, categoryID, month string, assigned int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO budgets (category_id, month, assigned)
		VALUES ($1::uuid, $2::date, $3)
		ON CONFLICT (category_id, month) DO UPDATE
		SET assigned   = EXCLUDED.assigned,
		    updated_at = NOW()
	`, categoryID, month, assigned)
	if err != nil {
		return fmt.Errorf("upsert assigned %s/%s: %w", categoryID, month, err)
	}
	return nil
}

// BulkInsertAssignedIfAbsent inserts budget rows only for categories that have no row yet.
// Existing rows (including those with assigned = 0) are left untouched.
// Use UpsertAssigned when you need to overwrite an existing value.
func (r *BudgetRepo) BulkInsertAssignedIfAbsent(ctx context.Context, entries []BudgetAssignedEntry) error {
	for _, e := range entries {
		_, err := r.pool.Exec(ctx, `
			INSERT INTO budgets (category_id, month, assigned)
			VALUES ($1::uuid, $2::date, $3)
			ON CONFLICT (category_id, month) DO NOTHING
		`, e.CategoryID, e.Month, e.Assigned)
		if err != nil {
			return fmt.Errorf("bulk upsert %s/%s: %w", e.CategoryID, e.Month, err)
		}
	}
	return nil
}

// GetAllActivityUpToMonth returns SUM(amount) grouped by (category_id, YYYY-MM-01)
// for all on-budget transactions up to the last day of the given month.
// Result: map[categoryID][YYYY-MM-01] = sum.
func (r *BudgetRepo) GetAllActivityUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       date_trunc('month', t.date)::date::text AS m,
		       SUM(t.amount) AS activity
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		WHERE a.on_budget = true
		  AND t.category_id IS NOT NULL
		  AND t.date <= $1::date
		GROUP BY t.category_id, date_trunc('month', t.date)
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get activity up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]int64)
	for rows.Next() {
		var catID, m string
		var activity int64
		if err := rows.Scan(&catID, &m, &activity); err != nil {
			return nil, fmt.Errorf("scan activity: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]int64)
		}
		out[catID][m] = activity
	}
	return out, rows.Err()
}

// GetOnBudgetBalance returns the sum of balances of all open on-budget accounts.
func (r *BudgetRepo) GetOnBudgetBalance(ctx context.Context) (int64, error) {
	var total int64
	if err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE on_budget = true AND closed = false`,
	).Scan(&total); err != nil {
		return 0, fmt.Errorf("get on-budget balance: %w", err)
	}
	return total, nil
}

// GetOutflow30Days returns the sum of absolute values of negative transactions
// on on-budget accounts within the past 30 days.
func (r *BudgetRepo) GetOutflow30Days(ctx context.Context) (int64, error) {
	var total int64
	if err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ABS(t.amount)), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		WHERE a.on_budget = true
		  AND t.amount < 0
		  AND t.date >= CURRENT_DATE - INTERVAL '30 days'
	`).Scan(&total); err != nil {
		return 0, fmt.Errorf("get outflow 30 days: %w", err)
	}
	return total, nil
}

// AtomicMove adjusts assigned for two categories in the same month atomically.
// from's assigned decreases by amount; to's assigned increases by amount.
func (r *BudgetRepo) AtomicMove(ctx context.Context, fromCatID, toCatID, month string, amount int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin move tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, q := range []struct {
		catID string
		delta int64
	}{
		{fromCatID, -amount},
		{toCatID, +amount},
	} {
		_, err := tx.Exec(ctx, `
			INSERT INTO budgets (category_id, month, assigned)
			VALUES ($1::uuid, $2::date, $3)
			ON CONFLICT (category_id, month) DO UPDATE
			SET assigned   = budgets.assigned + EXCLUDED.assigned,
			    updated_at = NOW()
		`, q.catID, month, q.delta)
		if err != nil {
			return fmt.Errorf("move delta for %s: %w", q.catID, err)
		}
	}
	return tx.Commit(ctx)
}
