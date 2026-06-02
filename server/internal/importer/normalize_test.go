package importer

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"strips location code and OCN", "WALMART CURRIDABAT OCN00PSAN J", "WALMART CURRIDABAT"},
		{"strips colon and padding", "TEF A : 952432326             ", "TEF A 952432326"},
		{"uppercases and collapses", "Automercado   Escazu", "AUTOMERCADO ESCAZU"},
		{"preserves CURRIDABAT (no false suffix)", "AUTOMERCADO CURRIDABAT", "AUTOMERCADO CURRIDABAT"},
		{"empty stays empty", "   ", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Normalize(c.in); got != c.want {
				t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
