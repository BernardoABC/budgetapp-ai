package service_test

import (
	"context"
	"testing"

	"budgetapp/internal/bccr"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
	"budgetapp/internal/testutil"
)

func TestExchangeRateService_GetNearest_Found(t *testing.T) {
	pool := testutil.NewTestPool(t)
	rateRepo := repository.NewExchangeRateRepo(pool)
	client := bccr.NewClient("")
	svc := service.NewExchangeRateService(rateRepo, client)

	ctx := context.Background()

	// Seed a rate on 2000-06-01
	if err := rateRepo.Upsert(ctx, "2000-06-01", 520.0, "test"); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	// Query for a later date — should return the nearest (2000-06-01)
	er, err := svc.GetNearest(ctx, "2000-06-05")
	if err != nil {
		t.Fatalf("GetNearest returned error: %v", err)
	}
	if er.USDToCRC != 520.0 {
		t.Errorf("expected USDToCRC=520.0, got %f", er.USDToCRC)
	}
}

func TestExchangeRateService_GetNearest_NotFound(t *testing.T) {
	pool := testutil.NewTestPool(t)
	rateRepo := repository.NewExchangeRateRepo(pool)
	client := bccr.NewClient("")
	svc := service.NewExchangeRateService(rateRepo, client)

	ctx := context.Background()

	// No rates seeded — querying should return an error
	_, err := svc.GetNearest(ctx, "2000-01-01")
	if err == nil {
		t.Fatal("expected error for missing rate, got nil")
	}
}
