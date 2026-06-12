package model

type ExchangeRate struct {
	ID        string
	Date      string // YYYY-MM-DD
	USDToCRC  float64
	Source    string // "BCCR", "open_er_api", "manual"
	CreatedAt string
}
