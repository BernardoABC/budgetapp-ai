package service

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"budgetapp/internal/importer"
	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

// ImportService orchestrates the parse → categorize → preview and the confirm/commit
// flows. Parsing and categorization live in the pure importer package; this service
// adds the database.
type ImportService struct {
	pool        *pgxpool.Pool
	accountRepo *repository.AccountRepo
	ruleRepo    *repository.PayeeRuleRepo
	importRepo  *repository.ImportRepo
}

func NewImportService(
	pool *pgxpool.Pool,
	accountRepo *repository.AccountRepo,
	ruleRepo *repository.PayeeRuleRepo,
	importRepo *repository.ImportRepo,
) *ImportService {
	return &ImportService{pool: pool, accountRepo: accountRepo, ruleRepo: ruleRepo, importRepo: importRepo}
}

// Preview parses the uploaded file, categorizes each row, flags duplicates and
// transfers, and returns the preview. It performs no writes.
func (s *ImportService) Preview(ctx context.Context, accountID, filename string, file io.Reader) (model.PreviewResponse, error) {
	account, err := s.accountRepo.Get(ctx, accountID)
	if err != nil {
		return model.PreviewResponse{}, err
	}

	stmt, err := importer.BACCSVParser{}.Parse(file)
	if err != nil {
		return model.PreviewResponse{}, fmt.Errorf("parse statement: %w", err)
	}

	dbRules, err := s.ruleRepo.List(ctx)
	if err != nil {
		return model.PreviewResponse{}, err
	}
	rules := make([]importer.Rule, len(dbRules))
	for i, r := range dbRules {
		rules[i] = importer.Rule{Pattern: r.Pattern, CategoryID: r.CategoryID}
	}

	var (
		txns              = make([]model.PreviewTxn, 0, len(stmt.Transactions))
		totalIn, totalOut int64
		minDate, maxDate  string
	)
	for i, pt := range stmt.Transactions {
		norm := importer.Normalize(pt.DescriptionRaw)
		sug := importer.Categorize(norm, rules)

		var sugID *string
		if sug.CategoryID != "" {
			id := sug.CategoryID
			sugID = &id
		}

		dupID, err := s.findDuplicate(ctx, accountID, pt.Date, pt.Amount, norm, pt.Reference)
		if err != nil {
			return model.PreviewResponse{}, err
		}

		txns = append(txns, model.PreviewTxn{
			TempID:                fmt.Sprintf("tmp_%d", i+1),
			Date:                  pt.Date,
			Amount:                pt.Amount,
			DescriptionRaw:        pt.DescriptionRaw,
			DescriptionNormalized: norm,
			Reference:             pt.Reference,
			TransactionCode:       pt.TransactionCode,
			Balance:               pt.RunningBalance,
			SuggestedCategoryID:   sugID,
			SuggestedConfidence:   string(sug.Confidence),
			DuplicateOf:           dupID,
			IsTransfer:            pt.TransactionCode == "TF",
		})

		if pt.Amount < 0 {
			totalOut += pt.Amount
		} else {
			totalIn += pt.Amount
		}
		if minDate == "" || pt.Date < minDate {
			minDate = pt.Date
		}
		if maxDate == "" || pt.Date > maxDate {
			maxDate = pt.Date
		}
	}

	return model.PreviewResponse{
		FileInfo: model.ImportFileInfo{
			Filename:         filename,
			Currency:         stmt.Currency,
			IBAN:             stmt.IBAN,
			OpeningBalance:   stmt.OpeningBalance,
			AvailableBalance: stmt.AvailableBalance,
			StatementDate:    stmt.StatementDate,
			TransactionCount: len(txns),
			DateRange:        model.DateRange{From: minDate, To: maxDate},
			TotalInflow:      totalIn,
			TotalOutflow:     totalOut,
			CurrencyMismatch: stmt.Currency != "" && account.Currency != "" && stmt.Currency != account.Currency,
		},
		Transactions: txns,
	}, nil
}

// findDuplicate returns the id of an existing transaction that matches on account,
// date, amount, and (normalized description or reference), or nil.
func (s *ImportService) findDuplicate(ctx context.Context, accountID, date string, amount int64, norm, reference string) (*string, error) {
	cands, err := s.importRepo.DupCandidates(ctx, accountID, date, amount)
	if err != nil {
		return nil, err
	}
	for _, c := range cands {
		refMatch := reference != "" && c.Reference != "" && reference == c.Reference
		descMatch := importer.Normalize(c.Payee) == norm
		if refMatch || descMatch {
			id := c.ID
			return &id, nil
		}
	}
	return nil, nil
}

// Confirm commits the reviewed transactions, the import record, account balance,
// and learned payee rules in a single database transaction.
func (s *ImportService) Confirm(ctx context.Context, req model.ConfirmReq) (model.ConfirmResponse, error) {
	account, err := s.accountRepo.Get(ctx, req.AccountID)
	if err != nil {
		return model.ConfirmResponse{}, err
	}

	included := make([]model.ConfirmTxnReq, 0, len(req.Transactions))
	for _, t := range req.Transactions {
		if t.Include {
			included = append(included, t)
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return model.ConfirmResponse{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	importID, err := s.importRepo.CreateImport(ctx, tx, req.AccountID, req.Filename, len(included))
	if err != nil {
		return model.ConfirmResponse{}, err
	}

	var balanceDelta int64
	var newRules, updatedRules int

	for _, t := range included {
		payee := strings.TrimSpace(t.DescriptionRaw)
		if t.PayeeOverride != nil && *t.PayeeOverride != "" {
			payee = *t.PayeeOverride
		}

		if err := s.importRepo.InsertImportedTxn(
			ctx, tx, req.AccountID, importID, t.Date, t.Amount,
			account.Currency, payee, t.Reference, t.CategoryID, t.Memo,
		); err != nil {
			return model.ConfirmResponse{}, err
		}
		balanceDelta += t.Amount

		if t.CategoryID != nil && *t.CategoryID != "" {
			created, err := s.ruleRepo.Learn(ctx, tx, importer.Normalize(t.DescriptionRaw), *t.CategoryID)
			if err != nil {
				return model.ConfirmResponse{}, err
			}
			if created {
				newRules++
			} else {
				updatedRules++
			}
		}
	}

	if balanceDelta != 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
			balanceDelta, req.AccountID,
		); err != nil {
			return model.ConfirmResponse{}, fmt.Errorf("update balance: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return model.ConfirmResponse{}, fmt.Errorf("commit: %w", err)
	}

	return model.ConfirmResponse{
		ImportID:        importID,
		ImportedCount:   len(included),
		SkippedCount:    len(req.Transactions) - len(included),
		NewRulesCreated: newRules,
		RulesUpdated:    updatedRules,
	}, nil
}
