// server/internal/model/budget.go
package model

type ActivityEntry struct {
	Currency        string `json:"currency"`
	Amount          int64  `json:"amount"`
	ConvertedAmount int64  `json:"converted_amount"`
}

type PlanCategory struct {
	ID                string
	Name              string
	Currency          string
	Flexibility       string // fixed | flexible | non_monthly
	Rollover          bool
	Planned           int64 // native currency
	Activity          int64 // native currency (negative = spending)
	Remaining         int64 // month-scoped: Planned + Activity
	RolloverBalance   int64 // accumulated Planned+Activity across months (rollover cats)
	ActivityBreakdown []ActivityEntry
}

type PlanGroup struct {
	ID         string
	Name       string
	Planned    int64 // CRC
	Activity   int64 // CRC
	Remaining  int64 // CRC
	Categories []PlanCategory
}

type PlanMonth struct {
	Month          string
	Mode           string // category | flex
	ExpectedIncome int64  // CRC
	FlexBudget     int64  // CRC
	PlannedTotal   int64  // CRC (converted)
	LeftToBudget   int64  // ExpectedIncome - PlannedTotal
	ActualIncome   int64  // CRC
	ActualSpending int64  // CRC (positive)
	ActualSavings  int64  // ActualIncome - ActualSpending

	FixedPlanned      int64 // CRC
	FixedActual       int64 // CRC (positive)
	FlexibleActual    int64 // CRC (positive), vs FlexBudget
	NonMonthlyPlanned int64 // CRC
	NonMonthlyActual  int64 // CRC (positive)

	CategoryGroups []PlanGroup
}
