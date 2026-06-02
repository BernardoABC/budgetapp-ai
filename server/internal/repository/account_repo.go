package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type AccountRepo struct{ pool *pgxpool.Pool }

func NewAccountRepo(pool *pgxpool.Pool) *AccountRepo { return &AccountRepo{pool: pool} }

func (r *AccountRepo) List(ctx context.Context) ([]model.Account, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, currency, balance, on_budget, closed,
		       COALESCE(note,''), sort_order
		FROM accounts WHERE closed = false
		ORDER BY sort_order, name
	`)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()
	var accounts []model.Account
	for rows.Next() {
		var a model.Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
			&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

func (r *AccountRepo) Get(ctx context.Context, id string) (model.Account, error) {
	var a model.Account
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, name, type, currency, balance, on_budget, closed,
		       COALESCE(note,''), sort_order
		FROM accounts WHERE id = $1
	`, id).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
		&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder)
	if err != nil {
		return a, fmt.Errorf("get account %s: %w", id, err)
	}
	return a, nil
}

func (r *AccountRepo) Create(ctx context.Context, req model.CreateAccountReq) (model.Account, error) {
	currency := req.Currency
	if currency == "" {
		currency = "CRC"
	}
	var a model.Account
	err := r.pool.QueryRow(ctx, `
		INSERT INTO accounts (name, type, currency, balance, on_budget, note, sort_order)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), $7)
		RETURNING id::text, name, type, currency, balance, on_budget, closed,
		          COALESCE(note,''), sort_order
	`, req.Name, req.Type, currency, req.Balance*100, req.OnBudget, req.Note, req.SortOrder,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
		&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder)
	if err != nil {
		return a, fmt.Errorf("create account: %w", err)
	}
	return a, nil
}

func (r *AccountRepo) Update(ctx context.Context, id string, req model.UpdateAccountReq) (model.Account, error) {
	var a model.Account
	err := r.pool.QueryRow(ctx, `
		UPDATE accounts
		SET name=$1, type=$2, currency=$3, on_budget=$4, note=NULLIF($5,''), sort_order=$6,
		    updated_at=NOW()
		WHERE id=$7
		RETURNING id::text, name, type, currency, balance, on_budget, closed,
		          COALESCE(note,''), sort_order
	`, req.Name, req.Type, req.Currency, req.OnBudget, req.Note, req.SortOrder, id,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
		&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder)
	if err != nil {
		return a, fmt.Errorf("update account %s: %w", id, err)
	}
	return a, nil
}

func (r *AccountRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete account %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("account %s not found", id)
	}
	return nil
}

func (r *AccountRepo) ToggleClosed(ctx context.Context, id string) (model.Account, error) {
	var a model.Account
	err := r.pool.QueryRow(ctx, `
		UPDATE accounts SET closed = NOT closed, updated_at = NOW()
		WHERE id = $1
		RETURNING id::text, name, type, currency, balance, on_budget, closed,
		          COALESCE(note,''), sort_order
	`, id).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance,
		&a.OnBudget, &a.Closed, &a.Note, &a.SortOrder)
	if err != nil {
		return a, fmt.Errorf("toggle closed %s: %w", id, err)
	}
	return a, nil
}
