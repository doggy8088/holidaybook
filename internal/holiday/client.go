package holiday

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://holiday.gh.miniasp.com"
	DefaultTimeout = 10 * time.Second
	maxBodySize    = 1 << 20
)

type Day struct {
	Date        string `json:"date"`
	IsHoliday   bool   `json:"isHoliday"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
}

type HTTPStatusError struct {
	StatusCode int
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("holiday API returned HTTP %d", e.StatusCode)
}

type ResponseError struct {
	err error
}

func (e *ResponseError) Error() string {
	return "invalid holiday API response: " + e.err.Error()
}

func (e *ResponseError) Unwrap() error {
	return e.err
}

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
}

func NewClient(baseURL string, timeout time.Duration) (*Client, error) {
	if timeout <= 0 {
		return nil, errors.New("timeout must be greater than zero")
	}

	parsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return nil, fmt.Errorf("parse base URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("base URL must be an absolute HTTP or HTTPS URL")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("base URL must not contain a query or fragment")
	}

	return &Client{
		baseURL:    parsed,
		httpClient: &http.Client{Timeout: timeout},
	}, nil
}

func (c *Client) FetchDay(ctx context.Context, isoDate string) (Day, error) {
	if err := ValidateDate(isoDate); err != nil {
		return Day{}, err
	}

	endpoint := *c.baseURL
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/" + isoDate + ".json"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Day{}, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "holidaybook")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Day{}, fmt.Errorf("request holiday API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBodySize))
		return Day{}, &HTTPStatusError{StatusCode: resp.StatusCode}
	}

	var payload struct {
		Date        string `json:"date"`
		IsHoliday   *int   `json:"isHoliday"`
		Name        string `json:"name"`
		Category    string `json:"holidaycategory"`
		Description string `json:"description"`
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, maxBodySize))
	if err := decoder.Decode(&payload); err != nil {
		return Day{}, &ResponseError{err: err}
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Day{}, &ResponseError{err: err}
	}
	if payload.Date == "" || payload.IsHoliday == nil {
		return Day{}, &ResponseError{err: errors.New("missing required fields")}
	}
	if payload.Date != strings.ReplaceAll(isoDate, "-", "") {
		return Day{}, &ResponseError{err: errors.New("date does not match request")}
	}
	if *payload.IsHoliday != 0 && *payload.IsHoliday != 1 {
		return Day{}, &ResponseError{err: errors.New("invalid holiday status")}
	}

	return Day{
		Date:        isoDate,
		IsHoliday:   *payload.IsHoliday == 1,
		Name:        strings.TrimSpace(payload.Name),
		Category:    strings.TrimSpace(payload.Category),
		Description: strings.TrimSpace(payload.Description),
	}, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra json.RawMessage
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("response contains multiple JSON values")
	}
	return err
}
