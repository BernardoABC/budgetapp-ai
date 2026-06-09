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
	var transferPeerID any = nil
	if t.TransferPeerID != "" {
		transferPeerID = t.TransferPeerID
	}
	var transferPeerAccountID any = nil
	if t.TransferPeerAccountID != "" {
		transferPeerAccountID = t.TransferPeerAccountID
	}
	splits := make([]map[string]any, len(t.Splits))
	for i, s := range t.Splits {
		splits[i] = map[string]any{"category": s.CategoryName, "amount": s.Amount}
	}
	return map[string]any{
		"id":                       t.ID,
		"account":                  t.AccountID,
		"date":                     t.Date,
		"payee":                    t.Payee,
		"category":                 category,
		"category_id":              categoryID,
		"memo":                     t.Memo,
		"amount":                   t.Amount,
		"currency":                 t.Currency,
		"cleared":                  t.Cleared,
		"reconciled":               t.Reconciled,
		"exchange_rate":            t.ExchangeRate,
		"splits":                   splits,
		"transfer_peer_id":         transferPeerID,
		"transfer_peer_account_id": transferPeerAccountID,
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
		Search:      q.Get("search"),
		FromDate:    q.Get("from_date"),
		ToDate:      q.Get("to_date"),
		CategoryID:  q.Get("category_id"),
		Sort:        q.Get("sort"),
		Page:        page,
		PerPage:     perPage,
		MinAmount:   parseAmountParam(q.Get("min_amount")),
		MaxAmount:   parseAmountParam(q.Get("max_amount")),
		HighlightID: q.Get("highlight_id"),
	}
	if c := q.Get("cleared"); c == "true" {
		v := true
		f.Cleared = &v
	} else if c == "false" {
		v := false
		f.Cleared = &v
	}

	txns, total, summary, highlightPage, err := h.repo.ListByAccount(r.Context(), accountID, f)
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
		"transactions":   resp,
		"highlight_page": highlightPage,
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

func (h *TransactionHandler) CreateTransfer(w http.ResponseWriter, r *http.Request) {
	var req model.CreateTransferReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.FromAccountID == "" || req.ToAccountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from_account_id and to_account_id are required")
		return
	}
	if req.FromAccountID == req.ToAccountID {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to accounts must differ")
		return
	}
	if req.Date == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "date is required")
		return
	}
	if req.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be positive")
		return
	}

	from, to, err := h.repo.CreateTransfer(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"from": h.toResponse(from),
		"to":   h.toResponse(to),
	})
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

	if req.Action == "categorize" && req.CategoryID != "" {
		// Validate UUID format to return a 400 instead of a DB cast error
		if len(req.CategoryID) != 36 {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "category_id must be a valid UUID or empty")
			return
		}
	}

	affected, err := h.repo.BatchUpdate(r.Context(), req.TransactionIDs, req.Action, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}

type reconcileReq struct {
	Adjustment int64 `json:"adjustment"`
}

func (h *TransactionHandler) Reconcile(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	var req reconcileReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	count, err := h.repo.Reconcile(r.Context(), accountID, req.Adjustment)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reconciled_count": count})
}

func (h *TransactionHandler) TransferCandidates(w http.ResponseWriter, r *http.Request) {
	accountID := r.PathValue("id")
	amountStr := r.URL.Query().Get("amount")
	if amountStr == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount query param is required")
		return
	}
	amount, err := strconv.ParseInt(amountStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "amount must be an integer (centimos)")
		return
	}
	txns, err := h.repo.TransferCandidates(r.Context(), accountID, amount)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]map[string]any, len(txns))
	for i, t := range txns {
		resp[i] = h.toResponse(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"transactions": resp})
}

func (h *TransactionHandler) Link(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TransactionAID string `json:"transaction_a_id"`
		TransactionBID string `json:"transaction_b_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.TransactionAID == "" || req.TransactionBID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "transaction_a_id and transaction_b_id are required")
		return
	}
	if err := h.repo.LinkTransfer(r.Context(), req.TransactionAID, req.TransactionBID); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	a, _ := h.repo.Get(r.Context(), req.TransactionAID)
	b, _ := h.repo.Get(r.Context(), req.TransactionBID)
	writeJSON(w, http.StatusOK, map[string]any{
		"from": h.toResponse(a),
		"to":   h.toResponse(b),
	})
}

func (h *TransactionHandler) LinkBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pairs [][2]string `json:"pairs"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.Pairs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "pairs must be a non-empty array")
		return
	}
	linked, err := h.repo.LinkTransferBatch(r.Context(), req.Pairs)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": linked})
}

func (h *TransactionHandler) LinkOrCreateBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pairs []struct {
			SourceID        string `json:"source_id"`
			TargetID        string `json:"target_id"`
			TargetAccountID string `json:"target_account_id"`
			TargetPayee     string `json:"target_payee"`
			TargetDate      string `json:"target_date"`
			TargetAmount    int64  `json:"target_amount"`
		} `json:"pairs"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if len(req.Pairs) == 0 {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "pairs must be non-empty")
		return
	}
	pairs := make([]model.LinkOrCreatePair, len(req.Pairs))
	for i, p := range req.Pairs {
		pairs[i] = model.LinkOrCreatePair{
			SourceID:        p.SourceID,
			TargetID:        p.TargetID,
			TargetAccountID: p.TargetAccountID,
			TargetPayee:     p.TargetPayee,
			TargetDate:      p.TargetDate,
			TargetAmount:    p.TargetAmount,
		}
	}
	linked, created, err := h.repo.LinkOrCreateBatch(r.Context(), pairs)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Transaction not found")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "LINK_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"linked": linked, "created": created})
}
