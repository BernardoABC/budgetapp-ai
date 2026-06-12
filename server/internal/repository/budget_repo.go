// server/internal/repository/budget_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// currencyConversionExpr is the SQL CASE expression that converts transaction amounts
// to the category's native currency using the stamped exchange rate, nearest available
// rate, or a hardcoded fallback of 500 CRC/USD.
const currencyConversionExpr = `CASE
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
END`

type BudgetRepo struct{ pool *pgxpool.Pool }

func NewBudgetRepo(pool *pgxpool.Pool) *BudgetRepo { return &BudgetRepo{pool: pool} }

type PlannedEntry struct {
	CategoryID string
	Month      string // YYYY-MM-DD (first of month)
	Planned    int64
}

// GetAllPlannedUpToMonth returns all budget rows up to and including the given month.
// Result: map[categoryID][YYYY-MM-01] = planned.
func (r *BudgetRepo) GetAllPlannedUpToMonth(ctx context.Context, month string) (map[string]map[string]int64, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category_id::text, month::text, planned
		FROM budgets
		WHERE month <= $1::date
	`, month)
	if err != nil {
		return nil, fmt.Errorf("get planned up to %s: %w", month, err)
	}
	defer rows.Close()
	out := make(map[string]map[string]int64)
	for rows.Next() {
		var catID, m string
		var planned int64
		if err := rows.Scan(&catID, &m, &planned); err != nil {
			return nil, fmt.Errorf("scan planned: %w", err)
		}
		if out[catID] == nil {
			out[catID] = make(map[string]int64)
		}
		out[catID][m] = planned
	}
	return out, rows.Err()
}

// UpsertPlanned creates or updates the planned amount for a category in a month.
func (r *BudgetRepo) UpsertPlanned(ctx context.Context, categoryID, month string, planned int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO budgets (category_id, month, planned)
		VALUES ($1::uuid, $2::date, $3)
		ON CONFLICT (category_id, month) DO UPDATE
		SET planned    = EXCLUDED.planned,
		    updated_at = NOW()
	`, categoryID, month, planned)
	if err != nil {
		return fmt.Errorf("upsert planned %s/%s: %w", categoryID, month, err)
	}
	return nil
}

// BulkInsertPlannedIfAbsent inserts budget rows only for categories that have no row yet.
// Existing rows (including those with planned = 0) are left untouched.
// Use UpsertPlanned when you need to overwrite an existing value.
func (r *BudgetRepo) BulkInsertPlannedIfAbsent(ctx context.Context, entries []PlannedEntry) error {
	for _, e := range entries {
		_, err := r.pool.Exec(ctx, `
			INSERT INTO budgets (category_id, month, planned)
			VALUES ($1::uuid, $2::date, $3)
			ON CONFLICT (category_id, month) DO NOTHING
		`, e.CategoryID, e.Month, e.Planned)
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
		       SUM(`+currencyConversionExpr+`) AS activity
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

// crcConvExpr converts a transaction amount to CRC centimos using the stamped
// rate, nearest available rate, or fallback 500. Used for cross-category CRC rollups.
const crcConvExpr = `CASE
  WHEN a.currency = 'CRC' THEN t.amount
  ELSE ROUND(t.amount::numeric * COALESCE(
    t.exchange_rate,
    (SELECT er.usd_to_crc FROM exchange_rates er WHERE er.date <= t.date ORDER BY er.date DESC LIMIT 1),
    500))::bigint
END`

// GetActualIncomeForMonth returns total inflow (CRC) booked to the Income system
// category in the given YYYY-MM month, on on-budget accounts.
func (r *BudgetRepo) GetActualIncomeForMonth(ctx context.Context, month string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(`+crcConvExpr+`), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND cat.is_system = true AND cat.name = 'Income'
		  AND date_trunc('month', t.date) = ($1 || '-01')::date
	`, month).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("actual income %s: %w", month, err)
	}
	return total, nil
}

// GetActualSpendingForMonth returns total outflow (CRC, positive) in non-system
// categories for the given YYYY-MM month, on on-budget accounts.
func (r *BudgetRepo) GetActualSpendingForMonth(ctx context.Context, month string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(-SUM(`+crcConvExpr+`), 0)
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND cat.is_system = false
		  AND t.amount < 0
		  AND date_trunc('month', t.date) = ($1 || '-01')::date
	`, month).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("actual spending %s: %w", month, err)
	}
	return total, nil
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
		       SUM(`+currencyConversionExpr+`) AS converted_amount
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

// CashFlowRow is one month of actual income and spending in CRC centimos.
type CashFlowRow struct {
	Month    string
	Income   int64
	Spending int64
}

// GetCashFlowByMonth returns per-month actual income (Income system category
// inflow) and spending (non-system outflow, positive), both in CRC, for the
// inclusive YYYY-MM range. Mirrors GetActualIncomeForMonth/GetActualSpendingForMonth.
func (r *BudgetRepo) GetCashFlowByMonth(ctx context.Context, from, to string) ([]CashFlowRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
		       COALESCE(SUM(`+crcConvExpr+`) FILTER (WHERE cat.is_system = true AND cat.name = 'Income'), 0) AS income,
		       COALESCE(-SUM(`+crcConvExpr+`) FILTER (WHERE cat.is_system = false AND t.amount < 0), 0) AS spending
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		JOIN categories cat ON cat.id = t.category_id
		WHERE a.on_budget = true
		  AND t.date >= ($1 || '-01')::date
		  AND t.date <  (($2 || '-01')::date + INTERVAL '1 month')
		GROUP BY date_trunc('month', t.date)
		ORDER BY date_trunc('month', t.date)
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("cash flow by month: %w", err)
	}
	defer rows.Close()
	var out []CashFlowRow
	for rows.Next() {
		var row CashFlowRow
		if err := rows.Scan(&row.Month, &row.Income, &row.Spending); err != nil {
			return nil, fmt.Errorf("scan cash flow row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ClearAllPlanned deletes all budget rows for a category (used when changing category currency).
func (r *BudgetRepo) ClearAllPlanned(ctx context.Context, categoryID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM budgets WHERE category_id = $1::uuid`, categoryID,
	)
	if err != nil {
		return fmt.Errorf("clear planned for %s: %w", categoryID, err)
	}
	return nil
}
