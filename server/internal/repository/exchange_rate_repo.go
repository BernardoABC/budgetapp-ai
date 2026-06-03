// server/internal/repository/exchange_rate_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type ExchangeRateRepo struct{ pool *pgxpool.Pool }

func NewExchangeRateRepo(pool *pgxpool.Pool) *ExchangeRateRepo {
	return &ExchangeRateRepo{pool: pool}
}

// ExistingDates returns a set of which of the given YYYY-MM-DD dates already have a row.
func (r *ExchangeRateRepo) ExistingDates(ctx context.Context, dates []string) (map[string]bool, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT date::text FROM exchange_rates WHERE date::text = ANY($1)`,
		dates,
	)
	if err != nil {
		return nil, fmt.Errorf("existing exchange rate dates: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool, len(dates))
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return nil, fmt.Errorf("scan date: %w", err)
		}
		out[d] = true
	}
	return out, rows.Err()
}

// GetNearest returns the most recent rate on or before date.
func (r *ExchangeRateRepo) GetNearest(ctx context.Context, date string) (*model.ExchangeRate, error) {
	var er model.ExchangeRate
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, date::text, usd_to_crc, source, created_at::text
		FROM exchange_rates
		WHERE date <= $1::date
		ORDER BY date DESC
		LIMIT 1
	`, date).Scan(&er.ID, &er.Date, &er.USDToCRC, &er.Source, &er.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get nearest rate for %s: %w", date, err)
	}
	return &er, nil
}

// Upsert inserts or updates the rate for a date.
func (r *ExchangeRateRepo) Upsert(ctx context.Context, date string, rate float64, source string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO exchange_rates (date, usd_to_crc, source)
		VALUES ($1::date, $2, $3)
		ON CONFLICT (date) DO UPDATE
		SET usd_to_crc = EXCLUDED.usd_to_crc,
		    source     = EXCLUDED.source
	`, date, rate, source)
	if err != nil {
		return fmt.Errorf("upsert rate %s: %w", date, err)
	}
	return nil
}

// ListByRange returns all rates in [from, to] inclusive, ordered by date asc.
func (r *ExchangeRateRepo) ListByRange(ctx context.Context, from, to string) ([]model.ExchangeRate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, date::text, usd_to_crc, source, created_at::text
		FROM exchange_rates
		WHERE date BETWEEN $1::date AND $2::date
		ORDER BY date ASC
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("list rates: %w", err)
	}
	defer rows.Close()
	var out []model.ExchangeRate
	for rows.Next() {
		var er model.ExchangeRate
		if err := rows.Scan(&er.ID, &er.Date, &er.USDToCRC, &er.Source, &er.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan rate: %w", err)
		}
		out = append(out, er)
	}
	return out, rows.Err()
}
