package model

type Account struct {
	ID        string
	Name      string
	Type      string
	Currency  string
	Balance   int64 // centimos in DB
	OnBudget  bool
	Closed    bool
	Note      string
	SortOrder int
}

type CreateAccountReq struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Currency  string `json:"currency"`
	Balance   int64  `json:"balance"` // minor units of the account currency (CRC centimos / USD cents)
	OnBudget  bool   `json:"on_budget"`
	Note      string `json:"note"`
	SortOrder int    `json:"sort_order"`
}

type UpdateAccountReq struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Currency  string `json:"currency"`
	OnBudget  bool   `json:"on_budget"`
	Note      string `json:"note"`
	SortOrder int    `json:"sort_order"`
}
