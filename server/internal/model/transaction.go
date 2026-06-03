package model

type Transaction struct {
	ID           string
	AccountID    string
	CategoryID   string  // empty string if NULL
	CategoryName string  // populated via JOIN; empty if no category
	Date         string  // "YYYY-MM-DD"
	Amount       int64   // centimos; negative=outflow, positive=inflow
	Currency     string
	Payee        string
	Memo         string
	Cleared      bool
	ExchangeRate *float64 // nil if not stamped
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
	Date       string `json:"date"`
	Payee      string `json:"payee"`
	CategoryID string `json:"category_id"`
	Amount     int64  `json:"amount"` // signed minor units (negative = outflow)
	Memo       string `json:"memo"`
	Cleared    bool   `json:"cleared"`
}
