package handler

import (
	"net/http"

	"budgetapp/internal/repository"
)

type ReportsHandler struct {
	txnRepo *repository.TransactionRepo
}

func NewReportsHandler(txnRepo *repository.TransactionRepo) *ReportsHandler {
	return &ReportsHandler{txnRepo: txnRepo}
}

type spendingGroup struct {
	Name  string `json:"name"`
	Total int64  `json:"total"`
}

type spendingMonth struct {
	Month  string          `json:"month"`
	Groups []spendingGroup `json:"groups"`
}

// SpendingByGroup handles GET /api/reports/spending?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) SpendingByGroup(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}

	rows, err := h.txnRepo.SpendingByGroup(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	// Pivot flat rows into per-month buckets preserving order.
	order := []string{}
	byMonth := map[string]*spendingMonth{}
	for _, row := range rows {
		if _, ok := byMonth[row.Month]; !ok {
			byMonth[row.Month] = &spendingMonth{Month: row.Month, Groups: []spendingGroup{}}
			order = append(order, row.Month)
		}
		byMonth[row.Month].Groups = append(byMonth[row.Month].Groups, spendingGroup{
			Name:  row.GroupName,
			Total: row.Total,
		})
	}

	result := make([]spendingMonth, 0, len(order))
	for _, m := range order {
		result = append(result, *byMonth[m])
	}
	writeJSON(w, http.StatusOK, result)
}
