// server/internal/service/exchange_rate_service.go
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"budgetapp/internal/bccr"
	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type ExchangeRateService struct {
	repo   *repository.ExchangeRateRepo
	client *bccr.Client
}

func NewExchangeRateService(repo *repository.ExchangeRateRepo, client *bccr.Client) *ExchangeRateService {
	return &ExchangeRateService{repo: repo, client: client}
}

// EnsureRates checks the DB for each date, fetches missing ones from BCCR
// (one range call), and returns a map of {date → usd_to_crc} for all dates.
// For dates where no rate can be obtained, the nearest available is used.
func (s *ExchangeRateService) EnsureRates(ctx context.Context, dates []string) (map[string]float64, error) {
	if len(dates) == 0 {
		return map[string]float64{}, nil
	}
	dates = uniqueStrings(dates)

	existing, err := s.repo.ExistingDates(ctx, dates)
	if err != nil {
		return nil, err
	}

	var missing []string
	for _, d := range dates {
		if !existing[d] {
			missing = append(missing, d)
		}
	}

	if len(missing) > 0 {
		min, max := minMaxStrings(missing)
		fetched, fetchErr := s.client.FetchRates(ctx, min, max)
		if fetchErr != nil {
			slog.Warn("BCCR fetch failed during import", "err", fetchErr)
			// Try open.er-api.com for today's date if it's among missing
			today := time.Now().Format("2006-01-02")
			for _, d := range missing {
				if d == today {
					if rate, ferr := fetchOpenERRate(ctx); ferr == nil {
						if err := s.repo.Upsert(ctx, d, rate, "open_er_api"); err != nil {
							slog.Warn("upsert fallback rate", "err", err)
						}
					}
				}
			}
		} else {
			for date, rate := range fetched {
				if err := s.repo.Upsert(ctx, date, rate, "BCCR"); err != nil {
					slog.Warn("upsert BCCR rate", "date", date, "err", err)
				}
			}
		}
	}

	result := make(map[string]float64, len(dates))
	for _, d := range dates {
		er, err := s.repo.GetNearest(ctx, d)
		if err != nil {
			slog.Warn("no rate available for date", "date", d)
			continue
		}
		result[d] = er.USDToCRC
	}
	return result, nil
}

// FetchAndStoreToday fetches today's rate if not already in the DB.
// Tries BCCR first, falls back to open.er-api.com.
func (s *ExchangeRateService) FetchAndStoreToday(ctx context.Context) error {
	today := time.Now().Format("2006-01-02")
	existing, err := s.repo.ExistingDates(ctx, []string{today})
	if err != nil {
		return err
	}
	if existing[today] {
		slog.Info("exchange rate already up to date", "date", today)
		return nil
	}

	fetched, err := s.client.FetchRates(ctx, today, today)
	if err != nil {
		slog.Warn("BCCR fetch failed, trying fallback", "err", err)
		rate, ferr := fetchOpenERRate(ctx)
		if ferr != nil {
			return fmt.Errorf("all rate sources failed: bccr=%w; fallback=%v", err, ferr)
		}
		return s.repo.Upsert(ctx, today, rate, "open_er_api")
	}

	for date, rate := range fetched {
		if err := s.repo.Upsert(ctx, date, rate, "BCCR"); err != nil {
			return err
		}
	}
	slog.Info("exchange rate stored", "date", today)
	return nil
}

// GetCurrent returns the most recent rate on or before today.
func (s *ExchangeRateService) GetCurrent(ctx context.Context) (*model.ExchangeRate, error) {
	today := time.Now().Format("2006-01-02")
	return s.repo.GetNearest(ctx, today)
}

// ListByRange returns rates for the given date range (YYYY-MM-DD).
func (s *ExchangeRateService) ListByRange(ctx context.Context, from, to string) ([]model.ExchangeRate, error) {
	return s.repo.ListByRange(ctx, from, to)
}

// Upsert allows a manual rate override (used by the PUT endpoint).
func (s *ExchangeRateService) Upsert(ctx context.Context, date string, rate float64, source string) error {
	return s.repo.Upsert(ctx, date, rate, source)
}

// fetchOpenERRate calls open.er-api.com (no key required) for the current USD→CRC rate.
func fetchOpenERRate(ctx context.Context) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://open.er-api.com/v6/latest/USD", nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("open.er-api request: %w", err)
	}
	defer resp.Body.Close()
	var body struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, fmt.Errorf("open.er-api decode: %w", err)
	}
	rate, ok := body.Rates["CRC"]
	if !ok || rate == 0 {
		return 0, fmt.Errorf("open.er-api: CRC rate missing")
	}
	return rate, nil
}

func uniqueStrings(ss []string) []string {
	seen := make(map[string]bool, len(ss))
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func minMaxStrings(ss []string) (min, max string) {
	min, max = ss[0], ss[0]
	for _, s := range ss[1:] {
		if s < min {
			min = s
		}
		if s > max {
			max = s
		}
	}
	return
}
