package cli

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/doggy8088/holidaybook/internal/holiday"
)

const (
	ExitOK      = 0
	ExitRuntime = 1
	ExitUsage   = 2
)

type options struct {
	baseURL string
	timeout time.Duration
	json    bool
	version bool
	help    bool
}

type errorOutput struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func Run(ctx context.Context, args []string, stdout, stderr io.Writer, version string) int {
	opts, date, err := parseArgs(args)
	if err != nil {
		writeError(stderr, opts.json, "usage", err.Error())
		return ExitUsage
	}
	if opts.help {
		writeUsage(stdout)
		return ExitOK
	}
	if opts.version {
		fmt.Fprintf(stdout, "holidaytw %s\n", version)
		return ExitOK
	}
	if err := holiday.ValidateDate(date); err != nil {
		writeError(stderr, opts.json, "invalid_date", "日期格式錯誤：請使用有效的 YYYY-MM-DD 日期")
		return ExitUsage
	}

	client, err := holiday.NewClient(opts.baseURL, opts.timeout)
	if err != nil {
		writeError(stderr, opts.json, "invalid_configuration", "設定錯誤："+err.Error())
		return ExitUsage
	}
	day, err := client.FetchDay(ctx, date)
	if err != nil {
		code, message := fetchError(err)
		writeError(stderr, opts.json, code, message)
		return ExitRuntime
	}

	if opts.json {
		encoder := json.NewEncoder(stdout)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(day); err != nil {
			writeError(stderr, true, "output_error", "無法輸出查詢結果")
			return ExitRuntime
		}
		return ExitOK
	}

	writeHuman(stdout, day)
	return ExitOK
}

func parseArgs(args []string) (options, string, error) {
	opts := options{
		baseURL: holiday.DefaultBaseURL,
		timeout: holiday.DefaultTimeout,
	}
	flags := flag.NewFlagSet("holidaytw", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&opts.baseURL, "base-url", opts.baseURL, "")
	flags.DurationVar(&opts.timeout, "timeout", opts.timeout, "")
	flags.BoolVar(&opts.json, "json", false, "")
	flags.BoolVar(&opts.version, "version", false, "")
	flags.BoolVar(&opts.help, "help", false, "")
	// Register -h explicitly; flag.ErrHelp would otherwise bypass the argument checks below.
	flags.BoolVar(&opts.help, "h", false, "")

	normalized, err := normalizeArgs(args)
	if err != nil {
		return opts, "", err
	}
	if err := flags.Parse(normalized); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			opts.help = true
			return opts, "", nil
		}
		return opts, "", errors.New("無效的命令列參數（請用 --help 查看用法）")
	}
	if opts.help || opts.version {
		if flags.NArg() != 0 {
			return opts, "", errors.New("--help 與 --version 不接受日期參數")
		}
		return opts, "", nil
	}
	if flags.NArg() != 1 {
		return opts, "", errors.New("請提供一個 YYYY-MM-DD 日期")
	}
	return opts, flags.Arg(0), nil
}

// normalizeArgs lets users place flags before or after the positional date.
func normalizeArgs(args []string) ([]string, error) {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json" || arg == "--version" || arg == "--help":
			flags = append(flags, arg)
		case arg == "--base-url" || arg == "--timeout":
			if i+1 >= len(args) {
				return nil, fmt.Errorf("%s 需要一個值", arg)
			}
			flags = append(flags, arg, args[i+1])
			i++
		case strings.HasPrefix(arg, "--base-url=") || strings.HasPrefix(arg, "--timeout="):
			flags = append(flags, arg)
		case strings.HasPrefix(arg, "-"):
			flags = append(flags, arg)
		default:
			positional = append(positional, arg)
		}
	}
	return append(flags, positional...), nil
}

func writeUsage(w io.Writer) {
	fmt.Fprintln(w, "用法：holidaytw [--json] [--base-url URL] [--timeout 10s] YYYY-MM-DD")
	fmt.Fprintln(w, "      holidaytw --version")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "選項：")
	fmt.Fprintln(w, "  --json             輸出機器可讀 JSON（成功與錯誤皆為 JSON）")
	fmt.Fprintf(w, "  --base-url URL     覆寫資料來源，預設 %s\n", holiday.DefaultBaseURL)
	fmt.Fprintf(w, "  --timeout DURATION 覆寫連線逾時，預設 %s\n", holiday.DefaultTimeout)
	fmt.Fprintln(w, "  --version          顯示版本")
	fmt.Fprintln(w, "  --help, -h         顯示此說明")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "結束碼：0 成功、1 執行期錯誤、2 參數錯誤")
}

func writeHuman(w io.Writer, day holiday.Day) {
	label := "上班日"
	if day.IsHoliday {
		label = "放假"
	}
	if day.Name != "" {
		label += "（" + day.Name + "）"
	}
	fmt.Fprintf(w, "%s：%s\n", day.Date, label)
	if day.Category != "" {
		fmt.Fprintf(w, "類別：%s\n", day.Category)
	}
	if day.Description != "" {
		fmt.Fprintf(w, "說明：%s\n", day.Description)
	}
}

func writeError(w io.Writer, machine bool, code, message string) {
	if !machine {
		fmt.Fprintln(w, "錯誤："+message)
		return
	}

	var output errorOutput
	output.Error.Code = code
	output.Error.Message = message
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(output)
}

func fetchError(err error) (string, string) {
	var statusErr *holiday.HTTPStatusError
	var responseErr *holiday.ResponseError
	switch {
	case errors.As(err, &statusErr):
		return "http_error", "假日服務回傳 HTTP " + strconv.Itoa(statusErr.StatusCode)
	case errors.As(err, &responseErr):
		return "invalid_response", "假日服務回傳無效資料"
	case errors.Is(err, context.Canceled):
		return "canceled", "查詢已取消"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout", "連線假日服務逾時"
	default:
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			return "timeout", "連線假日服務逾時"
		}
		return "network_error", "無法連線假日服務"
	}
}
