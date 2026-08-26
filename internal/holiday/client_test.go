package holiday

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchDay(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantHoliday bool
		wantName    string
	}{
		{
			name:        "holiday",
			body:        `{"_id":1652,"date":"20261010","name":"國慶日","isHoliday":1,"holidaycategory":"放假之紀念日及節日","description":"全國各機關學校放假一日。"}`,
			wantHoliday: true,
			wantName:    "國慶日",
		},
		{
			name:        "workday",
			body:        `{"_id":0,"date":"20261010","name":"","isHoliday":0,"holidaycategory":"","description":""}`,
			wantHoliday: false,
			wantName:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/2026-10-10.json" {
					t.Errorf("path = %q", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			client, err := NewClient(server.URL, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			got, err := client.FetchDay(context.Background(), "2026-10-10")
			if err != nil {
				t.Fatal(err)
			}
			if got.Date != "2026-10-10" || got.IsHoliday != tt.wantHoliday || got.Name != tt.wantName {
				t.Fatalf("FetchDay() = %+v", got)
			}
		})
	}
}

func TestFetchDayErrors(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		body       string
	}{
		{name: "HTTP error", statusCode: http.StatusServiceUnavailable, body: `unavailable`},
		{name: "malformed JSON", statusCode: http.StatusOK, body: `{"date":`},
		{name: "empty response", statusCode: http.StatusOK, body: ``},
		{name: "missing fields", statusCode: http.StatusOK, body: `{}`},
		{name: "wrong date", statusCode: http.StatusOK, body: `{"date":"20261011","isHoliday":1}`},
		{name: "invalid status", statusCode: http.StatusOK, body: `{"date":"20261010","isHoliday":2}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.statusCode)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			client, err := NewClient(server.URL, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.FetchDay(context.Background(), "2026-10-10")
			if err == nil {
				t.Fatal("FetchDay() error = nil")
			}
			if tt.statusCode != http.StatusOK {
				var statusErr *HTTPStatusError
				if !errors.As(err, &statusErr) || statusErr.StatusCode != tt.statusCode {
					t.Fatalf("FetchDay() error = %v", err)
				}
			}
		})
	}
}

func TestFetchDayTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(100 * time.Millisecond)
		_, _ = w.Write([]byte(`{"date":"20261010","isHoliday":1}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL, 10*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.FetchDay(context.Background(), "2026-10-10")
	if err == nil {
		t.Fatal("FetchDay() error = nil")
	}
}

func TestFetchDayRejectsInvalidDate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request for %q", r.URL.Path)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	for _, date := range []string{"2026-13-01", "../secret", "2026-10-10?x=1"} {
		if _, err := client.FetchDay(context.Background(), date); err == nil {
			t.Errorf("FetchDay(%q) error = nil", date)
		}
	}
}

func TestNewClientRejectsInvalidBaseURL(t *testing.T) {
	for _, baseURL := range []string{"", "example.com", "ftp://example.com", "https://example.com?a=b", "https://example.com#frag"} {
		if _, err := NewClient(baseURL, time.Second); err == nil {
			t.Errorf("NewClient(%q) error = nil", baseURL)
		}
	}
	if _, err := NewClient("https://example.com/", 0); err == nil {
		t.Error("NewClient() with zero timeout error = nil")
	}
}

func TestValidateDate(t *testing.T) {
	if err := ValidateDate("2024-02-29"); err != nil {
		t.Fatalf("valid date rejected: %v", err)
	}
	for _, date := range []string{"2026-2-01", "2026-02-30", "not-a-date"} {
		if err := ValidateDate(date); err == nil {
			t.Errorf("ValidateDate(%q) error = nil", date)
		}
	}
}
