package holiday

import (
	"errors"
	"regexp"
	"time"
)

var isoDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func ValidateDate(value string) error {
	if !isoDatePattern.MatchString(value) {
		return errors.New("date must use YYYY-MM-DD format")
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil || parsed.Format("2006-01-02") != value {
		return errors.New("date is not a valid calendar date")
	}
	return nil
}
