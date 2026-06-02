package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type ImportRepo struct{ pool *pgxpool.Pool }

func NewImportRepo(pool *pgxpool.Pool) *ImportRepo { return &ImportRepo{pool: pool} }

// DupCandidate is an existing transaction with the same account, date, and amount
// as an incoming row. The service narrows these to true duplicates by comparing
// normalized descriptions and references.
type DupCandidate struct {
	ID        string
	Payee     string
	Reference string
}

func (r *ImportRepo) DupCandidates(ctx context.Context, accountID, date string, amount int64) ([]DupCandidate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(payee,''), COALESCE(check_number,'')
		FROM transactions
		WHERE account_id = $1 AND date = $2 AND amount = $3
	`, accountID, date, amount)
	if err != nil {
		return nil, fmt.Errorf("dup candidates: %w", err)
	}
	defer rows.Close()
	var out []DupCandidate
	for rows.Next() {
		var c DupCandidate
		if err := rows.Scan(&c.ID, &c.Payee, &c.Reference); err != nil {
			return nil, fmt.Errorf("scan dup candidate: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateImport inserts the imports row within the confirm transaction.
func (r *ImportRepo) CreateImport(ctx context.Context, tx pgx.Tx, accountID, filename string, count int) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO imports (account_id, filename, transaction_count, status)
		VALUES ($1, $2, $3, 'completed')
		RETURNING id::text
	`, accountID, filename, count).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create import: %w", err)
	}
	return id, nil
}

// InsertImportedTxn inserts one imported transaction within the confirm transaction.
// categoryID is nil for uncategorized; exchange_rate is left NULL (deferred).
func (r *ImportRepo) InsertImportedTxn(
	ctx context.Context, tx pgx.Tx,
	accountID, importID, date string, amount int64, currency, payee, reference string,
	categoryID *string, memo *string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO transactions
			(account_id, category_id, date, amount, currency, payee, check_number, memo, import_id, cleared)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''), NULLIF($7,''), $8, $9, false)
	`, accountID, categoryID, date, amount, currency, payee, reference, memo, importID)
	if err != nil {
		return fmt.Errorf("insert imported txn: %w", err)
	}
	return nil
}

// List returns import history, newest first.
func (r *ImportRepo) List(ctx context.Context) ([]model.ImportRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, account_id::text, filename, imported_at::text, transaction_count, status
		FROM imports
		ORDER BY imported_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list imports: %w", err)
	}
	defer rows.Close()
	var out []model.ImportRecord
	for rows.Next() {
		var m model.ImportRecord
		if err := rows.Scan(&m.ID, &m.AccountID, &m.Filename, &m.ImportedAt, &m.TransactionCount, &m.Status); err != nil {
			return nil, fmt.Errorf("scan import: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
