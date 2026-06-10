package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type BudgetService struct {
	budgetRepo *repository.BudgetRepo
	targetRepo *repository.TargetRepo
	catRepo    *repository.CategoryRepo
	rateRepo   *repository.ExchangeRateRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	targetRepo *repository.TargetRepo,
	catRepo    *repository.CategoryRepo,
	rateRepo   *repository.ExchangeRateRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, targetRepo: targetRepo, catRepo: catRepo, rateRepo: rateRepo}
}

// GetMonth returns a fully-computed BudgetMonth for the given "YYYY-MM" month string.
func (s *BudgetService) GetMonth(ctx context.Context, month string) (*model.BudgetMonth, error) {
	firstOfMonth := month + "-01"
	lastOfMonth := lastDay(month)

	groups, err := s.catRepo.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}

	targets, err := s.targetRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("get targets: %w", err)
	}

	assigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, firstOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get assigned: %w", err)
	}

	activity, err := s.budgetRepo.GetAllActivityUpToMonth(ctx, lastOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get activity: %w", err)
	}

	breakdown, err := s.budgetRepo.GetActivityBreakdownForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("get activity breakdown: %w", err)
	}
	breakdownByCat := make(map[string][]repository.ActivityBreakdownRow)
	for _, row := range breakdown {
		breakdownByCat[row.CategoryID] = append(breakdownByCat[row.CategoryID], row)
	}

	// Get today's exchange rate for RTA conversion; fall back to 500 if unavailable.
	today := time.Now().Format("2006-01-02")
	var currentRate float64 = 500
	if rate, err := s.rateRepo.GetNearest(ctx, today); err == nil {
		currentRate = rate.USDToCRC
	}

	// Collect all non-system category IDs.
	var allCatIDs []string
	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		for _, c := range g.Categories {
			allCatIDs = append(allCatIDs, c.ID)
		}
	}

	// Determine earliest month across all data.
	earliest := firstOfMonth
	for _, monthMap := range assigned {
		for m := range monthMap {
			if m < earliest {
				earliest = m
			}
		}
	}
	for _, monthMap := range activity {
		for m := range monthMap {
			if m < earliest {
				earliest = m
			}
		}
	}

	months := monthRange(earliest, firstOfMonth)

	// Rollover loop — carry is in each category's native currency.
	carry := make(map[string]int64)
	carryInForTarget := make(map[string]int64)

	for _, m := range months {
		nextCarry := make(map[string]int64)
		for _, catID := range allCatIDs {
			a := int64(0)
			if assignedByMonth, ok := assigned[catID]; ok {
				a = assignedByMonth[m]
			}
			act := int64(0)
			if actByMonth, ok := activity[catID]; ok {
				act = actByMonth[m]
			}
			ci := carry[catID]
			avail := ci + a + act

			if m == firstOfMonth {
				carryInForTarget[catID] = ci
			}

			if avail > 0 {
				nextCarry[catID] = avail
			} else {
				nextCarry[catID] = 0
			}
		}
		carry = nextCarry
	}

	// Get balance split by currency for RTA.
	balances, err := s.budgetRepo.GetOnBudgetBalanceByCurrency(ctx)
	if err != nil {
		return nil, fmt.Errorf("get on-budget balance: %w", err)
	}

	outflow30d, err := s.budgetRepo.GetOutflow30Days(ctx)
	if err != nil {
		return nil, fmt.Errorf("get outflow 30 days: %w", err)
	}

	// Convert USD account balance to CRC for unified RTA.
	usdInCRC := int64(math.Round(float64(balances.USD) * currentRate))
	totalBalanceCRC := balances.CRC + usdInCRC

	// Build response and compute totalAvailableCRC (all categories converted to CRC).
	var totalUnderfunded int64
	var totalAvailableCRC int64
	var groupBudgets []model.CategoryGroupBudget

	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		gb := model.CategoryGroupBudget{
			ID:   g.ID,
			Name: g.Name,
		}
		for _, c := range g.Categories {
			ci := carryInForTarget[c.ID]
			a := int64(0)
			if assignedByMonth, ok := assigned[c.ID]; ok {
				a = assignedByMonth[firstOfMonth]
			}
			act := int64(0)
			if actByMonth, ok := activity[c.ID]; ok {
				act = actByMonth[firstOfMonth]
			}
			avail := ci + a + act

			// Convert this category's available to CRC for totalAvailableCRC.
			if c.Currency == "USD" {
				totalAvailableCRC += int64(math.Round(float64(avail) * currentRate))
			} else {
				totalAvailableCRC += avail
			}

			target := targets[c.ID]
			underfunded := computeUnderfunded(target, a, avail, month)

			// Build activity breakdown entries.
			var actBreakdown []model.ActivityEntry
			for _, row := range breakdownByCat[c.ID] {
				actBreakdown = append(actBreakdown, model.ActivityEntry{
					Currency:        row.TxnCurrency,
					Amount:          row.Amount,
					ConvertedAmount: row.ConvertedAmount,
				})
			}

			cb := model.CategoryBudget{
				ID:                c.ID,
				Name:              c.Name,
				Currency:          c.Currency,
				Assigned:          a,
				Activity:          act,
				CarryIn:           ci,
				Available:         avail,
				Target:            target,
				Underfunded:       underfunded,
				ActivityBreakdown: actBreakdown,
			}

			// Group subtotals in CRC.
			if c.Currency == "USD" {
				gb.Assigned += int64(math.Round(float64(a) * currentRate))
				gb.Activity += int64(math.Round(float64(act) * currentRate))
				gb.Available += int64(math.Round(float64(avail) * currentRate))
			} else {
				gb.Assigned += a
				gb.Activity += act
				gb.Available += avail
			}

			gb.Categories = append(gb.Categories, cb)
			totalUnderfunded += underfunded
		}
		groupBudgets = append(groupBudgets, gb)
	}

	rta := totalBalanceCRC - totalAvailableCRC

	var aom *int
	if outflow30d > 0 {
		days := int(totalBalanceCRC * 30 / outflow30d)
		if days < 0 {
			days = 0
		}
		aom = &days
	}

	return &model.BudgetMonth{
		Month:         month,
		ReadyToAssign: rta,
		RTABreakdown: model.RTABreakdown{
			CRCAccounts:    balances.CRC,
			USDAccountsCRC: usdInCRC,
			USDNative:      balances.USD,
		},
		AgeOfMoney:       aom,
		TotalUnderfunded: totalUnderfunded,
		CategoryGroups:   groupBudgets,
	}, nil
}

// SetAssigned creates or updates the assigned amount for a category in a month.
func (s *BudgetService) SetAssigned(ctx context.Context, catID, month string, assigned int64) error {
	return s.budgetRepo.UpsertAssigned(ctx, catID, month+"-01", assigned)
}

// CopyPrevious copies assigned values from the previous month to the current month,
// only for categories that had a positive assignment and have no current-month row yet.
func (s *BudgetService) CopyPrevious(ctx context.Context, month string) error {
	prevMonth := prevMonthStr(month)
	prevAssigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, prevMonth+"-01")
	if err != nil {
		return fmt.Errorf("get prev assigned: %w", err)
	}

	var entries []repository.BudgetAssignedEntry
	prevKey := prevMonth + "-01"
	for catID, monthMap := range prevAssigned {
		if v, ok := monthMap[prevKey]; ok && v > 0 {
			entries = append(entries, repository.BudgetAssignedEntry{
				CategoryID: catID,
				Month:      month + "-01",
				Assigned:   v,
			})
		}
	}

	return s.budgetRepo.BulkInsertAssignedIfAbsent(ctx, entries)
}

// Move atomically transfers funds between two categories in the same month.
// Returns an error if the categories have different currencies.
func (s *BudgetService) Move(ctx context.Context, month, fromCatID, toCatID string, amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive, got %d", amount)
	}
	currencies, err := s.catRepo.GetCurrencies(ctx, []string{fromCatID, toCatID})
	if err != nil {
		return fmt.Errorf("get category currencies: %w", err)
	}
	if currencies[fromCatID] != currencies[toCatID] {
		return fmt.Errorf("cannot move money between categories with different currencies (%s vs %s)",
			currencies[fromCatID], currencies[toCatID])
	}
	return s.budgetRepo.AtomicMove(ctx, fromCatID, toCatID, month+"-01", amount)
}

// UpsertTarget creates or replaces a target for a category.
func (s *BudgetService) UpsertTarget(ctx context.Context, catID string, t model.Target) error {
	return s.targetRepo.Upsert(ctx, catID, t)
}

// DeleteTarget removes a target for a category.
func (s *BudgetService) DeleteTarget(ctx context.Context, catID string) error {
	return s.targetRepo.Delete(ctx, catID)
}

// ChangeCategoryBudgetCurrency updates a category's currency and clears all its assigned budget rows.
func (s *BudgetService) ChangeCategoryBudgetCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	if _, err := s.catRepo.UpdateCategory(ctx, catID, model.UpdateCategoryReq{Currency: newCurrency}); err != nil {
		return fmt.Errorf("update category currency: %w", err)
	}
	return s.budgetRepo.ClearAllAssigned(ctx, catID)
}

// computeUnderfunded calculates how much more needs to be assigned to meet the target this month.
func computeUnderfunded(t *model.Target, assigned, available int64, currentMonth string) int64 {
	if t == nil {
		return 0
	}
	switch t.Type {
	case "monthly":
		return max(0, t.Amount-assigned)
	case "refill":
		return max(0, t.Amount-available)
	case "savings":
		if t.Deadline == nil {
			return 0
		}
		if available >= t.Amount {
			return 0
		}
		mr := monthsUntil(currentMonth+"-01", *t.Deadline)
		if mr <= 0 {
			mr = 1
		}
		need := (t.Amount - available + int64(mr) - 1) / int64(mr)
		return max(0, need-assigned)
	}
	return 0
}

func lastDay(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month+1), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return t.Format("2006-01-02")
}

// nextMonthStr advances "YYYY-MM" by one month.
func nextMonthStr(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01")
}

func prevMonthStr(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month)-1, 1, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01")
}

func monthRange(start, end string) []string {
	var months []string
	cur := start
	for cur <= end {
		months = append(months, cur)
		var year, month, day int
		fmt.Sscanf(cur, "%d-%d-%d", &year, &month, &day)
		t := time.Date(year, time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC)
		cur = t.Format("2006-01-02")
	}
	return months
}

func monthsUntil(from, to string) int {
	var fy, fm, fd int
	var ty, tm, td int
	fmt.Sscanf(from, "%d-%d-%d", &fy, &fm, &fd)
	fmt.Sscanf(to, "%d-%d-%d", &ty, &tm, &td)
	return (ty-fy)*12 + (tm - fm)
}
