package model

type DateRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type ImportFileInfo struct {
	Filename         string    `json:"filename"`
	Currency         string    `json:"currency"`
	IBAN             string    `json:"iban"`
	OpeningBalance   int64     `json:"opening_balance"`
	AvailableBalance int64     `json:"available_balance"`
	StatementDate    string    `json:"statement_date"`
	TransactionCount int       `json:"transaction_count"`
	DateRange        DateRange `json:"date_range"`
	TotalInflow      int64     `json:"total_inflow"`
	TotalOutflow     int64     `json:"total_outflow"`
	CurrencyMismatch bool      `json:"currency_mismatch"`
}

type PreviewTxn struct {
	TempID                string  `json:"temp_id"`
	Date                  string  `json:"date"`
	Amount                int64   `json:"amount"`
	DescriptionRaw        string  `json:"description_raw"`
	DescriptionNormalized string  `json:"description_normalized"`
	Reference             string  `json:"reference"`
	TransactionCode       string  `json:"transaction_code"`
	Balance               int64   `json:"balance"`
	SuggestedCategoryID   *string `json:"suggested_category_id"`
	SuggestedConfidence   string  `json:"suggested_confidence"`
	DuplicateOf           *string `json:"duplicate_of"`
	IsTransfer            bool    `json:"is_transfer"`
}

type PreviewResponse struct {
	FileInfo     ImportFileInfo `json:"file_info"`
	Transactions []PreviewTxn   `json:"transactions"`
}

type ConfirmTxnReq struct {
	Include        bool    `json:"include"`
	Date           string  `json:"date"`
	Amount         int64   `json:"amount"`
	DescriptionRaw string  `json:"description_raw"`
	Reference      string  `json:"reference"`
	CategoryID     *string `json:"category_id"`
	PayeeOverride  *string `json:"payee_override"`
	Memo           *string `json:"memo"`
	IsTransfer     bool    `json:"is_transfer"`
}

type ConfirmReq struct {
	AccountID    string          `json:"account_id"`
	Filename     string          `json:"filename"`
	CsvCurrency  string          `json:"csv_currency"`
	Transactions []ConfirmTxnReq `json:"transactions"`
}

type ConfirmResponse struct {
	ImportID               string   `json:"import_id"`
	ImportedCount          int      `json:"imported_count"`
	SkippedCount           int      `json:"skipped_count"`
	NewRulesCreated        int      `json:"new_rules_created"`
	RulesUpdated           int      `json:"rules_updated"`
	TransferTransactionIDs []string `json:"transfer_transaction_ids"`
}

type ImportRecord struct {
	ID               string `json:"id"`
	AccountID        string `json:"account_id"`
	Filename         string `json:"filename"`
	ImportedAt       string `json:"imported_at"`
	TransactionCount int    `json:"transaction_count"`
	Status           string `json:"status"`
}
