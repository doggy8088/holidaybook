package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRunHumanHolidayAndWorkday(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "holiday",
			body: `{"date":"20261010","name":"國慶日","isHoliday":1,"holidaycategory":"國定假日","description":"放假一日。"}`,
			want: "2026-10-10：放假（國慶日）\n類別：國定假日\n說明：放假一日。\n",
		},
		{
			name: "workday",
			body: `{"date":"20261010","name":"","isHoliday":0,"holidaycategory":"","description":""}`,
			want: "2026-10-10：上班日\n",
		},
		{
			name: "workday with details",
			body: `{"date":"20261010","name":"軍人節","isHoliday":0,"holidaycategory":"特定節日","description":"軍人依國防部規定辦理。"}`,
			want: "2026-10-10：上班日（軍人節）\n類別：特定節日\n說明：軍人依國防部規定辦理。\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newJSONServer(t, http.StatusOK, tt.body)
			defer server.Close()

			var stdout, stderr bytes.Buffer
			exitCode := Run(context.Background(), []string{"2026-10-10", "--base-url", server.URL}, &stdout, &stderr, "test")
			if exitCode != ExitOK {
				t.Fatalf("exit code = %d, stderr = %s", exitCode, stderr.String())
			}
			if stdout.String() != tt.want {
				t.Fatalf("stdout = %q, want %q", stdout.String(), tt.want)
			}
		})
	}
}

func TestRunMachineOutput(t *testing.T) {
	server := newJSONServer(t, http.StatusOK, `{"date":"20261010","name":"國慶日","isHoliday":1,"holidaycategory":"國定假日","description":"放假一日。"}`)
	defer server.Close()

	var stdout, stderr bytes.Buffer
	exitCode := Run(context.Background(), []string{"--json", "--base-url", server.URL, "2026-10-10"}, &stdout, &stderr, "test")
	if exitCode != ExitOK {
		t.Fatalf("exit code = %d, stderr = %s", exitCode, stderr.String())
	}

	var got map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON output: %v", err)
	}
	for _, key := range []string{"date", "isHoliday", "name", "category", "description"} {
		if _, ok := got[key]; !ok {
			t.Errorf("JSON output missing %q: %s", key, stdout.String())
		}
	}
	if got["date"] != "2026-10-10" || got["isHoliday"] != true {
		t.Fatalf("JSON output = %s", stdout.String())
	}
}

func TestRunInvalidDate(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := Run(context.Background(), []string{"--json", "2026-02-30"}, &stdout, &stderr, "test")
	if exitCode != ExitUsage {
		t.Fatalf("exit code = %d", exitCode)
	}
	if !strings.Contains(stderr.String(), `"code":"invalid_date"`) {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRunHTTPAndMalformedErrors(t *testing.T) {
	tests := []struct {
		name string
		code int
		body string
		want string
	}{
		{name: "HTTP error", code: http.StatusNotFound, body: `not found`, want: "HTTP 404"},
		{name: "malformed", code: http.StatusOK, body: `{`, want: "無效資料"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := newJSONServer(t, tt.code, tt.body)
			defer server.Close()

			var stdout, stderr bytes.Buffer
			exitCode := Run(context.Background(), []string{"--base-url", server.URL, "2026-10-10"}, &stdout, &stderr, "test")
			if exitCode != ExitRuntime {
				t.Fatalf("exit code = %d", exitCode)
			}
			if !strings.Contains(stderr.String(), tt.want) {
				t.Fatalf("stderr = %s", stderr.String())
			}
		})
	}
}

func TestRunVersion(t *testing.T) {
	var stdout, stderr bytes.Buffer
	exitCode := Run(context.Background(), []string{"--version"}, &stdout, &stderr, "1.2.3")
	if exitCode != ExitOK || stdout.String() != "holidaybook 1.2.3\n" || stderr.Len() != 0 {
		t.Fatalf("exit=%d stdout=%q stderr=%q", exitCode, stdout.String(), stderr.String())
	}
}

func TestRunHelpFlags(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"-h"}, {"-help"}, {"--h"}} {
		var stdout, stderr bytes.Buffer
		exitCode := Run(context.Background(), args, &stdout, &stderr, "test")
		if exitCode != ExitOK {
			t.Fatalf("Run(%v) exit = %d, stderr = %s", args, exitCode, stderr.String())
		}
		if !strings.Contains(stdout.String(), "用法：holidaybook") || stderr.Len() != 0 {
			t.Fatalf("Run(%v) stdout = %q stderr = %q", args, stdout.String(), stderr.String())
		}
		if !strings.Contains(stdout.String(), "-h") {
			t.Fatalf("Run(%v) usage output does not document -h: %q", args, stdout.String())
		}
	}
}

func TestRunUsageErrors(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "missing date", args: []string{"--json"}, want: `"code":"usage"`},
		{name: "two dates", args: []string{"--json", "2026-10-10", "2026-10-11"}, want: `"code":"usage"`},
		{name: "unknown flag", args: []string{"--json", "--nope"}, want: `"code":"usage"`},
		{name: "help with date", args: []string{"--json", "--help", "2026-10-10"}, want: `"code":"usage"`},
		{name: "short help with date", args: []string{"--json", "-h", "2026-10-10"}, want: `"code":"usage"`},
		{name: "short help with date reversed", args: []string{"--json", "2026-10-10", "-h"}, want: `"code":"usage"`},
		{name: "bad base url", args: []string{"--json", "--base-url", "ftp://example.com", "2026-10-10"}, want: `"code":"invalid_configuration"`},
		{name: "bad timeout", args: []string{"--json", "--timeout", "0s", "2026-10-10"}, want: `"code":"invalid_configuration"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			exitCode := Run(context.Background(), tt.args, &stdout, &stderr, "test")
			if exitCode != ExitUsage {
				t.Fatalf("exit code = %d, stderr = %s", exitCode, stderr.String())
			}
			if !strings.Contains(stderr.String(), tt.want) {
				t.Fatalf("stderr = %s", stderr.String())
			}
			if stdout.Len() != 0 {
				t.Fatalf("stdout = %q, want empty", stdout.String())
			}
		})
	}
}

func TestRunFlagsAfterDate(t *testing.T) {
	server := newJSONServer(t, http.StatusOK, `{"date":"20261010","name":"","isHoliday":0,"holidaycategory":"","description":""}`)
	defer server.Close()

	var stdout, stderr bytes.Buffer
	exitCode := Run(context.Background(), []string{"2026-10-10", "--json", "--base-url=" + server.URL, "--timeout=5s"}, &stdout, &stderr, "test")
	if exitCode != ExitOK {
		t.Fatalf("exit code = %d, stderr = %s", exitCode, stderr.String())
	}
	if !strings.Contains(stdout.String(), `"isHoliday":false`) {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestRunCanceledContext(t *testing.T) {
	server := newJSONServer(t, http.StatusOK, `{"date":"20261010","isHoliday":1}`)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	var stdout, stderr bytes.Buffer
	exitCode := Run(ctx, []string{"--json", "--base-url", server.URL, "2026-10-10"}, &stdout, &stderr, "test")
	if exitCode != ExitRuntime {
		t.Fatalf("exit code = %d", exitCode)
	}
	if !strings.Contains(stderr.String(), `"code":"canceled"`) {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestRunTimeoutError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"date":"20261010","isHoliday":1}`))
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	exitCode := Run(context.Background(), []string{"--json", "--base-url", server.URL, "--timeout", "20ms", "2026-10-10"}, &stdout, &stderr, "test")
	if exitCode != ExitRuntime {
		t.Fatalf("exit code = %d", exitCode)
	}
	if !strings.Contains(stderr.String(), `"code":"timeout"`) {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func newJSONServer(t *testing.T, statusCode int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/2026-10-10.json" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(body))
	}))
}
