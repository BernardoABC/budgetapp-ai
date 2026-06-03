package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/repository"
)

type PayeeRuleHandler struct {
	repo *repository.PayeeRuleRepo
}

func NewPayeeRuleHandler(repo *repository.PayeeRuleRepo) *PayeeRuleHandler {
	return &PayeeRuleHandler{repo: repo}
}

type ruleResp struct {
	ID         string `json:"id"`
	Pattern    string `json:"payee_pattern"`
	CategoryID string `json:"category_id"`
	MatchCount int    `json:"match_count"`
}

type ruleReq struct {
	PayeePattern string `json:"payee_pattern"`
	CategoryID   string `json:"category_id"`
}

func (h *PayeeRuleHandler) List(w http.ResponseWriter, r *http.Request) {
	rules, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]ruleResp, len(rules))
	for i, p := range rules {
		resp[i] = ruleResp{ID: p.ID, Pattern: p.Pattern, CategoryID: p.CategoryID, MatchCount: p.MatchCount}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *PayeeRuleHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Create(r.Context(), req.PayeePattern, req.CategoryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req ruleReq
	if err := readJSON(r, &req); err != nil || req.PayeePattern == "" || req.CategoryID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "payee_pattern and category_id are required")
		return
	}
	rule, err := h.repo.Update(r.Context(), id, req.PayeePattern, req.CategoryID)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ruleResp{ID: rule.ID, Pattern: rule.Pattern, CategoryID: rule.CategoryID, MatchCount: rule.MatchCount})
}

func (h *PayeeRuleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "payee rule not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
