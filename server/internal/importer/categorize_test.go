package importer

import "testing"

func TestCategorize(t *testing.T) {
	rules := []Rule{
		{Pattern: "AUTOMERCADO ESCAZU", CategoryID: "groceries"},
		{Pattern: "OFFICE DEPOT PLAZA CRONOS", CategoryID: "office"},
	}

	t.Run("exact is HIGH", func(t *testing.T) {
		s := Categorize("AUTOMERCADO ESCAZU", rules)
		if s.CategoryID != "groceries" || s.Confidence != ConfidenceHigh {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("prefix is MEDIUM", func(t *testing.T) {
		s := Categorize("AUTOMERCADO ESCAZU PLAZA", rules)
		if s.CategoryID != "groceries" || s.Confidence != ConfidenceMedium {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("near match is LOW", func(t *testing.T) {
		s := Categorize("OFFICE DEPOT PLAZA CRONOSSAN", rules)
		if s.CategoryID != "office" || s.Confidence != ConfidenceLow {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("no match is NONE", func(t *testing.T) {
		s := Categorize("COMPLETELY UNRELATED STRING", rules)
		if s.Confidence != ConfidenceNone || s.CategoryID != "" {
			t.Errorf("got %+v", s)
		}
	})

	t.Run("empty input is NONE", func(t *testing.T) {
		if Categorize("", rules).Confidence != ConfidenceNone {
			t.Error("empty should be NONE")
		}
	})
}
