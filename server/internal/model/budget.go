// server/internal/model/budget.go
package model

type ActivityEntry struct {
	Currency        string `json:"currency"`
	Amount          int64  `json:"amount"`
	ConvertedAmount int64  `json:"converted_amount"`
}

type Target struct {
	Type     string  // "monthly" | "refill" | "savings"
	Amount   int64   // minor units in category's native currency
	Deadline *string // YYYY-MM-DD; nil unless type == "savings"
}

type CategoryBudget struct {
	ID                string
	Name              string
	Currency          string
	Assigned          int64
	Activity          int64
	CarryIn           int64
	Available         int64 // CarryIn + Assigned + Activity
	Target            *Target
	Underfunded       int64
	ActivityBreakdown []ActivityEntry
}

type RTABreakdown struct {
	CRCAccounts    int64 `json:"crc_accounts"`
	USDAccountsCRC int64 `json:"usd_accounts_in_crc"`
	USDNative      int64 `json:"usd_accounts_native"`
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
	RTABreakdown     RTABreakdown
	AgeOfMoney       *int // days; nil if no outflow data
	TotalUnderfunded int64
	CategoryGroups   []CategoryGroupBudget
}
