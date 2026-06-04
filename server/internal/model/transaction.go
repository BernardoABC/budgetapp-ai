package model

type SplitRow struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category"`  // populated via JOIN on reads; ignored on writes
	Amount       int64  `json:"amount"`    // centimos
}

type Transaction struct {
	ID           string
	AccountID    string
	CategoryID   string    // empty string if NULL
	CategoryName string    // populated via JOIN; empty if no category
	Date         string    // "YYYY-MM-DD"
	Amount       int64     // centimos; negative=outflow, positive=inflow
	Currency     string
	Payee        string
	Memo         string
	Cleared      bool
	Reconciled   bool
	ExchangeRate *float64  // nil if not stamped
	Splits       []SplitRow
}

type CreateTransactionReq struct {
	Date       string `json:"date"`
	Payee      string `json:"payee"`
	CategoryID string `json:"category_id"`
	Amount     int64  `json:"amount"` // signed minor units (negative = outflow)
	Memo       string `json:"memo"`
	Cleared    bool   `json:"cleared"`
}

type UpdateTransactionReq struct {
	Date       string     `json:"date"`
	Payee      string     `json:"payee"`
	CategoryID string     `json:"category_id"`
	Amount     int64      `json:"amount"` // signed minor units (negative = outflow)
	Memo       string     `json:"memo"`
	Cleared    bool       `json:"cleared"`
	Splits     []SplitRow `json:"splits"` // category_id + amount (centimos); nil/empty clears splits
}
