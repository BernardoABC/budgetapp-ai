package handler

import (
	"net/http"

	"budgetapp/internal/repository"
)

type ReportsHandler struct {
	txnRepo    *repository.TransactionRepo
	budgetRepo *repository.BudgetRepo
}

func NewReportsHandler(txnRepo *repository.TransactionRepo, budgetRepo *repository.BudgetRepo) *ReportsHandler {
	return &ReportsHandler{txnRepo: txnRepo, budgetRepo: budgetRepo}
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

// IncomeExpense handles GET /api/reports/income-expense?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) IncomeExpense(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}

	rows, err := h.txnRepo.IncomeExpenseByMonth(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type row struct {
		Month   string `json:"month"`
		Income  int64  `json:"income"`
		Expense int64  `json:"expense"`
	}
	result := make([]row, 0, len(rows))
	for _, r := range rows {
		result = append(result, row{Month: r.Month, Income: r.Income, Expense: r.Expense})
	}
	writeJSON(w, http.StatusOK, result)
}

// SavingsRate handles GET /api/reports/savings?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) SavingsRate(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}
	rows, err := h.budgetRepo.GetCashFlowByMonth(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	type row struct {
		Month   string  `json:"month"`
		Income  int64   `json:"income"`
		Expense int64   `json:"expense"`
		Savings int64   `json:"savings"`
		Rate    float64 `json:"rate"` // savings / income, 0 when income <= 0
	}
	result := make([]row, 0, len(rows))
	for _, rr := range rows {
		savings := rr.Income - rr.Spending
		var rate float64
		if rr.Income > 0 {
			rate = float64(savings) / float64(rr.Income)
		}
		result = append(result, row{Month: rr.Month, Income: rr.Income, Expense: rr.Spending, Savings: savings, Rate: rate})
	}
	writeJSON(w, http.StatusOK, result)
}

// NetWorth handles GET /api/reports/net-worth?from=YYYY-MM&to=YYYY-MM.
func (h *ReportsHandler) NetWorth(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" || to == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from and to query params are required (YYYY-MM)")
		return
	}

	rows, err := h.txnRepo.NetWorthByMonth(r.Context(), from, to)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type row struct {
		Month    string `json:"month"`
		NetWorth int64  `json:"net_worth"`
	}
	result := make([]row, 0, len(rows))
	for _, r := range rows {
		result = append(result, row{Month: r.Month, NetWorth: r.NetWorth})
	}
	writeJSON(w, http.StatusOK, result)
}
