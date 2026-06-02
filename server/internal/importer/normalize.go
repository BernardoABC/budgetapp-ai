package importer

import (
	"regexp"
	"strings"
)

var (
	ocnCodeRe  = regexp.MustCompile(`OCN\d+P`)
	suffixRe   = regexp.MustCompile(`\b(SAN J|LIBER|CURRI|SANTA|FAC)\b`)
	nonAlnumRe = regexp.MustCompile(`[^A-Z0-9\s]`)
	whitespace = regexp.MustCompile(`\s+`)
)

// Normalize cleans a raw bank description into a stable key for rule matching:
// uppercase, strip OCN commerce codes and known location suffixes, drop
// punctuation, collapse whitespace. It is the single source of truth for the
// payee-rule key and duplicate-detection key.
func Normalize(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = ocnCodeRe.ReplaceAllString(s, " ")
	s = suffixRe.ReplaceAllString(s, " ")
	s = nonAlnumRe.ReplaceAllString(s, " ")
	s = whitespace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}
