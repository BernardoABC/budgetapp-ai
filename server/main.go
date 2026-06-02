package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"budgetapp/internal/config"
	"budgetapp/internal/database"
	"budgetapp/internal/database/migrations"
	"budgetapp/internal/handler"
	"budgetapp/internal/repository"
)

func main() {
	cfg := config.Load()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect to database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("connected to database")

	if err := migrations.Run(ctx, pool); err != nil {
		slog.Error("run migrations", "err", err)
		os.Exit(1)
	}

	// Repos
	accountRepo := repository.NewAccountRepo(pool)
	txnRepo := repository.NewTransactionRepo(pool)
	catRepo := repository.NewCategoryRepo(pool)

	// Handlers
	accounts := handler.NewAccountHandler(accountRepo)
	txns := handler.NewTransactionHandler(txnRepo)
	cats := handler.NewCategoryHandler(catRepo)

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Accounts
	mux.HandleFunc("GET /api/accounts", accounts.List)
	mux.HandleFunc("POST /api/accounts", accounts.Create)
	mux.HandleFunc("GET /api/accounts/{id}", accounts.Get)
	mux.HandleFunc("PUT /api/accounts/{id}", accounts.Update)
	mux.HandleFunc("DELETE /api/accounts/{id}", accounts.Delete)
	mux.HandleFunc("PATCH /api/accounts/{id}/close", accounts.ToggleClosed)

	// Transactions
	mux.HandleFunc("GET /api/accounts/{id}/transactions", txns.ListByAccount)
	mux.HandleFunc("POST /api/accounts/{id}/transactions", txns.Create)
	mux.HandleFunc("GET /api/transactions/{id}", txns.Get)
	mux.HandleFunc("PUT /api/transactions/{id}", txns.Update)
	mux.HandleFunc("DELETE /api/transactions/{id}", txns.Delete)

	// Categories
	mux.HandleFunc("GET /api/category-groups", cats.ListGroups)
	mux.HandleFunc("POST /api/category-groups", cats.CreateGroup)
	mux.HandleFunc("PUT /api/category-groups/{id}", cats.UpdateGroup)
	mux.HandleFunc("DELETE /api/category-groups/{id}", cats.DeleteGroup)
	mux.HandleFunc("POST /api/categories", cats.CreateCategory)
	mux.HandleFunc("PUT /api/categories/{id}", cats.UpdateCategory)
	mux.HandleFunc("DELETE /api/categories/{id}", cats.DeleteCategory)

	corsMiddleware := handler.CORS(cfg.CORSOrigin)
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler.Logger(corsMiddleware(mux)),
	}

	go func() {
		slog.Info("listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
}
