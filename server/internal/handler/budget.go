package handler

import (
	"net/http"
	"regexp"

	"budgetapp/internal/model"
	"budgetapp/internal/service"
)

var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

type BudgetHandler struct {
	svc *service.BudgetService
}

func NewBudgetHandler(svc *service.BudgetService) *BudgetHandler {
	return &BudgetHandler{svc: svc}
}

// GetMonth handles GET /api/budgets/{month}
func (h *BudgetHandler) GetMonth(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if month == "" || !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month path param required (format: YYYY-MM)")
		return
	}

	bm, err := h.svc.GetMonth(r.Context(), month)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, budgetMonthToJSON(bm))
}

// SetAssigned handles PUT /api/budgets/{month}/categories/{categoryId}
func (h *BudgetHandler) SetAssigned(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if month == "" || !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month path param required (format: YYYY-MM)")
		return
	}

	catID := r.PathValue("categoryId")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "categoryId path param required")
		return
	}

	var body struct {
		Assigned int64 `json:"assigned"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	if err := h.svc.SetAssigned(r.Context(), catID, month, body.Assigned); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"assigned": body.Assigned,
	})
}

// CopyPrevious handles POST /api/budgets/{month}/copy-previous
func (h *BudgetHandler) CopyPrevious(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if month == "" || !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month path param required (format: YYYY-MM)")
		return
	}

	if err := h.svc.CopyPrevious(r.Context(), month); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Move handles POST /api/budgets/{month}/move
func (h *BudgetHandler) Move(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if month == "" || !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month path param required (format: YYYY-MM)")
		return
	}

	var body struct {
		FromCategoryID string `json:"from_category_id"`
		ToCategoryID   string `json:"to_category_id"`
		Amount         int64  `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	if body.FromCategoryID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "from_category_id is required")
		return
	}
	if body.ToCategoryID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "to_category_id is required")
		return
	}
	if body.Amount <= 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "amount must be positive")
		return
	}

	if err := h.svc.Move(r.Context(), month, body.FromCategoryID, body.ToCategoryID, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// UpsertTarget handles PUT /api/categories/{id}/target
func (h *BudgetHandler) UpsertTarget(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id path param required")
		return
	}

	var body struct {
		Type     string  `json:"type"`
		Amount   int64   `json:"amount"`
		Deadline *string `json:"deadline"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	if body.Type != "monthly" && body.Type != "refill" && body.Type != "savings" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "type must be one of: monthly, refill, savings")
		return
	}
	if body.Amount < 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "amount must be non-negative")
		return
	}
	if body.Type == "savings" && body.Deadline == nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "savings target requires deadline")
		return
	}

	target := model.Target{
		Type:     body.Type,
		Amount:   body.Amount,
		Deadline: body.Deadline,
	}
	if err := h.svc.UpsertTarget(r.Context(), catID, target); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"type":     body.Type,
		"amount":   body.Amount,
		"deadline": body.Deadline,
	})
}

// DeleteTarget handles DELETE /api/categories/{id}/target
func (h *BudgetHandler) DeleteTarget(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id path param required")
		return
	}

	if err := h.svc.DeleteTarget(r.Context(), catID); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ChangeCategoryCurrency handles PUT /api/categories/{id}/currency
// Resets all assigned budget rows when the currency changes.
func (h *BudgetHandler) ChangeCategoryCurrency(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id path param required")
		return
	}

	var body struct {
		Currency string `json:"currency"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.Currency != "CRC" && body.Currency != "USD" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "currency must be CRC or USD")
		return
	}

	if err := h.svc.ChangeCategoryBudgetCurrency(r.Context(), catID, body.Currency); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"currency": body.Currency})
}

// budgetMonthToJSON converts a BudgetMonth model to JSON-serializable form
func budgetMonthToJSON(bm *model.BudgetMonth) map[string]any {
	groups := make([]map[string]any, len(bm.CategoryGroups))
	for i, g := range bm.CategoryGroups {
		cats := make([]map[string]any, len(g.Categories))
		for j, c := range g.Categories {
			var tJSON any
			if c.Target != nil {
				tJSON = map[string]any{
					"type":     c.Target.Type,
					"amount":   c.Target.Amount,
					"deadline": c.Target.Deadline,
				}
			}
			var breakdownJSON []map[string]any
			for _, entry := range c.ActivityBreakdown {
				breakdownJSON = append(breakdownJSON, map[string]any{
					"currency":         entry.Currency,
					"amount":           entry.Amount,
					"converted_amount": entry.ConvertedAmount,
				})
			}
			cats[j] = map[string]any{
				"id":                 c.ID,
				"name":               c.Name,
				"currency":           c.Currency,
				"assigned":           c.Assigned,
				"activity":           c.Activity,
				"carry_in":           c.CarryIn,
				"available":          c.Available,
				"underfunded":        c.Underfunded,
				"target":             tJSON,
				"activity_breakdown": breakdownJSON,
			}
		}
		groups[i] = map[string]any{
			"id":         g.ID,
			"name":       g.Name,
			"assigned":   g.Assigned,
			"activity":   g.Activity,
			"available":  g.Available,
			"categories": cats,
		}
	}
	return map[string]any{
		"month":           bm.Month,
		"ready_to_assign": bm.ReadyToAssign,
		"rta_breakdown": map[string]any{
			"crc_accounts":        bm.RTABreakdown.CRCAccounts,
			"usd_accounts_in_crc": bm.RTABreakdown.USDAccountsCRC,
			"usd_accounts_native": bm.RTABreakdown.USDNative,
		},
		"age_of_money":      bm.AgeOfMoney,
		"total_underfunded": bm.TotalUnderfunded,
		"category_groups":   groups,
	}
}
