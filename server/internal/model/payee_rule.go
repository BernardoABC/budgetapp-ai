package model

type PayeeRule struct {
	ID         string
	Pattern    string
	CategoryID string
	MatchCount int
}
