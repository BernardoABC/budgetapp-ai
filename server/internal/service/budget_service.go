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
	planRepo   *repository.MonthlyPlanRepo
	catRepo    *repository.CategoryRepo
	rateRepo   *repository.ExchangeRateRepo
	settings   *repository.SettingsRepo
}

func NewBudgetService(
	budgetRepo *repository.BudgetRepo,
	planRepo *repository.MonthlyPlanRepo,
	catRepo *repository.CategoryRepo,
	rateRepo *repository.ExchangeRateRepo,
	settings *repository.SettingsRepo,
) *BudgetService {
	return &BudgetService{budgetRepo: budgetRepo, planRepo: planRepo, catRepo: catRepo, rateRepo: rateRepo, settings: settings}
}

func (s *BudgetService) GetMonth(ctx context.Context, month string) (*model.PlanMonth, error) {
	firstOfMonth := month + "-01"
	lastOfMonth := lastDay(month)

	groups, err := s.catRepo.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
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

	plan, err := s.planRepo.Get(ctx, firstOfMonth)
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}
	mode, err := s.settings.GetWithDefault(ctx, "budget_mode", "category")
	if err != nil {
		return nil, fmt.Errorf("get budget mode: %w", err)
	}

	today := time.Now().Format("2006-01-02")
	var rate float64 = 500
	if r, err := s.rateRepo.GetNearest(ctx, today); err == nil {
		rate = r.USDToCRC
	}
	toCRC := func(amount int64, currency string) int64 {
		if currency == "USD" {
			return int64(math.Round(float64(amount) * rate))
		}
		return amount
	}

	rollBalance := s.computeRolloverBalances(groups, assigned, activity, firstOfMonth)

	pm := &model.PlanMonth{
		Month:          month,
		Mode:           mode,
		ExpectedIncome: plan.ExpectedIncome,
		FlexBudget:     plan.FlexBudget,
	}

	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		pg := model.PlanGroup{ID: g.ID, Name: g.Name}
		for _, c := range g.Categories {
			planned := assigned[c.ID][firstOfMonth]
			act := activity[c.ID][firstOfMonth]
			remaining := planned + act

			var bd []model.ActivityEntry
			for _, row := range breakdownByCat[c.ID] {
				bd = append(bd, model.ActivityEntry{Currency: row.TxnCurrency, Amount: row.Amount, ConvertedAmount: row.ConvertedAmount})
			}

			pc := model.PlanCategory{
				ID: c.ID, Name: c.Name, Currency: c.Currency,
				Flexibility: c.Flexibility, Rollover: c.Rollover,
				Planned: planned, Activity: act, Remaining: remaining,
				RolloverBalance: rollBalance[c.ID], ActivityBreakdown: bd,
			}

			plannedCRC := toCRC(planned, c.Currency)
			actCRC := toCRC(act, c.Currency)
			pm.PlannedTotal += plannedCRC
			pg.Planned += plannedCRC
			pg.Activity += actCRC
			pg.Remaining += toCRC(remaining, c.Currency)

			spendingCRC := int64(0)
			if actCRC < 0 {
				spendingCRC = -actCRC
			}
			switch c.Flexibility {
			case "fixed":
				pm.FixedPlanned += plannedCRC
				pm.FixedActual += spendingCRC
			case "non_monthly":
				pm.NonMonthlyPlanned += plannedCRC
				pm.NonMonthlyActual += spendingCRC
			default: // flexible
				pm.FlexibleActual += spendingCRC
			}

			pg.Categories = append(pg.Categories, pc)
		}
		pm.CategoryGroups = append(pm.CategoryGroups, pg)
	}

	pm.LeftToBudget = pm.ExpectedIncome - pm.PlannedTotal

	income, err := s.budgetRepo.GetActualIncomeForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("actual income: %w", err)
	}
	spending, err := s.budgetRepo.GetActualSpendingForMonth(ctx, month)
	if err != nil {
		return nil, fmt.Errorf("actual spending: %w", err)
	}
	pm.ActualIncome = income
	pm.ActualSpending = spending
	pm.ActualSavings = income - spending

	return pm, nil
}

// computeRolloverBalances sums Planned+Activity over every month up to firstOfMonth
// for rollover categories. Negative balances carry as-is (no clamp).
func (s *BudgetService) computeRolloverBalances(
	groups []model.CategoryGroup,
	assigned, activity map[string]map[string]int64,
	firstOfMonth string,
) map[string]int64 {
	rollover := map[string]bool{}
	for _, g := range groups {
		if g.IsSystem {
			continue
		}
		for _, c := range g.Categories {
			if c.Rollover {
				rollover[c.ID] = true
			}
		}
	}

	earliest := firstOfMonth
	for _, mm := range assigned {
		for m := range mm {
			if m < earliest {
				earliest = m
			}
		}
	}
	for _, mm := range activity {
		for m := range mm {
			if m < earliest {
				earliest = m
			}
		}
	}
	months := monthRange(earliest, firstOfMonth)

	bal := map[string]int64{}
	for catID := range rollover {
		var acc int64
		for _, m := range months {
			acc += assigned[catID][m] + activity[catID][m]
		}
		bal[catID] = acc
	}
	return bal
}

func (s *BudgetService) SetPlanned(ctx context.Context, catID, month string, planned int64) error {
	return s.budgetRepo.UpsertAssigned(ctx, catID, month+"-01", planned)
}

func (s *BudgetService) SetExpectedIncome(ctx context.Context, month string, amount int64) error {
	return s.planRepo.SetExpectedIncome(ctx, month+"-01", amount)
}

func (s *BudgetService) SetFlexBudget(ctx context.Context, month string, amount int64) error {
	return s.planRepo.SetFlexBudget(ctx, month+"-01", amount)
}

// CopyPrevious copies planned amounts from the previous month (only for categories
// with a positive planned value and no current-month row) and seeds expected income
// from the previous month when the current month has none.
func (s *BudgetService) CopyPrevious(ctx context.Context, month string) error {
	prev := prevMonthStr(month)
	prevAssigned, err := s.budgetRepo.GetAllAssignedUpToMonth(ctx, prev+"-01")
	if err != nil {
		return fmt.Errorf("get prev assigned: %w", err)
	}
	prevKey := prev + "-01"
	var entries []repository.BudgetAssignedEntry
	for catID, mm := range prevAssigned {
		if v, ok := mm[prevKey]; ok && v > 0 {
			entries = append(entries, repository.BudgetAssignedEntry{CategoryID: catID, Month: month + "-01", Assigned: v})
		}
	}
	if err := s.budgetRepo.BulkInsertAssignedIfAbsent(ctx, entries); err != nil {
		return err
	}

	cur, err := s.planRepo.Get(ctx, month+"-01")
	if err != nil {
		return err
	}
	if cur.ExpectedIncome == 0 {
		prevPlan, err := s.planRepo.Get(ctx, prevKey)
		if err != nil {
			return err
		}
		if prevPlan.ExpectedIncome > 0 {
			if err := s.planRepo.SetExpectedIncome(ctx, month+"-01", prevPlan.ExpectedIncome); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *BudgetService) ChangeCategoryBudgetCurrency(ctx context.Context, catID, newCurrency string) error {
	if newCurrency != "CRC" && newCurrency != "USD" {
		return fmt.Errorf("currency must be CRC or USD")
	}
	if err := s.catRepo.UpdateCategoryCurrency(ctx, catID, newCurrency); err != nil {
		return fmt.Errorf("update category currency: %w", err)
	}
	return s.budgetRepo.ClearAllAssigned(ctx, catID)
}

func lastDay(ym string) string {
	var year, month int
	fmt.Sscanf(ym, "%d-%d", &year, &month)
	t := time.Date(year, time.Month(month+1), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return t.Format("2006-01-02")
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
