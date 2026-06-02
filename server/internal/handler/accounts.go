package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type AccountHandler struct {
	repo *repository.AccountRepo
}

func NewAccountHandler(repo *repository.AccountRepo) *AccountHandler {
	return &AccountHandler{repo: repo}
}

// toResponse converts DB model to API response.
func (h *AccountHandler) toResponse(a model.Account) map[string]any {
	return map[string]any{
		"id":         a.ID,
		"name":       a.Name,
		"type":       a.Type,
		"currency":   a.Currency,
		"balance":    a.Balance,
		"on_budget":  a.OnBudget,
		"closed":     a.Closed,
		"note":       a.Note,
		"sort_order": a.SortOrder,
	}
}

func (h *AccountHandler) List(w http.ResponseWriter, r *http.Request) {
	accounts, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	resp := make([]map[string]any, len(accounts))
	for i, a := range accounts {
		resp[i] = h.toResponse(a)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *AccountHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := h.repo.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h.toResponse(a))
}

func (h *AccountHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req model.CreateAccountReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "name is required")
		return
	}
	if req.Type == "" {
		req.Type = "checking"
	}
	a, err := h.repo.Create(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, h.toResponse(a))
}

func (h *AccountHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req model.UpdateAccountReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	a, err := h.repo.Update(r.Context(), id, req)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h.toResponse(a))
}

func (h *AccountHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AccountHandler) ToggleClosed(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := h.repo.ToggleClosed(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, h.toResponse(a))
}
