package migrations

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var sqlFiles embed.FS

func Run(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(sqlFiles, ".")
	if err != nil {
		return fmt.Errorf("read migration dir: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		var count int
		if err := pool.QueryRow(ctx,
			"SELECT COUNT(*) FROM schema_migrations WHERE filename = $1", e.Name(),
		).Scan(&count); err != nil {
			return fmt.Errorf("check migration %s: %w", e.Name(), err)
		}
		if count > 0 {
			continue
		}
		sql, err := sqlFiles.ReadFile(e.Name())
		if err != nil {
			return fmt.Errorf("read %s: %w", e.Name(), err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("apply %s: %w", e.Name(), err)
		}
		if _, err := pool.Exec(ctx,
			"INSERT INTO schema_migrations (filename) VALUES ($1)", e.Name(),
		); err != nil {
			return fmt.Errorf("record migration %s: %w", e.Name(), err)
		}
		slog.Info("migration applied", "file", e.Name())
	}
	return nil
}
