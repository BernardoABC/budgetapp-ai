package handler

import (
	"errors"
	"net/http"
	"strconv"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type TransactionHandler struct {
	repo *repository.TransactionRepo
}

func NewTransactionHandler(repo *repository.TransactionRepo) *TransactionHandler {
	return &TransactionHandler{repo: repo}
}

// toResponse maps a transaction to the API shape: a single signed amount in the
// account's native minor units, plus its currency. The frontend formats it.
func (h *TransactionHandler) toResponse(t model.Transaction) map[string]any {
	var category any = nil
	if t.CategoryName != "" {
		category = t.CategoryName
	}
	var categoryID any = nil
	if t.CategoryID != "" {
		categoryID = t.CategoryID
	}
	return map[string]any{
		"id":            t.ID,
		"account":       t.AccountID,
		"date":          t.Date,
		"payee":         t.Payee,
		"category":      category,
		"category_id":   categoryID,
		"memo":          t.Memo,
		"amount":        t.Amount,
		"currency":      t.Currency,
		"cleared":       t.Cleared,
		"exchange_rate": t.ExchangeRate,
	}
}

func (h *TransactionHandler) ListByAccount(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))

	txns, total, err := h.repo.ListByAccount(r.Context(), accountID, page, perPage)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	resp := make([]map[string]any, len(txns))
	for i, t := range txns {
		resp[i] = h.toResponse(t)
	}

	p := page
	if p < 1 {
		p = 1
	}
	pp := perPage
	if pp < 1 || pp > 500 {
		pp = 100
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"transactions": resp,
		"total":        total,
		"page":         p,
		"per_page":     pp,
	})
}

func (h *TransactionHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := h.repo.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h.toResponse(t))
}

func (h *TransactionHandler) Create(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")

	var req model.CreateTransactionReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.Date == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "date is required")
		return
	}

	t, err := h.repo.Create(r.Context(), accountID, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, h.toResponse(t))
}

func (h *TransactionHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req model.UpdateTransactionReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	t, err := h.repo.Update(r.Context(), id, req)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h.toResponse(t))
}

func (h *TransactionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
