// server/internal/testutil/helpers.go
package testutil

import (
	"context"
	"fmt"
	"os"
	"testing"

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

var idCounter int64

func randomID() int64 {
	idCounter++
	return idCounter
}
