package handler

import (
	"net/http"
	"regexp"

	"budgetapp/internal/model"
	"budgetapp/internal/service"
)

var monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)

type PlanHandler struct {
	svc *service.PlanService
}

func NewPlanHandler(svc *service.PlanService) *PlanHandler {
	return &PlanHandler{svc: svc}
}

func (h *PlanHandler) GetMonth(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	pm, err := h.svc.GetMonth(r.Context(), month)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, planMonthToJSON(pm))
}

func (h *PlanHandler) SetPlanned(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	catID := r.PathValue("categoryId")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "categoryId required")
		return
	}
	var body struct {
		Planned int64 `json:"planned"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetPlanned(r.Context(), catID, month, body.Planned); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"planned": body.Planned})
}

func (h *PlanHandler) SetIncome(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		Amount int64 `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetExpectedIncome(r.Context(), month, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"amount": body.Amount})
}

func (h *PlanHandler) SetFlexBudget(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	var body struct {
		Amount int64 `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if err := h.svc.SetFlexBudget(r.Context(), month, body.Amount); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"amount": body.Amount})
}

func (h *PlanHandler) CopyPrevious(w http.ResponseWriter, r *http.Request) {
	month := r.PathValue("month")
	if !monthRe.MatchString(month) {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "month must be YYYY-MM")
		return
	}
	if err := h.svc.CopyPrevious(r.Context(), month); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ChangeCategoryCurrency handles PUT /api/categories/{id}/currency.
func (h *PlanHandler) ChangeCategoryCurrency(w http.ResponseWriter, r *http.Request) {
	catID := r.PathValue("id")
	if catID == "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "id required")
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
	if err := h.svc.ChangeCategoryCurrency(r.Context(), catID, body.Currency); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"currency": body.Currency})
}

func planMonthToJSON(pm *model.PlanMonth) map[string]any {
	groups := make([]map[string]any, 0, len(pm.CategoryGroups))
	for _, g := range pm.CategoryGroups {
		cats := make([]map[string]any, 0, len(g.Categories))
		for _, c := range g.Categories {
			bd := make([]map[string]any, 0, len(c.ActivityBreakdown))
			for _, e := range c.ActivityBreakdown {
				bd = append(bd, map[string]any{"currency": e.Currency, "amount": e.Amount, "converted_amount": e.ConvertedAmount})
			}
			cats = append(cats, map[string]any{
				"id": c.ID, "name": c.Name, "currency": c.Currency, "planned_currency": c.PlannedCurrency,
				"flexibility": c.Flexibility, "rollover": c.Rollover,
				"planned": c.Planned, "activity": c.Activity, "remaining": c.Remaining,
				"rollover_balance": c.RolloverBalance, "activity_breakdown": bd,
			})
		}
		groups = append(groups, map[string]any{
			"id": g.ID, "name": g.Name, "is_income": g.IsIncome,
			"planned": g.Planned, "activity": g.Activity, "remaining": g.Remaining,
			"categories": cats,
		})
	}
	return map[string]any{
		"month": pm.Month, "mode": pm.Mode,
		"expected_income": pm.ExpectedIncome, "flex_budget": pm.FlexBudget,
		"planned_total": pm.PlannedTotal, "left_to_budget": pm.LeftToBudget,
		"actual_income": pm.ActualIncome, "actual_spending": pm.ActualSpending, "actual_savings": pm.ActualSavings,
		"fixed_planned": pm.FixedPlanned, "fixed_actual": pm.FixedActual,
		"flexible_actual":     pm.FlexibleActual,
		"non_monthly_planned": pm.NonMonthlyPlanned, "non_monthly_actual": pm.NonMonthlyActual,
		"category_groups": groups,
	}
}
