package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/encoding/charmap"
)

// BACCSVParser parses BAC (Banco BAC Credomatic) CSV statement exports, which are
// Latin-1 encoded and structured as: account header, "Detalle de Estado Bancario"
// transaction section, and a "Resumen de Estado Bancario" footer.
type BACCSVParser struct{}

func (BACCSVParser) Parse(r io.Reader) (ParsedStatement, error) {
	cr := csv.NewReader(charmap.ISO8859_1.NewDecoder().Reader(r))
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true
	cr.LazyQuotes = true // bank descriptions occasionally contain stray quote characters
	records, err := cr.ReadAll()
	if err != nil {
		return ParsedStatement{}, fmt.Errorf("read csv: %w", err)
	}

	var stmt ParsedStatement
	section := "header"
	headerParsed := false

	for i, rec := range records {
		if len(rec) == 0 {
			continue
		}
		first := strings.TrimSpace(rec[0])

		switch section {
		case "header":
			if strings.HasPrefix(first, "Detalle de Estado Bancario") {
				section = "detail-cols"
				continue
			}
			// The account data row is the one whose currency field is CRC/USD
			// (the column-name row has "Moneda" there).
			if !headerParsed && len(rec) >= 9 && isAccountDataRow(rec) {
				stmt.Currency = strings.TrimSpace(rec[3])
				stmt.IBAN = strings.TrimSpace(rec[2])
				stmt.OpeningBalance = amountOrZero(rec[4])
				stmt.AvailableBalance = amountOrZero(rec[7])
				if d, err := parseDateDDMMYYYY(rec[8]); err == nil {
					stmt.StatementDate = d
				}
				headerParsed = true
			}
		case "detail-cols":
			// This is the transaction column-header row; skip exactly one.
			section = "detail"
		case "detail":
			if strings.HasPrefix(first, "Resumen de Estado Bancario") {
				section = "done"
				continue
			}
			txn, ok, err := parseBACDetailRow(rec)
			if err != nil {
				return stmt, fmt.Errorf("row %d: %w", i+1, err)
			}
			if ok {
				stmt.Transactions = append(stmt.Transactions, txn)
			}
		case "done":
			// summary rows ignored
		}
	}
	return stmt, nil
}

func isAccountDataRow(rec []string) bool {
	c := strings.TrimSpace(rec[3])
	return c == "CRC" || c == "USD"
}

func parseBACDetailRow(rec []string) (ParsedTxn, bool, error) {
	if len(rec) < 7 {
		return ParsedTxn{}, false, nil
	}
	debit, err := parseAmount(rec[4])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	credit, err := parseAmount(rec[5])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	if debit == 0 && credit == 0 {
		return ParsedTxn{}, false, nil // empty/blank row
	}
	date, err := parseDateDDMMYYYY(rec[0])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	balance, err := parseAmount(rec[6])
	if err != nil {
		return ParsedTxn{}, false, err
	}
	return ParsedTxn{
		Date:            date,
		Amount:          credit - debit, // credit = inflow (+), debit = outflow (-)
		DescriptionRaw:  rec[3],
		Reference:       strings.TrimSpace(rec[1]),
		TransactionCode: strings.TrimSpace(rec[2]),
		RunningBalance:  balance,
	}, true, nil
}

// parseAmount converts a decimal string like "367.00" to minor units (36700).
func parseAmount(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	s = strings.ReplaceAll(s, ",", "") // tolerate thousands separators
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("parse amount %q: %w", s, err)
	}
	return int64(math.Round(f * 100)), nil
}

func amountOrZero(s string) int64 {
	v, _ := parseAmount(s)
	return v
}

// parseDateDDMMYYYY converts "01/04/2026" to "2026-04-01".
func parseDateDDMMYYYY(s string) (string, error) {
	t, err := time.Parse("02/01/2006", strings.TrimSpace(s))
	if err != nil {
		return "", fmt.Errorf("parse date %q: %w", s, err)
	}
	return t.Format("2006-01-02"), nil
}
