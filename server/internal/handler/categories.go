package handler

import (
	"net/http"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type CategoryHandler struct {
	repo *repository.CategoryRepo
}

func NewCategoryHandler(repo *repository.CategoryRepo) *CategoryHandler {
	return &CategoryHandler{repo: repo}
}

func (h *CategoryHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListGroups(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	type catResp struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		Currency  string `json:"currency"`
		Hidden    bool   `json:"hidden"`
		SortOrder int    `json:"sort_order"`
		IsSystem  bool   `json:"is_system"`
	}
	type groupResp struct {
		ID         string    `json:"id"`
		Name       string    `json:"name"`
		SortOrder  int       `json:"sort_order"`
		Hidden     bool      `json:"hidden"`
		IsSystem   bool      `json:"is_system"`
		Categories []catResp `json:"categories"`
	}

	resp := make([]groupResp, len(groups))
	for i, g := range groups {
		cats := make([]catResp, len(g.Categories))
		for j, c := range g.Categories {
			cats[j] = catResp{ID: c.ID, Name: c.Name, Currency: c.Currency, Hidden: c.Hidden, SortOrder: c.SortOrder, IsSystem: c.IsSystem}
		}
		resp[i] = groupResp{ID: g.ID, Name: g.Name, SortOrder: g.SortOrder, Hidden: g.Hidden, IsSystem: g.IsSystem, Categories: cats}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *CategoryHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var req model.CreateGroupReq
	if err := readJSON(r, &req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "name is required")
		return
	}
	g, err := h.repo.CreateGroup(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *CategoryHandler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req model.UpdateGroupReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	g, err := h.repo.UpdateGroup(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (h *CategoryHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.DeleteGroup(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, "BUSINESS_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CategoryHandler) CreateCategory(w http.ResponseWriter, r *http.Request) {
	var req model.CreateCategoryReq
	if err := readJSON(r, &req); err != nil || req.Name == "" || req.GroupID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "group_id and name are required")
		return
	}
	if req.Currency != "" && req.Currency != "CRC" && req.Currency != "USD" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "currency must be CRC or USD")
		return
	}
	if req.Flexibility != "" && req.Flexibility != "fixed" && req.Flexibility != "flexible" && req.Flexibility != "non_monthly" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "flexibility must be fixed, flexible, or non_monthly")
		return
	}
	c, err := h.repo.CreateCategory(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *CategoryHandler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req model.UpdateCategoryReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.Currency != "" && req.Currency != "CRC" && req.Currency != "USD" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "currency must be CRC or USD")
		return
	}
	if req.Flexibility != "" && req.Flexibility != "fixed" && req.Flexibility != "flexible" && req.Flexibility != "non_monthly" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "flexibility must be fixed, flexible, or non_monthly")
		return
	}
	c, err := h.repo.UpdateCategory(r.Context(), id, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *CategoryHandler) DeleteCategory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.repo.DeleteCategory(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, "BUSINESS_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
