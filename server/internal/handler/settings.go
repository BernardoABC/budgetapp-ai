package handler

import (
	"net/http"

	"budgetapp/internal/repository"
)

type SettingsHandler struct {
	repo *repository.SettingsRepo
}

func NewSettingsHandler(repo *repository.SettingsRepo) *SettingsHandler {
	return &SettingsHandler{repo: repo}
}

func (h *SettingsHandler) GetBudgetMode(w http.ResponseWriter, r *http.Request) {
	mode, err := h.repo.GetWithDefault(r.Context(), "budget_mode", "category")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": mode})
}

func (h *SettingsHandler) SetBudgetMode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mode string `json:"mode"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	if body.Mode != "category" && body.Mode != "flex" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "mode must be category or flex")
		return
	}
	if err := h.repo.Set(r.Context(), "budget_mode", body.Mode); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": body.Mode})
}
