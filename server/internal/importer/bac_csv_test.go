package importer

import (
	"os"
	"testing"
)

func parseFixture(t *testing.T, name string) ParsedStatement {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer f.Close()
	stmt, err := BACCSVParser{}.Parse(f)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return stmt
}

func TestBACCSV_USD_Header(t *testing.T) {
	stmt := parseFixture(t, "bac_usd.csv")
	if stmt.Currency != "USD" {
		t.Errorf("currency = %q, want USD", stmt.Currency)
	}
	if stmt.IBAN != "CR88010200009342364982" {
		t.Errorf("iban = %q", stmt.IBAN)
	}
	if stmt.OpeningBalance != 5392620 {
		t.Errorf("opening = %d, want 5392620", stmt.OpeningBalance)
	}
	if stmt.StatementDate != "2026-03-31" {
		t.Errorf("statement date = %q, want 2026-03-31", stmt.StatementDate)
	}
}

func TestBACCSV_USD_Transactions(t *testing.T) {
	stmt := parseFixture(t, "bac_usd.csv")
	if len(stmt.Transactions) != 12 {
		t.Fatalf("len = %d, want 12", len(stmt.Transactions))
	}
	first := stmt.Transactions[0]
	if first.Date != "2026-04-01" {
		t.Errorf("date = %q, want 2026-04-01", first.Date)
	}
	if first.Amount != -36700 {
		t.Errorf("amount = %d, want -36700", first.Amount)
	}
	if first.Reference != "406471624" {
		t.Errorf("reference = %q", first.Reference)
	}
	if first.TransactionCode != "TF" {
		t.Errorf("code = %q, want TF", first.TransactionCode)
	}
	// The PP credit row (Invoice Telescoped) is a positive inflow.
	var credit ParsedTxn
	for _, tx := range stmt.Transactions {
		if tx.TransactionCode == "PP" {
			credit = tx
		}
	}
	if credit.Amount != 184616 {
		t.Errorf("credit amount = %d, want 184616", credit.Amount)
	}
}

func TestBACCSV_CRC_Currency(t *testing.T) {
	stmt := parseFixture(t, "bac_crc.csv")
	if stmt.Currency != "CRC" {
		t.Errorf("currency = %q, want CRC", stmt.Currency)
	}
	if len(stmt.Transactions) != 2 {
		t.Fatalf("len = %d, want 2", len(stmt.Transactions))
	}
	if stmt.Transactions[0].Amount != -500000 {
		t.Errorf("debit = %d, want -500000", stmt.Transactions[0].Amount)
	}
	if stmt.Transactions[1].Amount != 5000000 {
		t.Errorf("credit = %d, want 5000000", stmt.Transactions[1].Amount)
	}
}
