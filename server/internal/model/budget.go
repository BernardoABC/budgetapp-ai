// server/internal/model/budget.go
package model

type Target struct {
	Type     string  // "monthly" | "refill" | "savings"
	Amount   int64   // CRC centimos
	Deadline *string // YYYY-MM-DD (first of deadline month); nil unless type == "savings"
}

type CategoryBudget struct {
	ID          string
	Name        string
	Assigned    int64
	Activity    int64
	CarryIn     int64
	Available   int64  // CarryIn + Assigned + Activity
	Target      *Target
	Underfunded int64
}

type CategoryGroupBudget struct {
	ID         string
	Name       string
	Assigned   int64
	Activity   int64
	Available  int64
	Categories []CategoryBudget
}

type BudgetMonth struct {
	Month            string
	ReadyToAssign    int64
	AgeOfMoney       *int // days; nil if no outflow data
	TotalUnderfunded int64
	CategoryGroups   []CategoryGroupBudget
}
