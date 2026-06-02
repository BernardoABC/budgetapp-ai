// Package importer parses bank statement exports into a normalized, format-agnostic
// shape and provides payee normalization + auto-categorization. It has no database
// or HTTP dependencies and is fully unit-tested.
package importer

import "io"

// Parser turns raw statement bytes into a normalized statement. One implementation
// per bank/format (e.g. BACCSVParser). Adding a format means adding a Parser; the
// categorizer and import service never change.
type Parser interface {
	Parse(r io.Reader) (ParsedStatement, error)
}

// ParsedStatement is the normalized result of parsing one statement file.
// All monetary values are in the statement currency's minor units.
type ParsedStatement struct {
	Currency         string // "CRC" | "USD"; "" if the format carries no currency
	IBAN             string
	OpeningBalance   int64
	AvailableBalance int64
	StatementDate    string // "YYYY-MM-DD"; "" if absent
	Transactions     []ParsedTxn
}

// ParsedTxn is one normalized transaction line.
type ParsedTxn struct {
	Date            string // "YYYY-MM-DD"
	Amount          int64  // signed minor units (negative = outflow)
	DescriptionRaw  string // exactly as in the file, padding preserved
	Reference       string
	TransactionCode string // e.g. "TF", "CP", "PP"
	RunningBalance  int64  // minor units; for optional reconciliation
}
