// server/internal/handler/exchange_rates.go
package handler

import (
	"errors"
	"net/http"
	"time"

	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

type ExchangeRateHandler struct {
	svc *service.ExchangeRateService
}

func NewExchangeRateHandler(svc *service.ExchangeRateService) *ExchangeRateHandler {
	return &ExchangeRateHandler{svc: svc}
}

func (h *ExchangeRateHandler) Current(w http.ResponseWriter, r *http.Request) {
	er, err := h.svc.GetCurrent(r.Context())
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "No exchange rate available")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"date":       er.Date,
		"usd_to_crc": er.USDToCRC,
		"source":     er.Source,
	})
}

func (h *ExchangeRateHandler) ListByRange(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "query params 'from' and 'to' (YYYY-MM-DD) are required")
		return
	}
	if from > to {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "'from' must be on or before 'to'")
		return
	}
	rates, err := h.svc.ListByRange(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]map[string]any, len(rates))
	for i, er := range rates {
		resp[i] = map[string]any{
			"date":       er.Date,
			"usd_to_crc": er.USDToCRC,
			"source":     er.Source,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rates": resp})
}

func (h *ExchangeRateHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if date == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "date path param required")
		return
	}
	if _, err := time.Parse("2006-01-02", date); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "date must be YYYY-MM-DD")
		return
	}
	var body struct {
		USDToCRC float64 `json:"usd_to_crc"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.USDToCRC <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "usd_to_crc must be positive")
		return
	}
	if err := h.svc.Upsert(r.Context(), date, body.USDToCRC, "manual"); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"date":       date,
		"usd_to_crc": body.USDToCRC,
		"source":     "manual",
	})
}
