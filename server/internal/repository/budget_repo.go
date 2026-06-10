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
// Amounts are converted to each category's native currency using the transaction's
// stamped exchange_rate; falls back to the nearest available rate when not stamped.
// Result: map[categoryID][YYYY-MM-01] = sum in category native currency minor units.
func (r *BudgetRepo) GetAllActivityUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       date_trunc('month', t.date)::date::text AS m,
		       SUM(
		         CASE
		           WHEN a.currency = cat.currency THEN t.amount
		           WHEN cat.currency = 'CRC' THEN
		             ROUND(t.amount::numeric * COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           WHEN cat.currency = 'USD' THEN
		             ROUND(t.amount::numeric / COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           ELSE t.amount
		         END
		       ) AS activity
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
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

// CurrencyBalance holds on-budget account balances split by currency.
type CurrencyBalance struct {
	CRC int64
	USD int64
}

// GetOnBudgetBalanceByCurrency returns on-budget account balances split into CRC and USD minor units.
func (r *BudgetRepo) GetOnBudgetBalanceByCurrency(ctx context.Context) (CurrencyBalance, error) {
	var bal CurrencyBalance
	err := r.pool.QueryRow(ctx, `
		SELECT
		  COALESCE(SUM(balance) FILTER (WHERE currency = 'CRC'), 0),
		  COALESCE(SUM(balance) FILTER (WHERE currency = 'USD'), 0)
		FROM accounts
		WHERE on_budget = true AND closed = false
	`).Scan(&bal.CRC, &bal.USD)
	if err != nil {
		return bal, fmt.Errorf("get balance by currency: %w", err)
	}
	return bal, nil
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

// ActivityBreakdownRow is one line of the per-currency activity breakdown for a category in a month.
type ActivityBreakdownRow struct {
	CategoryID      string
	TxnCurrency     string // currency of the source transaction/account
	Amount          int64  // raw amount in TxnCurrency minor units
	ConvertedAmount int64  // amount converted to the category's native currency (equals Amount when same currency)
}

// GetActivityBreakdownForMonth returns per-currency activity for a single month (used for display).
func (r *BudgetRepo) GetActivityBreakdownForMonth(ctx context.Context, month string) ([]ActivityBreakdownRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.category_id::text,
		       a.currency AS txn_currency,
		       SUM(t.amount) AS amount,
		       SUM(
		         CASE
		           WHEN a.currency = cat.currency THEN t.amount
		           WHEN cat.currency = 'CRC' THEN
		             ROUND(t.amount::numeric * COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           WHEN cat.currency = 'USD' THEN
		             ROUND(t.amount::numeric / COALESCE(
		               t.exchange_rate,
		               (SELECT er.usd_to_crc FROM exchange_rates er
		                WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
		               500
		             ))::bigint
		           ELSE t.amount
		         END
		       ) AS converted_amount
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND t.category_id IS NOT NULL
		  AND date_trunc('month', t.date) = $1::date
		GROUP BY t.category_id, a.currency, cat.currency
	`, month+"-01")
	if err != nil {
		return nil, fmt.Errorf("get activity breakdown for %s: %w", month, err)
	}
	defer rows.Close()
	var out []ActivityBreakdownRow
	for rows.Next() {
		var row ActivityBreakdownRow
		if err := rows.Scan(&row.CategoryID, &row.TxnCurrency, &row.Amount, &row.ConvertedAmount); err != nil {
			return nil, fmt.Errorf("scan breakdown: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ClearAllAssigned deletes all budget rows for a category (used when changing category currency).
func (r *BudgetRepo) ClearAllAssigned(ctx context.Context, categoryID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM budgets WHERE category_id = $1::uuid`, categoryID,
	)
	if err != nil {
		return fmt.Errorf("clear assigned for %s: %w", categoryID, err)
	}
	return nil
}
