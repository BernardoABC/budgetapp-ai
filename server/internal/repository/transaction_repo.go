package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/model"
)

type TransactionRepo struct{ pool *pgxpool.Pool }

func NewTransactionRepo(pool *pgxpool.Pool) *TransactionRepo {
	return &TransactionRepo{pool: pool}
}

// TxnFilter holds the optional filters for listing an account's transactions.
type TxnFilter struct {
	Search     string // ILIKE across payee and memo
	FromDate   string // "YYYY-MM-DD" inclusive
	ToDate     string // "YYYY-MM-DD" inclusive
	CategoryID string // UUID, "none" (uncategorized), or "" (all)
	Cleared    *bool  // nil = all
	MinAmount  *int64 // centimos, compared against ABS(amount)
	MaxAmount  *int64 // centimos, compared against ABS(amount)
	FlowType   string // "inflow" (amount>0), "outflow" (amount<0), or "" (all)
	Transfers  string // "only" (has peer), "hide" (no peer), or "" (all)
	Sort        string // see sortClause; default date_desc
	Page        int    // 1-based, default 1
	PerPage     int    // default 50, max 200
	HighlightID string // UUID; when set, returns the page containing this transaction
}

// TxnSummary aggregates the full filtered set (not just one page), in centimos.
type TxnSummary struct {
	TotalInflow      int64 `json:"total_inflow"`
	TotalOutflow     int64 `json:"total_outflow"` // positive magnitude
	ClearedBalance   int64 `json:"cleared_balance"`
	UnclearedBalance int64 `json:"uncleared_balance"`
}

// whereClause builds the shared WHERE predicate. accountID is always $1; further
// args start at $2. Returns the SQL fragment (without the "WHERE" keyword) and the
// arg slice including accountID at index 0.
func (f TxnFilter) whereClause(accountID string) (string, []any) {
	conds := []string{"t.account_id = $1"}
	args := []any{accountID}
	add := func(cond string, val any) {
		args = append(args, val)
		conds = append(conds, strings.Replace(cond, "?", "$"+strconv.Itoa(len(args)), 1))
	}
	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		n := "$" + strconv.Itoa(len(args))
		conds = append(conds, "(t.payee ILIKE "+n+" OR t.memo ILIKE "+n+")")
	}
	if f.FromDate != "" {
		add("t.date >= ?::date", f.FromDate)
	}
	if f.ToDate != "" {
		add("t.date <= ?::date", f.ToDate)
	}
	if f.CategoryID == "none" {
		conds = append(conds, "t.category_id IS NULL")
	} else if f.CategoryID != "" {
		add("t.category_id = ?::uuid", f.CategoryID)
	}
	if f.Cleared != nil {
		add("t.cleared = ?", *f.Cleared)
	}
	if f.MinAmount != nil {
		add("ABS(t.amount) >= ?", *f.MinAmount)
	}
	if f.MaxAmount != nil {
		add("ABS(t.amount) <= ?", *f.MaxAmount)
	}
	switch f.FlowType {
	case "inflow":
		conds = append(conds, "t.amount > 0")
	case "outflow":
		conds = append(conds, "t.amount < 0")
	}
	switch f.Transfers {
	case "only":
		conds = append(conds, "t.transfer_peer_id IS NOT NULL")
	case "hide":
		conds = append(conds, "t.transfer_peer_id IS NULL")
	}
	return strings.Join(conds, " AND "), args
}

// sortClause whitelists ORDER BY expressions so no raw input reaches SQL.
func sortClause(sort string) string {
	switch sort {
	case "date_asc":
		return "t.date ASC, t.created_at ASC"
	case "amount_asc":
		return "t.amount ASC"
	case "amount_desc":
		return "t.amount DESC"
	case "payee_asc":
		return "t.payee ASC"
	case "payee_desc":
		return "t.payee DESC"
	case "category_asc":
		return "c.name ASC NULLS LAST"
	case "category_desc":
		return "c.name DESC NULLS LAST"
	case "memo_asc":
		return "t.memo ASC NULLS LAST"
	case "memo_desc":
		return "t.memo DESC NULLS LAST"
	case "cleared_asc":
		return "t.cleared ASC"
	case "cleared_desc":
		return "t.cleared DESC"
	default: // date_desc
		return "t.date DESC, t.created_at DESC"
	}
}

func (r *TransactionRepo) ListByAccount(ctx context.Context, accountID string, f TxnFilter) ([]model.Transaction, int64, TxnSummary, int, error) {
	page := f.Page
	if page < 1 {
		page = 1
	}
	perPage := f.PerPage
	if perPage < 1 || perPage > 200 {
		perPage = 50
	}
	offset := (page - 1) * perPage

	highlightPage := 0
	if f.HighlightID != "" {
		var pos int64
		err := r.pool.QueryRow(ctx, `
			WITH target AS (
				SELECT date, created_at
				FROM transactions
				WHERE id = $1::uuid AND account_id = $2::uuid
			)
			SELECT COUNT(*) + 1
			FROM transactions t, target
			WHERE t.account_id = $2::uuid
			  AND (t.date > target.date
			       OR (t.date = target.date AND t.created_at > target.created_at))
		`, f.HighlightID, accountID).Scan(&pos)
		if err == nil && pos > 0 {
			highlightPage = int((pos-1)/int64(perPage)) + 1
			offset = (highlightPage - 1) * perPage
		}
	}

	where, args := f.whereClause(accountID)
	var summary TxnSummary

	var total int64
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM transactions t WHERE `+where, args...,
	).Scan(&total); err != nil {
		return nil, 0, summary, 0, fmt.Errorf("count transactions: %w", err)
	}

	if err := r.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN t.cleared THEN t.amount ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN NOT t.cleared THEN t.amount ELSE 0 END), 0)
		FROM transactions t
		WHERE `+where, args...,
	).Scan(&summary.TotalInflow, &summary.TotalOutflow, &summary.ClearedBalance, &summary.UnclearedBalance); err != nil {
		return nil, 0, summary, 0, fmt.Errorf("summary transactions: %w", err)
	}

	pageArgs := append(append([]any{}, args...), perPage, offset)
	limPlace := "$" + strconv.Itoa(len(pageArgs)-1)
	offPlace := "$" + strconv.Itoa(len(pageArgs))
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(t.transfer_peer_id::text,''),
		       COALESCE(peer.account_id::text,''),
		       COALESCE(
		         json_agg(
		           json_build_object('category', c2.name, 'amount', s.amount)
		           ORDER BY s.created_at
		         ) FILTER (WHERE s.id IS NOT NULL),
		         '[]'::json
		       ) AS splits
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		LEFT JOIN transaction_splits s ON s.transaction_id = t.id
		LEFT JOIN categories c2 ON c2.id = s.category_id
		LEFT JOIN transactions peer ON peer.id = t.transfer_peer_id
		WHERE `+where+`
		GROUP BY t.id, c.name, peer.account_id
		ORDER BY `+sortClause(f.Sort)+`
		LIMIT `+limPlace+` OFFSET `+offPlace, pageArgs...)
	if err != nil {
		return nil, 0, summary, 0, fmt.Errorf("list transactions: %w", err)
	}
	defer rows.Close()

	var txns []model.Transaction
	for rows.Next() {
		var t model.Transaction
		var splitsJSON []byte
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &t.TransferPeerAccountID,
			&splitsJSON); err != nil {
			return nil, 0, summary, 0, fmt.Errorf("scan transaction: %w", err)
		}
		if len(splitsJSON) > 0 {
			if err := json.Unmarshal(splitsJSON, &t.Splits); err != nil {
				return nil, 0, summary, 0, fmt.Errorf("unmarshal splits: %w", err)
			}
		}
		txns = append(txns, t)
	}
	return txns, total, summary, highlightPage, rows.Err()
}

func (r *TransactionRepo) Get(ctx context.Context, id string) (model.Transaction, error) {
	var t model.Transaction
	var splitsJSON []byte
	err := r.pool.QueryRow(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(t.transfer_peer_id::text,''),
		       COALESCE(peer.account_id::text,''),
		       COALESCE(
		         json_agg(
		           json_build_object('category', c2.name, 'amount', s.amount)
		           ORDER BY s.created_at
		         ) FILTER (WHERE s.id IS NOT NULL),
		         '[]'::json
		       ) AS splits
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		LEFT JOIN transaction_splits s ON s.transaction_id = t.id
		LEFT JOIN categories c2 ON c2.id = s.category_id
		LEFT JOIN transactions peer ON peer.id = t.transfer_peer_id
		WHERE t.id = $1
		GROUP BY t.id, c.name, peer.account_id
	`, id).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
		&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID, &t.TransferPeerAccountID,
		&splitsJSON)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return t, ErrNotFound
		}
		return t, fmt.Errorf("get transaction %s: %w", id, err)
	}
	if len(splitsJSON) > 0 {
		if err := json.Unmarshal(splitsJSON, &t.Splits); err != nil {
			return t, fmt.Errorf("unmarshal splits: %w", err)
		}
	}
	return t, nil
}

// Create inserts the transaction and updates the account balance atomically.
// req.Amount is already in the account's native minor units.
func (r *TransactionRepo) Create(ctx context.Context, accountID string, req model.CreateTransactionReq) (model.Transaction, error) {
	amount := req.Amount

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
	`, accountID, catIDParam, req.Date, amount, req.Payee, req.Memo, req.Cleared,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared)
	if err != nil {
		return t, fmt.Errorf("insert transaction: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
		amount, accountID,
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
// If the transaction is a transfer leg, it mirrors the amount change (sign-flipped) to the peer.
func (r *TransactionRepo) Update(ctx context.Context, id string, req model.UpdateTransactionReq) (model.Transaction, error) {
	newAmount := req.Amount

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return model.Transaction{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var oldAmount int64
	var accountID string
	var peerID *string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, id,
	).Scan(&oldAmount, &accountID, &peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.Transaction{}, ErrNotFound
		}
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
		WHERE id=$7::uuid
		RETURNING id::text, account_id::text,
		          COALESCE(category_id::text,''), '',
		          date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled,
		          COALESCE(transfer_peer_id::text,'')
	`, catIDParam, req.Date, newAmount, req.Payee, req.Memo, req.Cleared, id,
	).Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
		&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared, &t.Reconciled, &t.TransferPeerID)
	if err != nil {
		return t, fmt.Errorf("update transaction: %w", err)
	}

	diff := newAmount - oldAmount
	if diff != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
			diff, accountID,
		); err != nil {
			return t, fmt.Errorf("update balance: %w", err)
		}
	}

	if t.CategoryID != "" {
		tx.QueryRow(ctx, `SELECT name FROM categories WHERE id = $1::uuid`, t.CategoryID).Scan(&t.CategoryName) //nolint:errcheck
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM transaction_splits WHERE transaction_id = $1::uuid`, id,
	); err != nil {
		return t, fmt.Errorf("delete splits: %w", err)
	}
	for _, s := range req.Splits {
		var catParam interface{}
		if s.CategoryID != "" {
			catParam = s.CategoryID
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES ($1::uuid, $2, $3)`,
			id, catParam, s.Amount,
		); err != nil {
			return t, fmt.Errorf("insert split: %w", err)
		}
	}

	// Mirror amount and date to the peer leg (sign-flipped) when amount changed.
	if peerID != nil && *peerID != "" && diff != 0 {
		var peerOldAmount int64
		var peerAccountID string
		if err := tx.QueryRow(ctx,
			`SELECT amount, account_id::text FROM transactions WHERE id = $1::uuid`, *peerID,
		).Scan(&peerOldAmount, &peerAccountID); err == nil {
			peerNewAmount := -newAmount
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET amount = $1, date = $2, updated_at = NOW() WHERE id = $3::uuid`,
				peerNewAmount, req.Date, *peerID,
			); err != nil {
				return t, fmt.Errorf("update peer leg: %w", err)
			}
			peerDiff := peerNewAmount - peerOldAmount
			if peerDiff != 0 {
				if _, err := tx.Exec(ctx,
					`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
					peerDiff, peerAccountID,
				); err != nil {
					return t, fmt.Errorf("update peer balance: %w", err)
				}
			}
		}
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
	var peerID *string
	if err := tx.QueryRow(ctx,
		`SELECT amount, account_id::text, transfer_peer_id::text FROM transactions WHERE id = $1::uuid`, id,
	).Scan(&amount, &accountID, &peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get transaction for delete: %w", err)
	}

	if peerID != nil && *peerID != "" {
		var peerAmount int64
		var peerAccountID string
		if err := tx.QueryRow(ctx,
			`SELECT amount, account_id::text FROM transactions WHERE id = $1::uuid`, *peerID,
		).Scan(&peerAmount, &peerAccountID); err == nil {
			if _, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = $1::uuid`, *peerID); err != nil {
				return fmt.Errorf("delete peer leg: %w", err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
				peerAmount, peerAccountID); err != nil {
				return fmt.Errorf("reverse peer balance: %w", err)
			}
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = $1::uuid`, id); err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
		amount, accountID,
	); err != nil {
		return fmt.Errorf("reverse balance: %w", err)
	}

	return tx.Commit(ctx)
}

// BatchUpdate applies an action to many transactions in one DB transaction.
// action: "categorize" (categoryID="" uncategorizes), "clear", "unclear", "delete".
// Returns the number of affected rows.
func (r *TransactionRepo) BatchUpdate(ctx context.Context, ids []string, action, categoryID string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var affected int64
	switch action {
	case "categorize":
		tag, err := tx.Exec(ctx,
			`UPDATE transactions SET category_id = NULLIF($1,'')::uuid, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
			categoryID, ids)
		if err != nil {
			return 0, fmt.Errorf("batch categorize: %w", err)
		}
		affected = tag.RowsAffected()
	case "clear", "unclear":
		tag, err := tx.Exec(ctx,
			`UPDATE transactions SET cleared = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
			action == "clear", ids)
		if err != nil {
			return 0, fmt.Errorf("batch clear: %w", err)
		}
		affected = tag.RowsAffected()
	case "delete":
		rows, err := tx.Query(ctx,
			`SELECT account_id::text, COALESCE(SUM(amount),0)::bigint
			 FROM transactions WHERE id = ANY($1::uuid[]) GROUP BY account_id`, ids)
		if err != nil {
			return 0, fmt.Errorf("batch delete sums: %w", err)
		}
		type acctSum struct {
			id  string
			sum int64
		}
		var sums []acctSum
		for rows.Next() {
			var a acctSum
			if err := rows.Scan(&a.id, &a.sum); err != nil {
				rows.Close()
				return 0, fmt.Errorf("scan delete sum: %w", err)
			}
			sums = append(sums, a)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return 0, fmt.Errorf("batch delete rows: %w", err)
		}
		tag, err := tx.Exec(ctx, `DELETE FROM transactions WHERE id = ANY($1::uuid[])`, ids)
		if err != nil {
			return 0, fmt.Errorf("batch delete: %w", err)
		}
		affected = tag.RowsAffected()
		for _, a := range sums {
			if _, err := tx.Exec(ctx,
				`UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid`,
				a.sum, a.id); err != nil {
				return 0, fmt.Errorf("reverse balance: %w", err)
			}
		}
	default:
		return 0, fmt.Errorf("unknown batch action: %s", action)
	}

	return affected, tx.Commit(ctx)
}

// Reconcile marks all cleared transactions in an account as reconciled.
// If adjustment != 0, it first inserts a "Reconciliation Adjustment" transaction
// (cleared + reconciled) and adjusts the account balance.
// Returns the number of transactions marked reconciled.
func (r *TransactionRepo) Reconcile(ctx context.Context, accountID string, adjustment int64) (int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if adjustment != 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO transactions (account_id, date, amount, currency, payee, cleared, reconciled)
			VALUES ($1, NOW()::date, $2, (SELECT currency FROM accounts WHERE id=$1::uuid), 'Reconciliation Adjustment', true, true)
		`, accountID, adjustment); err != nil {
			return 0, fmt.Errorf("insert adjustment: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
			adjustment, accountID,
		); err != nil {
			return 0, fmt.Errorf("update balance: %w", err)
		}
	}

	tag, err := tx.Exec(ctx,
		`UPDATE transactions SET reconciled = true WHERE account_id = $1::uuid AND cleared = true`,
		accountID,
	)
	if err != nil {
		return 0, fmt.Errorf("reconcile transactions: %w", err)
	}

	return tag.RowsAffected(), tx.Commit(ctx)
}

// SpendingByGroupRow is one (month, group) spend total in centimos (outflows only).
type SpendingByGroupRow struct {
	Month     string
	GroupName string
	Total     int64
}

// SpendingByGroup returns outflow totals grouped by category group and calendar
// month for the given inclusive YYYY-MM range. Transactions with no category are
// excluded.
func (r *TransactionRepo) SpendingByGroup(ctx context.Context, from, to string) ([]SpendingByGroupRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			to_char(date_trunc('month', t.date::date), 'YYYY-MM') AS month,
			cg.name AS group_name,
			SUM(ABS(t.amount))::bigint AS total
		FROM transactions t
		JOIN categories c  ON c.id = t.category_id
		JOIN category_groups cg ON cg.id = c.group_id
		WHERE t.amount < 0
		  AND t.date >= ($1 || '-01')::date
		  AND t.date <  (($2 || '-01')::date + INTERVAL '1 month')
		GROUP BY date_trunc('month', t.date::date), cg.name
		ORDER BY date_trunc('month', t.date::date), cg.name
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("spending by group: %w", err)
	}
	defer rows.Close()
	var out []SpendingByGroupRow
	for rows.Next() {
		var row SpendingByGroupRow
		if err := rows.Scan(&row.Month, &row.GroupName, &row.Total); err != nil {
			return nil, fmt.Errorf("scan spending row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// IncomeExpenseRow is one month's income and expense totals in centimos.
type IncomeExpenseRow struct {
	Month   string
	Income  int64
	Expense int64
}

// IncomeExpenseByMonth returns monthly income and expense totals for the
// inclusive YYYY-MM range. Only months with transactions appear.
func (r *TransactionRepo) IncomeExpenseByMonth(ctx context.Context, from, to string) ([]IncomeExpenseRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			to_char(date_trunc('month', t.date::date), 'YYYY-MM') AS month,
			COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::bigint AS income,
			COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.amount < 0), 0)::bigint AS expense
		FROM transactions t
		WHERE t.date >= ($1 || '-01')::date
		  AND t.date <  (($2 || '-01')::date + INTERVAL '1 month')
		GROUP BY date_trunc('month', t.date::date)
		ORDER BY date_trunc('month', t.date::date)
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("income expense by month: %w", err)
	}
	defer rows.Close()
	var out []IncomeExpenseRow
	for rows.Next() {
		var row IncomeExpenseRow
		if err := rows.Scan(&row.Month, &row.Income, &row.Expense); err != nil {
			return nil, fmt.Errorf("scan income expense row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// NetWorthRow is the running net worth (sum of all transaction amounts) at end of a month.
type NetWorthRow struct {
	Month    string
	NetWorth int64
}

// NetWorthByMonth returns the cumulative net worth at the end of each month in
// the inclusive YYYY-MM range. Every month in range appears (via generate_series).
func (r *TransactionRepo) NetWorthByMonth(ctx context.Context, from, to string) ([]NetWorthRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT to_char(m, 'YYYY-MM') AS month,
		       COALESCE((
		         SELECT SUM(t.amount)
		         FROM transactions t
		         WHERE t.date < (m + INTERVAL '1 month')
		       ), 0)::bigint AS net_worth
		FROM generate_series(
		       ($1 || '-01')::date,
		       ($2 || '-01')::date,
		       INTERVAL '1 month'
		     ) AS m
		ORDER BY m
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("net worth by month: %w", err)
	}
	defer rows.Close()
	var out []NetWorthRow
	for rows.Next() {
		var row NetWorthRow
		if err := rows.Scan(&row.Month, &row.NetWorth); err != nil {
			return nil, fmt.Errorf("scan net worth row: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// CreateTransfer atomically inserts two linked transaction rows — one outflow
// from fromAccountID and one inflow to toAccountID — and updates both balances.
// Returns the outflow (from) leg first, then the inflow (to) leg.
func (r *TransactionRepo) CreateTransfer(ctx context.Context, req model.CreateTransferReq) (from, to model.Transaction, err error) {
	if req.Amount <= 0 {
		return from, to, fmt.Errorf("transfer amount must be positive")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return from, to, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var fromName, toName string
	if err := tx.QueryRow(ctx, `SELECT name FROM accounts WHERE id = $1::uuid`, req.FromAccountID).Scan(&fromName); err != nil {
		return from, to, fmt.Errorf("get from-account: %w", err)
	}
	if err := tx.QueryRow(ctx, `SELECT name FROM accounts WHERE id = $1::uuid`, req.ToAccountID).Scan(&toName); err != nil {
		return from, to, fmt.Errorf("get to-account: %w", err)
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (account_id, date, amount, currency, payee, memo, cleared)
		VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, NULLIF($5,''), true)
		RETURNING id::text, account_id::text, '', '', date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled
	`, req.FromAccountID, req.Date, -req.Amount, "Transfer : "+toName, req.Memo,
	).Scan(&from.ID, &from.AccountID, &from.CategoryID, &from.CategoryName,
		&from.Date, &from.Amount, &from.Currency, &from.Payee, &from.Memo, &from.Cleared, &from.Reconciled); err != nil {
		return from, to, fmt.Errorf("insert from leg: %w", err)
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (account_id, date, amount, currency, payee, memo, cleared)
		VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, NULLIF($5,''), true)
		RETURNING id::text, account_id::text, '', '', date::text, amount, currency,
		          COALESCE(payee,''), COALESCE(memo,''), cleared, reconciled
	`, req.ToAccountID, req.Date, req.Amount, "Transfer : "+fromName, req.Memo,
	).Scan(&to.ID, &to.AccountID, &to.CategoryID, &to.CategoryName,
		&to.Date, &to.Amount, &to.Currency, &to.Payee, &to.Memo, &to.Cleared, &to.Reconciled); err != nil {
		return from, to, fmt.Errorf("insert to leg: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid WHERE id = $2::uuid`,
		to.ID, from.ID); err != nil {
		return from, to, fmt.Errorf("link from leg: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid WHERE id = $2::uuid`,
		from.ID, to.ID); err != nil {
		return from, to, fmt.Errorf("link to leg: %w", err)
	}
	from.TransferPeerID = to.ID
	to.TransferPeerID = from.ID

	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
		-req.Amount, req.FromAccountID); err != nil {
		return from, to, fmt.Errorf("update from balance: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
		req.Amount, req.ToAccountID); err != nil {
		return from, to, fmt.Errorf("update to balance: %w", err)
	}

	return from, to, tx.Commit(ctx)
}

// TransferCandidates returns unlinked transactions in accountID whose amount equals
// -amount (the sign-opposite of the given amount), ordered newest first.
// Used to populate the candidate picker when linking a transfer.
func (r *TransactionRepo) TransferCandidates(ctx context.Context, accountID string, amount int64) ([]model.Transaction, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.account_id::text,
		       COALESCE(t.category_id::text,''), COALESCE(c.name,''),
		       t.date::text, t.amount, t.currency,
		       COALESCE(t.payee,''), COALESCE(t.memo,''), t.cleared,
		       t.exchange_rate, t.reconciled,
		       COALESCE(t.transfer_peer_id::text,'')
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.account_id = $1::uuid
		  AND t.amount = $2
		  AND t.transfer_peer_id IS NULL
		ORDER BY t.date DESC, t.created_at DESC
		LIMIT 50
	`, accountID, -amount)
	if err != nil {
		return nil, fmt.Errorf("transfer candidates: %w", err)
	}
	defer rows.Close()
	var txns []model.Transaction
	for rows.Next() {
		var t model.Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.CategoryID, &t.CategoryName,
			&t.Date, &t.Amount, &t.Currency, &t.Payee, &t.Memo, &t.Cleared,
			&t.ExchangeRate, &t.Reconciled, &t.TransferPeerID); err != nil {
			return nil, fmt.Errorf("scan candidate: %w", err)
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}

// LinkTransfer atomically sets transfer_peer_id on two existing transactions,
// making them a linked transfer pair. Returns an error if either is already linked,
// both belong to the same account, or their amounts don't sum to zero.
func (r *TransactionRepo) LinkTransfer(ctx context.Context, idA, idB string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	type row struct {
		accountID  string
		accountCur string
		amount     int64
		peerID     *string
	}
	var a, b row

	if err := tx.QueryRow(ctx,
		`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
		 FROM transactions t JOIN accounts a ON a.id = t.account_id
		 WHERE t.id = $1::uuid`, idA,
	).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get txn A: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
		 FROM transactions t JOIN accounts a ON a.id = t.account_id
		 WHERE t.id = $1::uuid`, idB,
	).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("get txn B: %w", err)
	}

	if a.peerID != nil {
		return fmt.Errorf("transaction %s is already linked to a transfer", idA)
	}
	if b.peerID != nil {
		return fmt.Errorf("transaction %s is already linked to a transfer", idB)
	}
	if a.accountID == b.accountID {
		return fmt.Errorf("both transactions belong to the same account")
	}
	if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
		return fmt.Errorf("amounts do not sum to zero (%d + %d = %d)", a.amount, b.amount, a.amount+b.amount)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
		idB, idA); err != nil {
		return fmt.Errorf("link A: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
		idA, idB); err != nil {
		return fmt.Errorf("link B: %w", err)
	}
	return tx.Commit(ctx)
}

// LinkTransferBatch atomically links multiple transaction pairs as transfers.
// All pairs are validated and linked in a single DB transaction — any failure
// rolls back the entire batch.
func (r *TransactionRepo) LinkTransferBatch(ctx context.Context, pairs [][2]string) (int, error) {
	if len(pairs) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, pair := range pairs {
		idA, idB := pair[0], pair[1]

		type row struct {
			accountID  string
			accountCur string
			amount     int64
			peerID     *string
		}
		var a, b row

		if err := tx.QueryRow(ctx,
			`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
			 FROM transactions t JOIN accounts a ON a.id = t.account_id
			 WHERE t.id = $1::uuid`, idA,
		).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrNotFound
			}
			return 0, fmt.Errorf("get txn A %s: %w", idA, err)
		}
		if err := tx.QueryRow(ctx,
			`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
			 FROM transactions t JOIN accounts a ON a.id = t.account_id
			 WHERE t.id = $1::uuid`, idB,
		).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrNotFound
			}
			return 0, fmt.Errorf("get txn B %s: %w", idB, err)
		}

		if a.peerID != nil {
			return 0, fmt.Errorf("transaction %s is already linked", idA)
		}
		if b.peerID != nil {
			return 0, fmt.Errorf("transaction %s is already linked", idB)
		}
		if a.accountID == b.accountID {
			return 0, fmt.Errorf("transactions %s and %s belong to the same account", idA, idB)
		}
		if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
			return 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", idA, idB)
		}

		if _, err := tx.Exec(ctx,
			`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
			idB, idA); err != nil {
			return 0, fmt.Errorf("link A %s: %w", idA, err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
			idA, idB); err != nil {
			return 0, fmt.Errorf("link B %s: %w", idB, err)
		}
	}

	return len(pairs), tx.Commit(ctx)
}

// LinkOrCreateBatch atomically processes a batch of link-or-create pairs in one
// DB transaction. Pairs with TargetID set link two existing transactions (same
// validation as LinkTransferBatch). Pairs with TargetAccountID set find an
// existing unlinked transaction matching all fields (idempotency), or create one,
// then link both directions. Returns (linked, created, error).
func (r *TransactionRepo) LinkOrCreateBatch(ctx context.Context, pairs []model.LinkOrCreatePair) (linked, created int, err error) {
	if len(pairs) == 0 {
		return 0, 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, pair := range pairs {
		if pair.TargetID != "" {
			// ── Link existing pair ──────────────────────────────────────────
			type row struct {
				accountID  string
				accountCur string
				amount     int64
				peerID     *string
			}
			var a, b row
			if err := tx.QueryRow(ctx,
				`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
				 FROM transactions t JOIN accounts a ON a.id = t.account_id
				 WHERE t.id = $1::uuid`, pair.SourceID,
			).Scan(&a.accountID, &a.accountCur, &a.amount, &a.peerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get source %s: %w", pair.SourceID, err)
			}
			if err := tx.QueryRow(ctx,
				`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
				 FROM transactions t JOIN accounts a ON a.id = t.account_id
				 WHERE t.id = $1::uuid`, pair.TargetID,
			).Scan(&b.accountID, &b.accountCur, &b.amount, &b.peerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get target %s: %w", pair.TargetID, err)
			}
			if a.peerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.SourceID)
			}
			if b.peerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.TargetID)
			}
			if a.accountID == b.accountID {
				return 0, 0, fmt.Errorf("transactions %s and %s belong to the same account", pair.SourceID, pair.TargetID)
			}
			if a.accountCur == b.accountCur && a.amount+b.amount != 0 {
				return 0, 0, fmt.Errorf("amounts do not sum to zero for pair (%s, %s)", pair.SourceID, pair.TargetID)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
				pair.TargetID, pair.SourceID); err != nil {
				return 0, 0, fmt.Errorf("link source %s: %w", pair.SourceID, err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
				pair.SourceID, pair.TargetID); err != nil {
				return 0, 0, fmt.Errorf("link target %s: %w", pair.TargetID, err)
			}
			linked++

		} else {
			// ── Create-and-link ─────────────────────────────────────────────
			if pair.TargetAccountID == "" {
				return 0, 0, fmt.Errorf("pair for source %s: must set either TargetID or TargetAccountID", pair.SourceID)
			}
			// Validate source exists and amounts sum to zero.
			var sourceAmount int64
			var sourcePeerID *string
			var sourceAccountID string
			var sourceAccountCur string
			if err := tx.QueryRow(ctx,
				`SELECT t.account_id::text, a.currency, t.amount, t.transfer_peer_id::text
				 FROM transactions t JOIN accounts a ON a.id = t.account_id
				 WHERE t.id = $1::uuid`, pair.SourceID,
			).Scan(&sourceAccountID, &sourceAccountCur, &sourceAmount, &sourcePeerID); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, 0, ErrNotFound
				}
				return 0, 0, fmt.Errorf("get source %s: %w", pair.SourceID, err)
			}
			if sourcePeerID != nil {
				return 0, 0, fmt.Errorf("transaction %s is already linked", pair.SourceID)
			}
			if sourceAccountID == pair.TargetAccountID {
				return 0, 0, fmt.Errorf("transaction %s and target account are the same account", pair.SourceID)
			}
			var targetAccountCur string
			if err := tx.QueryRow(ctx,
				`SELECT currency FROM accounts WHERE id = $1::uuid`, pair.TargetAccountID,
			).Scan(&targetAccountCur); err != nil {
				return 0, 0, fmt.Errorf("get target account currency: %w", err)
			}
			if sourceAccountCur == targetAccountCur && sourceAmount+pair.TargetAmount != 0 {
				return 0, 0, fmt.Errorf("source amount %d and target amount %d do not sum to zero", sourceAmount, pair.TargetAmount)
			}

			// Idempotency: find existing unlinked transaction matching all create fields.
			var targetID string
			idempotErr := tx.QueryRow(ctx,
				`SELECT id::text FROM transactions
				 WHERE account_id = $1::uuid AND date = $2::date AND amount = $3
				   AND payee = $4 AND transfer_peer_id IS NULL
				 LIMIT 1`,
				pair.TargetAccountID, pair.TargetDate, pair.TargetAmount, pair.TargetPayee,
			).Scan(&targetID)

			if errors.Is(idempotErr, pgx.ErrNoRows) {
				// Create new peer transaction.
				if err := tx.QueryRow(ctx,
					`INSERT INTO transactions (account_id, date, amount, currency, payee, cleared)
					 VALUES ($1::uuid, $2::date, $3, (SELECT currency FROM accounts WHERE id=$1::uuid), $4, true)
					 RETURNING id::text`,
					pair.TargetAccountID, pair.TargetDate, pair.TargetAmount, pair.TargetPayee,
				).Scan(&targetID); err != nil {
					return 0, 0, fmt.Errorf("insert peer transaction: %w", err)
				}
				if _, err := tx.Exec(ctx,
					`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid`,
					pair.TargetAmount, pair.TargetAccountID,
				); err != nil {
					return 0, 0, fmt.Errorf("update target balance: %w", err)
				}
				created++
			} else if idempotErr != nil {
				return 0, 0, fmt.Errorf("idempotency check: %w", idempotErr)
			} else {
				// Found existing — link it.
				linked++
			}

			// Link both directions.
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
				targetID, pair.SourceID); err != nil {
				return 0, 0, fmt.Errorf("link source %s: %w", pair.SourceID, err)
			}
			if _, err := tx.Exec(ctx,
				`UPDATE transactions SET transfer_peer_id = $1::uuid, cleared = true, updated_at = NOW() WHERE id = $2::uuid`,
				pair.SourceID, targetID); err != nil {
				return 0, 0, fmt.Errorf("link target %s: %w", targetID, err)
			}
		}
	}

	return linked, created, tx.Commit(ctx)
}
