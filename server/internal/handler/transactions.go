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

func parseAmountParam(s string) *int64 {
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func (h *TransactionHandler) ListByAccount(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	perPage, _ := strconv.Atoi(q.Get("per_page"))

	f := repository.TxnFilter{
		Search:     q.Get("search"),
		FromDate:   q.Get("from_date"),
		ToDate:     q.Get("to_date"),
		CategoryID: q.Get("category_id"),
		Sort:       q.Get("sort"),
		Page:       page,
		PerPage:    perPage,
		MinAmount:  parseAmountParam(q.Get("min_amount")),
		MaxAmount:  parseAmountParam(q.Get("max_amount")),
	}
	if c := q.Get("cleared"); c == "true" {
		v := true
		f.Cleared = &v
	} else if c == "false" {
		v := false
		f.Cleared = &v
	}

	txns, total, summary, err := h.repo.ListByAccount(r.Context(), accountID, f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	resp := make([]map[string]any, len(txns))
	for i, t := range txns {
		resp[i] = h.toResponse(t)
	}

	p := f.Page
	if p < 1 {
		p = 1
	}
	pp := f.PerPage
	if pp < 1 || pp > 200 {
		pp = 50
	}
	totalPages := int((total + int64(pp) - 1) / int64(pp))
	writeJSON(w, http.StatusOK, map[string]any{
		"transactions": resp,
		"pagination": map[string]any{
			"page":        p,
			"per_page":    pp,
			"total":       total,
			"total_pages": totalPages,
		},
		"summary": summary,
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

type batchReq struct {
	TransactionIDs []string `json:"transaction_ids"`
	Action         string   `json:"action"`
	CategoryID     string   `json:"category_id"`
}

func (h *TransactionHandler) Batch(w http.ResponseWriter, r *http.Request) {
	var req batchReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.TransactionIDs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "transaction_ids is required")
		return
	}
	switch req.Action {
	case "categorize", "clear", "unclear", "delete":
	default:
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "unknown action")
		return
	}

	affected, err := h.repo.BatchUpdate(r.Context(), req.TransactionIDs, req.Action, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}
