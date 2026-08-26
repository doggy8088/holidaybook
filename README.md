# Holidaybook - 台灣假日速查

Holidaybook 提供台灣假日資訊的完整取用方式：一個自訂網域的網頁 UI、一套靜態 JSON API、一支給人與 AI 代理人使用的 Go CLI，以及一份可分享的 repository skill。所有資料都是每日、每月、每年自動產生的靜態 JSON 檔案，來源是[臺北市資料大平臺](https://data.taipei/)的[臺北市政府行政機關辦公日曆表](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738)。

## 網站與 JSON API

主要網域是 `https://holiday.gh.miniasp.com`（由 GitHub Pages 搭配 `public/CNAME` 提供自訂網域服務）。網站本身提供查詢介面，同一份資料也可以直接以靜態 JSON 存取：

- 單日查詢：`https://holiday.gh.miniasp.com/{YYYY-MM-DD}.json`
  例如 `https://holiday.gh.miniasp.com/2025-10-10.json`
- 月份查詢（回傳當月每一天的物件陣列）：`https://holiday.gh.miniasp.com/{YYYY-MM}.json`
  例如 `https://holiday.gh.miniasp.com/2025-10.json`
- 年度查詢（回傳當年每一天的物件陣列）：`https://holiday.gh.miniasp.com/{YYYY}.json`
  例如 `https://holiday.gh.miniasp.com/2025.json`

單日 JSON 範例：

```json
{"_id":1529,"date":"20251010","name":"國慶日","isHoliday":1,"holidaycategory":"放假之紀念日及節日","description":"全國各機關學校放假一日。"}
```

> 靜態 API 的日期欄位是 `YYYYMMDD`（不含連字號），假別欄位名稱是 `holidaycategory`；下方的 CLI 會把它們正規化成較好用的欄位名稱。

## 安裝 CLI

CLI 目前僅透過 GitHub Releases 發布可執行檔（不提供 Homebrew、apt、winget 等套件管理員安裝方式）。

### macOS / Linux

以 `install.sh` 下載最新版並安裝到 `~/.local/bin`（若 `HOME` 未設定則需自行指定 `--dir`）：

```sh
curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh
```

指定版本或安裝目錄（也可用環境變數 `HOLIDAYBOOK_INSTALL_DIR` 取代 `--dir`）：

```sh
curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh -s -- --version v1.0.0 --dir "$HOME/bin"
```

已 clone 專案時，也可以直接在本機執行腳本：

```sh
git clone https://github.com/doggy8088/holidaybook.git
cd holidaybook
sh install.sh --version v1.0.0 --dir "$HOME/bin"
```

安裝完成後，若安裝目錄已在 `PATH` 中，腳本會提示直接執行 `holidaybook --help`；否則會提示先把該目錄加入 `PATH`。

### Windows

以 `install.ps1` 下載最新版，預設安裝到 `%LOCALAPPDATA%\Programs\holidaybook`：

```powershell
irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex
```

指定版本或安裝目錄時，建議先下載腳本再帶參數執行（`-Version`、`-InstallDir`）：

```powershell
git clone https://github.com/doggy8088/holidaybook.git
cd holidaybook
./install.ps1 -Version v1.0.0 -InstallDir "$HOME\bin"
```

安裝完成後，若安裝目錄已在 `PATH` 中可直接執行 `holidaybook --help`；否則腳本會提示加入 `PATH`，或直接以完整路徑執行 `& "<InstallDir>\holidaybook.exe" --help`。

## CLI 使用方式

人類可讀輸出：

```console
$ holidaybook 2025-10-10
2025-10-10：放假（國慶日）
類別：放假之紀念日及節日
說明：全國各機關學校放假一日。

$ holidaybook 2025-10-14
2025-10-14：上班日

$ holidaybook 2025-09-03
2025-09-03：上班日（軍人節）
類別：特定節日
說明：軍人依國防部規定辦理。
```

機器可讀輸出（`--json`，方便串接腳本或代理人）：

```console
$ holidaybook --json 2025-10-10
{"date":"2025-10-10","isHoliday":true,"name":"國慶日","category":"放假之紀念日及節日","description":"全國各機關學校放假一日。"}

$ holidaybook --json 2025-10-14
{"date":"2025-10-14","isHoliday":false,"name":"","category":"","description":""}
```

### 參數

| 參數 | 說明 |
| --- | --- |
| `--json` | 輸出機器可讀 JSON（成功與錯誤都會是 JSON），適合腳本與代理人使用 |
| `--base-url URL` | 覆寫預設來源網域，預設為 `https://holiday.gh.miniasp.com` |
| `--timeout DURATION` | 覆寫連線逾時時間（Go duration 格式，例如 `10s`），預設 10 秒 |
| `--version` | 印出目前版本後結束 |
| `--help`（或 `-h`） | 印出用法後結束 |

參數與日期參數（`YYYY-MM-DD`）可以任意前後順序混用。若自訂網域尚未生效，可加上 `--base-url https://doggy8088.github.io/holidaybook` 直接查詢 GitHub Pages 上的同一份資料。

### 錯誤與結束碼（適合寫腳本判斷）

- `0`：查詢成功
- `2`：命令列參數錯誤（例如缺少日期、日期格式錯誤、`--base-url`／`--timeout` 設定無效、`--help`/`--version` 帶了多餘參數）
- `1`：執行期錯誤（連線逾時、網路錯誤、HTTP 非 2xx、回應內容不合法、查詢被中斷）

錯誤一律輸出到 stderr；加上 `--json` 時錯誤也會是 JSON，格式為 `{"error":{"code":"...","message":"..."}}`，`code` 可能是 `usage`、`invalid_date`、`invalid_configuration`、`http_error`、`invalid_response`、`timeout`、`canceled`、`network_error`、`output_error` 之一。查無資料的日期（超出資料範圍）會是 HTTP 404，也就是 `http_error`。

## 給 AI 代理人使用

CLI 的 `--json` 輸出是穩定的代理人介面，欄位固定為：

- `date`：`YYYY-MM-DD`
- `isHoliday`：布林值
- `name`：假期或節日名稱（沒有對應名稱時為空字串）
- `category`：假別，例如「星期六、星期日」「放假之紀念日及節日」「補行上班日」（沒有時為空字串）
- `description`：說明文字（沒有時為空字串）

上班日不一定所有欄位都是空的：補班日會有 `category`，軍人節則同時有 `name` 與 `description`。

> 注意：CLI 輸出的欄位是 `category`；若直接讀取靜態 JSON API（`docs/*.json` / `https://holiday.gh.miniasp.com/*.json`），該欄位名稱是 `holidaycategory`，且 `date` 是 `YYYYMMDD`、`isHoliday` 是 `0`/`1` 整數。

### Repository skill

專案內建可分享的 agent skill：[`.github/skills/query-taiwan-holiday`](.github/skills/query-taiwan-holiday/SKILL.md)（含 `SKILL.md` 查詢/錯誤處理慣例，以及 `agents/openai.yaml` 介面中繼資料）。任何支援 repository skills 的代理人都可以直接載入使用，範例提示（取自 `agents/openai.yaml` 的 `default_prompt`）：

> Use `$query-taiwan-holiday` to check whether a specific Taiwan date is a holiday or workday and return structured data.

該 skill 的行為：優先使用已安裝的 `holidaybook --json YYYY-MM-DD`；若 CLI 不可用，才 fallback 到直接 `curl` 靜態 JSON（`https://holiday.gh.miniasp.com/YYYY-MM-DD.json`），並要求代理人解析 JSON 而非用文字比對、日期需先驗證為合法的 `YYYY-MM-DD`、查詢失敗時明確回報而不臆測。

## 假日資料的注意事項

- 不要用「星期六、星期日」自行推論放假狀態；請一律以資料中的 `isHoliday` 為準（台灣有補班日與補假日，週末不一定等於放假、平日也不一定等於上班）。
- 上班日也可能帶有資訊：例如補班日的 `holidaycategory`／`category` 是「補行上班日」，軍人節則是 `isHoliday` 為否、但仍有 `name` 與 `description`。
- 超出來源日曆表已公告範圍的日期（通常是尚未公告的年度）會先產生為正常上班日，實際放假規則仍以政府公告為準。
- 有些節日不是所有人都放假：
  1. **軍人節**：只有軍人才放假，本系統已將軍人節設定為非假日（`isHoliday` 為 `0`／`false`）。
  2. **勞動節**：只有勞工才放假。

## 開發

### Go CLI

```sh
gofmt -l $(git ls-files '*.go')   # 檢查格式（有輸出代表需要 gofmt）
go test ./...                    # 執行單元測試
go vet ./...                     # 靜態檢查
go build -o holidaybook ./cmd/holidaybook   # 建置執行檔
```

### .NET 8 靜態產生器

1. 下載專案

    ```sh
    git clone https://github.com/doggy8088/holidaybook.git
    cd holidaybook
    ```

2. 還原、建置、測試

    ```sh
    cd StaticGenerator && dotnet restore
    cd ../StaticGenerator.Tests && dotnet restore
    cd ../StaticGenerator && dotnet build --configuration Release --no-restore
    cd ../StaticGenerator.Tests && dotnet test --configuration Release --no-restore --verbosity normal
    ```

3. 產生資料（會清空並重建 `docs/`）

    ```sh
    cd StaticGenerator
    dotnet run --configuration Release
    ```

4. 查看產生的檔案

    ```sh
    ls docs/
    cat docs/2025-10-10.json
    ```

`StaticGenerator/appsettings.json` 目前設定：

- `DataSource.ApiUrl`：臺北市資料大平臺開放資料 API
- `DataSource.TestDataPath`：API 失敗時的備援資料檔 `test-data.json`（未包含於此 repository，需自行提供）
- `Generation.OutputDirectory`：`../docs`
- `Generation.StartDate`：`2024-01-01`
- `Generation.YearsToGenerate`：`2`（每次執行時，結束日期＝執行當下起算未來 2 年，並非固定年份；因此資料涵蓋範圍會隨執行時間往後推進）

## CI/CD

- **PR CI 與 master push**（`.github/workflows/ci.yml`）：對 Pull Request、push 到 `master` 或手動觸發時執行 `gofmt` 格式檢查、`go test ./...`、`go vet ./...`、`install.sh` 語法檢查（`bash -n`）、`install.ps1` 語法檢查（PowerShell parser）、`goreleaser check`、macOS／Linux／Windows × amd64／arm64 六種組合的交叉建置，以及 `.NET` 產生器單元測試。
- **發布**（`.github/workflows/release.yml`）：推送符合 `v*` 的 tag 時觸發，先跑 `go test ./...`，再用 [GoReleaser](.goreleaser.yml) 建置並發布 GitHub Release，產出 macOS／Linux／Windows（amd64／arm64）共 6 組壓縮檔（`holidaybook_<os>_<arch>.tar.gz`，Windows 為 `.zip`）與 `checksums.txt`（SHA-256），`install.sh`／`install.ps1` 都會下載並驗證這份 checksum。維護者發布新版時，建立並推送一個帶註解的 tag 即可觸發；以下以尚未發布的下一版 `v1.0.1` 為例：

  ```sh
  git tag -a v1.0.1 -m "holidaybook v1.0.1"
  git push origin v1.0.1
  ```

- **每日資料更新**（`.github/workflows/generate-data.yml`）：每天 UTC 02:00（台灣時間上午 10 點）以及手動觸發時執行，還原、建置、測試並執行 `StaticGenerator`，若 `docs/` 有變更就自動 commit 並 push；產生失敗時，若已設定 SendGrid 相關 secrets 會寄出通知信，並讓該次工作流程回報失敗。
- **GitHub Pages 部署**（`.github/workflows/deploy-pages.yml`）：`public/**`、`docs/*.json` 有變更或手動觸發時執行，將 `public/` 內容與 `docs/` 下的頂層 `*.json` 檔案一起組成 `_site/`，確認 `index.html` 與 `CNAME`（內容需為 `holiday.gh.miniasp.com`）存在後，部署到 GitHub Pages。

### GitHub Actions 所需設定

- `PAT`：具備 `repo` 權限的 Personal Access Token，供 `generate-data.yml` 用來推送變更；沒有設定時會 fallback 使用預設的 `GITHUB_TOKEN`，但用 `GITHUB_TOKEN` 推送不會觸發 `deploy-pages.yml`，需改用手動觸發或設定 `PAT`。
- `SENDGRID_API_KEY`、`NOTIFICATION_EMAIL`：設定後，資料產生失敗時會透過 SendGrid 寄出錯誤通知信；`FROM_EMAIL`（可選，預設為 `noreply@github.com`）。未設定這兩個必要 secrets 時只會在 log 中略過寄信，不影響失敗回報。

## GitHub Pages 自訂網域

網站以 `public/CNAME`（內容為 `holiday.gh.miniasp.com`）設定 GitHub Pages 的自訂網域；`deploy-pages.yml` 會在部署前驗證這個檔案內容正確無誤。要讓網域生效，需在 DNS 供應商為 `holiday.gh.miniasp.com` 設定指向 GitHub Pages 的 `CNAME` 紀錄，並在 repository 的 Pages 設定中啟用該自訂網域與 HTTPS。

## 資料來源

- API：2024～2028 年（依執行當下持續往後延伸）所有假期的網址：
  - <https://data.taipei/api/v1/dataset/0dcbcfcf-f7a1-4664-a810-82c01cb524e0?scope=resourceAquire&offset=1316&limit=1000>
- [臺北市資料大平臺](https://data.taipei/)
  - [臺北市政府行政機關辦公日曆表](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738)
