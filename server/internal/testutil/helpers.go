// server/internal/testutil/helpers.go
package testutil

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/budgetapp_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("no test DB available: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("no test DB available: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

// SeedGroup inserts a category group and returns its ID.
func SeedGroup(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO category_groups (name, sort_order) VALUES ($1, 0) RETURNING id::text`,
		fmt.Sprintf("TestGroup-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedGroup: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM category_groups WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedCategory inserts a category in a new group and returns the category ID.
func SeedCategory(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	groupID := SeedGroup(t, pool)
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid, $2, 0) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategory: %v", err)
	}
	return id
}

// SeedOnBudgetAccount inserts an on-budget account and returns its ID.
func SeedOnBudgetAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO accounts (name, type, currency, balance, on_budget) VALUES ($1, 'checking', 'CRC', 0, true) RETURNING id::text`,
		fmt.Sprintf("TestAcc-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedOnBudgetAccount: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM accounts WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedTransaction inserts a transaction with a category and returns its ID.
func SeedTransaction(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, category_id, date, amount, currency)
		 VALUES ($1::uuid, $2::uuid, $3::date, $4, 'CRC') RETURNING id::text`,
		accountID, categoryID, date, amount,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransaction: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedTransactionNoCategory inserts a transaction without a category.
func SeedTransactionNoCategory(t *testing.T, pool *pgxpool.Pool, accountID, date string, amount int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accountID, date, amount,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransactionNoCategory: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedTransactionFull inserts a transaction with payee, memo, and cleared set.
func SeedTransactionFull(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64, payee, memo string, cleared bool) string {
	t.Helper()
	var catParam interface{}
	if categoryID != "" {
		catParam = categoryID
	}
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO transactions (account_id, category_id, date, amount, currency, payee, memo, cleared)
		 VALUES ($1::uuid, $2::uuid, $3::date, $4, 'CRC', $5, NULLIF($6,''), $7) RETURNING id::text`,
		accountID, catParam, date, amount, payee, memo, cleared,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedTransactionFull: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedLinkedPair inserts two linked transfer transactions: accA gets -amount,
// accB gets +amount, both pointing at each other via transfer_peer_id.
// Returns (idA, idB).
func SeedLinkedPair(t *testing.T, pool *pgxpool.Pool, accA, accB, date string, amount int64) (string, string) {
	t.Helper()
	ctx := context.Background()
	var idA, idB string
	err := pool.QueryRow(ctx,
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accA, date, -amount,
	).Scan(&idA)
	if err != nil {
		t.Fatalf("SeedLinkedPair A: %v", err)
	}
	err = pool.QueryRow(ctx,
		`INSERT INTO transactions (account_id, date, amount, currency)
		 VALUES ($1::uuid, $2::date, $3, 'CRC') RETURNING id::text`,
		accB, date, amount,
	).Scan(&idB)
	if err != nil {
		t.Fatalf("SeedLinkedPair B: %v", err)
	}
	_, err = pool.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $2::uuid WHERE id = $1::uuid`,
		idA, idB,
	)
	if err != nil {
		t.Fatalf("SeedLinkedPair link A: %v", err)
	}
	_, err = pool.Exec(ctx,
		`UPDATE transactions SET transfer_peer_id = $2::uuid WHERE id = $1::uuid`,
		idB, idA,
	)
	if err != nil {
		t.Fatalf("SeedLinkedPair link B: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id IN ($1::uuid, $2::uuid)`, idA, idB)
	})
	return idA, idB
}

// SeedCategoryWithCurrency inserts a category with the given currency and returns its ID.
func SeedCategoryWithCurrency(t *testing.T, pool *pgxpool.Pool, currency string) string {
	t.Helper()
	groupID := SeedGroup(t, pool)
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order, currency)
		 VALUES ($1::uuid, $2, 0, $3) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()), currency,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategoryWithCurrency: %v", err)
	}
	return id
}

// SeedOnBudgetAccountWithCurrency inserts an on-budget account with the given currency and returns its ID.
func SeedOnBudgetAccountWithCurrency(t *testing.T, pool *pgxpool.Pool, currency string, balance int64) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO accounts (name, type, currency, balance, on_budget)
		 VALUES ($1, 'checking', $2, $3, true) RETURNING id::text`,
		fmt.Sprintf("TestAcc-%d", randomID()), currency, balance,
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedOnBudgetAccountWithCurrency: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM accounts WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedExchangeRate inserts an exchange rate for a date (upserts if exists).
func SeedExchangeRate(t *testing.T, pool *pgxpool.Pool, date string, usdToCRC float64) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		`INSERT INTO exchange_rates (date, usd_to_crc, source)
		 VALUES ($1::date, $2, 'test')
		 ON CONFLICT (date) DO UPDATE SET usd_to_crc = EXCLUDED.usd_to_crc`,
		date, usdToCRC,
	)
	if err != nil {
		t.Fatalf("SeedExchangeRate: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM exchange_rates WHERE date = $1::date`, date)
	})
}

// SeedTransactionWithCurrency inserts a transaction with the given currency and optional exchange rate.
func SeedTransactionWithCurrency(t *testing.T, pool *pgxpool.Pool, accountID, categoryID, date string, amount int64, currency string, exchangeRate *float64) string {
	t.Helper()
	var id string
	var err error
	if exchangeRate != nil {
		err = pool.QueryRow(context.Background(),
			`INSERT INTO transactions (account_id, category_id, date, amount, currency, exchange_rate)
			 VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6) RETURNING id::text`,
			accountID, categoryID, date, amount, currency, *exchangeRate,
		).Scan(&id)
	} else {
		err = pool.QueryRow(context.Background(),
			`INSERT INTO transactions (account_id, category_id, date, amount, currency)
			 VALUES ($1::uuid, $2::uuid, $3::date, $4, $5) RETURNING id::text`,
			accountID, categoryID, date, amount, currency,
		).Scan(&id)
	}
	if err != nil {
		t.Fatalf("SeedTransactionWithCurrency: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM transactions WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedIncomeGroup inserts a category group with is_income=true and returns its ID.
func SeedIncomeGroup(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO category_groups (name, sort_order, is_income) VALUES ($1, -1, true) RETURNING id::text`,
		fmt.Sprintf("TestIncomeGroup-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedIncomeGroup: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM category_groups WHERE id = $1::uuid`, id)
	})
	return id
}

// SeedCategoryInGroup inserts a category into the given group and returns the category ID.
func SeedCategoryInGroup(t *testing.T, pool *pgxpool.Pool, groupID string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO categories (group_id, name, sort_order) VALUES ($1::uuid, $2, 0) RETURNING id::text`,
		groupID, fmt.Sprintf("TestCat-%d", randomID()),
	).Scan(&id)
	if err != nil {
		t.Fatalf("SeedCategoryInGroup: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM categories WHERE id = $1::uuid`, id)
	})
	return id
}

// idCounter starts at wall-clock nanoseconds so concurrently running test
// binaries (go test ./... runs packages in parallel against the shared test DB)
// don't generate colliding TestGroup-N names.
var idCounter = time.Now().UnixNano()

func randomID() int64 {
	idCounter++
	return idCounter
}
