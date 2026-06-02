package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type TransactionRepo struct{ pool *pgxpool.Pool }

func NewTransactionRepo(pool *pgxpool.Pool) *TransactionRepo {
	return &TransactionRepo{pool: pool}
}

func (r *TransactionRepo) ListByAccount(ctx context.Context, accountID string, page, perPage int) ([]model.Transaction, int64, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 500 {
		perPage = 100
	}
	offset := (page - 1) * perPage

	var total int64
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions WHERE account_id = $1`, accountID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count transactions: %w", err)
	}

	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = $1
		ORDER BY t.date DESC, t.created_at DESC
		LIMIT $2 OFFSET $3
	`, accountID, perPage, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	var txns []model.Transaction
	for rows.Next() {
		var t model.Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared); err != nil {
			return nil, 0, fmt.Errorf("scan transaction: %w", err)
		}
		txns = append(txns, t)
	}
	return txns, total, rows.Err()
}

func (r *TransactionRepo) Get(ctx context.Context, id string) (model.Transaction, error) {
	var t model.Transaction
	err := r.pool.QueryRow(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.id = $1
	`, id).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared)
	if err != nil {
		return t, fmt.Errorf("get transaction %s: %w", id, err)
	}
	return t, nil
}

// Create inserts the transaction and updates the account balance atomically.
// req.Amount is in colones (display units); stored as centimos (×100).
func (r *TransactionRepo) Create(ctx context.Context, accountID string, req model.CreateTransactionReq) (model.Transaction, error) {
	amountCentimos := req.Amount * 100

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return model.Transaction{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var catIDParam interface{}
	if req.CategoryID != "" {
		catIDParam = req.CategoryID
	}

	var t model.Transaction
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (account_id, category_id, date, amount, currency, payee, memo, cleared)
		VALUES ($1, $2, $3, $4, (SELECT currency FROM accounts WHERE id=$1), $5, NULLIF($6,''), $7)
		RETURNING id::text, account_id::text,
		          COALESCE(category_id::text,''), '',
		          date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared
	`, accountID, catIDParam, req.Date, amountCentimos, req.Payee, req.Memo, req.Cleared,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared)
	if err != nil {
		return t, fmt.Errorf("insert transaction: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
		amountCentimos, accountID,
	); err != nil {
		return t, fmt.Errorf("update balance: %w", err)
	}

	// Populate category name within the same tx
	if t.CategoryID != "" {
		tx.QueryRow(ctx, `SELECT name FROM categories WHERE id = $1`, t.CategoryID).Scan(&t.CategoryName) //nolint:errcheck
	}

	return t, tx.Commit(ctx)
}

// Update replaces a transaction and adjusts the account balance for the diff.
// req.Amount is in colones; stored as centimos.
func (r *TransactionRepo) Update(ctx context.Context, id string, req model.UpdateTransactionReq) (model.Transaction, error) {
	newAmountCentimos := req.Amount * 100

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return model.Transaction{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var oldAmount int64
	var accountID string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text FROM transactions WHERE id = $1`, id,
	).Scan(&oldAmount, &accountID); err != nil {
		return model.Transaction{}, fmt.Errorf("get old transaction: %w", err)
	}

	var catIDParam interface{}
	if req.CategoryID != "" {
		catIDParam = req.CategoryID
	}

	var t model.Transaction
	err = tx.QueryRow(ctx, `
		UPDATE transactions
		SET category_id=$1, date=$2, amount=$3, payee=$4, memo=NULLIF($5,''), cleared=$6, updated_at=NOW()
		WHERE id=$7
		RETURNING id::text, account_id::text,
		          COALESCE(category_id::text,''), '',
		          date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared
	`, catIDParam, req.Date, newAmountCentimos, req.Payee, req.Memo, req.Cleared, id,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared)
	if err != nil {
		return t, fmt.Errorf("update transaction: %w", err)
	}

	diff := newAmountCentimos - oldAmount
	if diff != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
			diff, accountID,
		); err != nil {
			return t, fmt.Errorf("update balance: %w", err)
		}
	}

	if t.CategoryID != "" {
		tx.QueryRow(ctx, `SELECT name FROM categories WHERE id = $1`, t.CategoryID).Scan(&t.CategoryName) //nolint:errcheck
	}

	return t, tx.Commit(ctx)
}

func (r *TransactionRepo) Delete(ctx context.Context, id string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var amount int64
	var accountID string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text FROM transactions WHERE id = $1`, id,
	).Scan(&amount, &accountID); err != nil {
		return fmt.Errorf("get transaction for delete: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`,
		amount, accountID,
	); err != nil {
		return fmt.Errorf("reverse balance: %w", err)
	}

	return tx.Commit(ctx)
}
