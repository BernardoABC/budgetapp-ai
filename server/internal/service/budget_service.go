package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"budgetapp/internal/model"
	"budgetapp/internal/repository"
)

type BudgetService struct {
	budgetRepo *repository.BudgetRepo
	targetRepo *repository.TargetRepo
	catRepo    *repository.CategoryRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	targetRepo *repository.TargetRepo,
	catRepo *repository.CategoryRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, targetRepo: targetRepo, catRepo: catRepo}
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

	// Collect all category IDs from groups.
	var allCatIDs []string
	for _, g := range groups {
		for _, c := range g.Categories {
			allCatIDs = append(allCatIDs, c.ID)
		}
	}

	// Determine earliest month across all assigned and activity data.
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

	// Build sorted month list from earliest to firstOfMonth.
	months := monthRange(earliest, firstOfMonth)

	// Rollover loop.
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

	// Get balance and outflow for RTA and AoM.
	balance, err := s.budgetRepo.GetOnBudgetBalance(ctx)
	if err != nil {
		slog.Warn("could not get on-budget balance", "err", err)
	}

	outflow30d, err := s.budgetRepo.GetOutflow30Days(ctx)
	if err != nil {
		slog.Warn("could not get outflow 30 days", "err", err)
	}

	// Build response.
	var totalUnderfunded int64
	var totalAvailable int64
	var groupBudgets []model.CategoryGroupBudget

	for _, g := range groups {
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

			target := targets[c.ID]
			underfunded := computeUnderfunded(target, a, avail, month)

			cb := model.CategoryBudget{
				ID:          c.ID,
				Name:        c.Name,
				Assigned:    a,
				Activity:    act,
				CarryIn:     ci,
				Available:   avail,
				Target:      target,
				Underfunded: underfunded,
			}

			gb.Categories = append(gb.Categories, cb)
			gb.Assigned += a
			gb.Activity += act
			gb.Available += avail
			totalUnderfunded += underfunded
			totalAvailable += avail
		}
		groupBudgets = append(groupBudgets, gb)
	}

	// RTA = balance - sum of all available amounts.
	rta := balance - totalAvailable

	// AoM = balance / (outflow30d / 30) as integer days; nil if outflow30d == 0.
	var aom *int
	if outflow30d > 0 {
		days := int(balance * 30 / outflow30d)
		if days < 0 {
			days = 0
		}
		aom = &days
	}

	return &model.BudgetMonth{
		Month:            month,
		ReadyToAssign:    rta,
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
func (s *BudgetService) Move(ctx context.Context, month, fromCatID, toCatID string, amount int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive, got %d", amount)
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
		need := (t.Amount - available + int64(mr) - 1) / int64(mr) // ceiling division
		return max(0, need-assigned)
	}
	return 0
}

// lastDay returns the last calendar day of a "YYYY-MM" month, e.g. "2026-04-30".
func lastDay(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	// First day of next month minus one day
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

// prevMonthStr decrements "YYYY-MM" by one month.
func prevMonthStr(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month)-1, 1, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01")
}

// monthRange returns a sorted slice of "YYYY-MM-01" strings from start to end inclusive.
// start and end are "YYYY-MM-01" strings.
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
	sort.Strings(months)
	return months
}

// monthsUntil returns the number of whole months from "YYYY-MM-01" to "YYYY-MM-01".
func monthsUntil(from, to string) int {
	var fy, fm, fd int
	var ty, tm, td int
	fmt.Sscanf(from, "%d-%d-%d", &fy, &fm, &fd)
	fmt.Sscanf(to, "%d-%d-%d", &ty, &tm, &td)
	return (ty-fy)*12 + (tm - fm)
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
