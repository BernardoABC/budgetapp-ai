package handler

import (
	"errors"
	"net/http"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
	"budgetapp/internal/service"
)

type ImportHandler struct {
	svc        *service.ImportService
	importRepo *repository.ImportRepo
}

func NewImportHandler(svc *service.ImportService, importRepo *repository.ImportRepo) *ImportHandler {
	return &ImportHandler{svc: svc, importRepo: importRepo}
}

// Preview handles POST /api/imports/preview (multipart: file, account_id).
func (h *ImportHandler) Preview(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid multipart form")
		return
	}
	accountID := r.FormValue("account_id")
	if accountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "account_id is required")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "file is required")
		return
	}
	defer file.Close()

	resp, err := h.svc.Preview(r.Context(), accountID, header.Filename, file)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusBadRequest, "PARSE_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// Confirm handles POST /api/imports/confirm (JSON).
func (h *ImportHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	var req model.ConfirmReq
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	if req.AccountID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "account_id is required")
		return
	}
	resp, err := h.svc.Confirm(r.Context(), req)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Account not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// History handles GET /api/imports.
func (h *ImportHandler) History(w http.ResponseWriter, r *http.Request) {
	records, err := h.importRepo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	if records == nil {
		records = []model.ImportRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}
