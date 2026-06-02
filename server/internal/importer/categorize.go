package importer

import "strings"

// Confidence expresses how sure a categorization suggestion is.
type Confidence string

const (
	ConfidenceHigh   Confidence = "HIGH"
	ConfidenceMedium Confidence = "MEDIUM"
	ConfidenceLow    Confidence = "LOW"
	ConfidenceNone   Confidence = "NONE"
)

// Rule is a normalized payee pattern mapped to a category. The import service
// builds these from the payee_rules table; the categorizer stays DB-free.
type Rule struct {
	Pattern    string // already normalized
	CategoryID string
}

// Suggestion is the categorizer's output for one description.
type Suggestion struct {
	CategoryID string
	Confidence Confidence
}

const fuzzyThreshold = 0.6

// Categorize matches a normalized description against rules in tiers:
// exact -> HIGH, prefix (either direction) -> MEDIUM, trigram-similar -> LOW, else NONE.
func Categorize(normalizedDesc string, rules []Rule) Suggestion {
	if normalizedDesc == "" || len(rules) == 0 {
		return Suggestion{Confidence: ConfidenceNone}
	}
	for _, r := range rules {
		if r.Pattern == normalizedDesc {
			return Suggestion{CategoryID: r.CategoryID, Confidence: ConfidenceHigh}
		}
	}
	for _, r := range rules {
		if r.Pattern == "" {
			continue
		}
		if isPrefixMatch(normalizedDesc, r.Pattern) || isPrefixMatch(r.Pattern, normalizedDesc) {
			return Suggestion{CategoryID: r.CategoryID, Confidence: ConfidenceMedium}
		}
	}
	best, bestID := 0.0, ""
	for _, r := range rules {
		if sim := trigramSimilarity(normalizedDesc, r.Pattern); sim > best {
			best, bestID = sim, r.CategoryID
		}
	}
	if best >= fuzzyThreshold {
		return Suggestion{CategoryID: bestID, Confidence: ConfidenceLow}
	}
	return Suggestion{Confidence: ConfidenceNone}
}

// isPrefixMatch returns true when s starts with prefix and the match ends at a
// word boundary (end of s, or followed by a space). This avoids matching
// "CRONOS" as a word-prefix of "CRONOSSAN".
func isPrefixMatch(s, prefix string) bool {
	if !strings.HasPrefix(s, prefix) {
		return false
	}
	rest := s[len(prefix):]
	return rest == "" || strings.HasPrefix(rest, " ")
}

func trigramSet(s string) map[string]struct{} {
	r := []rune(" " + s + " ")
	set := make(map[string]struct{})
	for i := 0; i+3 <= len(r); i++ {
		set[string(r[i:i+3])] = struct{}{}
	}
	return set
}

// trigramSimilarity is the Dice coefficient over character trigrams (0..1).
func trigramSimilarity(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	ta, tb := trigramSet(a), trigramSet(b)
	if len(ta) == 0 || len(tb) == 0 {
		return 0
	}
	inter := 0
	for t := range ta {
		if _, ok := tb[t]; ok {
			inter++
		}
	}
	return 2 * float64(inter) / float64(len(ta)+len(tb))
}
