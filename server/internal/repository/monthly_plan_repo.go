package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MonthlyPlanRepo struct{ pool *pgxpool.Pool }

func NewMonthlyPlanRepo(pool *pgxpool.Pool) *MonthlyPlanRepo { return &MonthlyPlanRepo{pool: pool} }

type MonthlyPlan struct {
	Month          string
	ExpectedIncome int64
	FlexBudget     int64
}

// Get returns the plan for a month (YYYY-MM-DD, first of month). Missing → zero values.
func (r *MonthlyPlanRepo) Get(ctx context.Context, month string) (MonthlyPlan, error) {
	var p MonthlyPlan
	p.Month = month
	err := r.pool.QueryRow(ctx,
		`SELECT expected_income, flex_budget FROM monthly_plans WHERE month = $1::date`, month,
	).Scan(&p.ExpectedIncome, &p.FlexBudget)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, fmt.Errorf("get monthly plan %s: %w", month, err)
	}
	return p, nil
}

func (r *MonthlyPlanRepo) SetExpectedIncome(ctx context.Context, month string, amount int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO monthly_plans (month, expected_income) VALUES ($1::date, $2)
		ON CONFLICT (month) DO UPDATE SET expected_income = EXCLUDED.expected_income, updated_at = NOW()
	`, month, amount)
	if err != nil {
		return fmt.Errorf("set expected income %s: %w", month, err)
	}
	return nil
}

func (r *MonthlyPlanRepo) SetFlexBudget(ctx context.Context, month string, amount int64) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO monthly_plans (month, flex_budget) VALUES ($1::date, $2)
		ON CONFLICT (month) DO UPDATE SET flex_budget = EXCLUDED.flex_budget, updated_at = NOW()
	`, month, amount)
	if err != nil {
		return fmt.Errorf("set flex budget %s: %w", month, err)
	}
	return nil
}
