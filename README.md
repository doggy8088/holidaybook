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

CLI 提供跨平台的 npm／npx wrapper，以及 GitHub Releases 原生執行檔安裝方式。npm wrapper 會在安裝時從同一個 GitHub Release 下載並驗證對應平台的 `holidaytw` 執行檔。

> **版本與命名遷移**：v1.0.0 發布的可執行檔名稱是 `holidaybook`；自 v2.0.0 起，可執行檔／指令名稱已更名為 **`holidaytw`**（GitHub repository 仍是 `doggy8088/holidaybook`、Go module 仍是 `github.com/doggy8088/holidaybook`，皆未變動）。安裝腳本的環境變數也從 `HOLIDAYBOOK_INSTALL_DIR` 改名為 `HOLIDAYTW_INSTALL_DIR`；為了讓舊使用者能平順遷移，安裝腳本仍會接受舊的 `HOLIDAYBOOK_INSTALL_DIR`，但只要有設定 `HOLIDAYTW_INSTALL_DIR`（或帶入 `--dir`／`-InstallDir`）就一律優先採用新名稱，安裝腳本從不刪除既有的 `holidaybook` 執行檔。

### npm / npx（跨平台推薦）

需要 Node.js **20 以上**。全域安裝後即可在任何終端機使用：

```sh
npm install -g holidaytw
holidaytw --json 2025-10-10
```

只想直接執行、不想修改全域 npm 安裝目錄：

```sh
npx holidaytw --json 2025-10-10
```

`npx` 與 npm wrapper 會自動選擇 macOS、Windows 或 Linux 的原生執行檔，並在安裝階段驗證 GitHub Release 的 `checksums.txt`。若要在非互動式 Agent 或 CI 中使用，建議加上 `--yes`：`npx --yes holidaytw --json YYYY-MM-DD`。

### macOS / Linux

以 `install.sh` 下載最新版並安裝到 `~/.local/bin`（若 `HOME` 未設定則需自行指定 `--dir`）：

```sh
curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh
```

指定版本或安裝目錄（也可用環境變數 `HOLIDAYTW_INSTALL_DIR` 取代 `--dir`；舊的 `HOLIDAYBOOK_INSTALL_DIR` 仍可作為過渡別名，但 `HOLIDAYTW_INSTALL_DIR` 與 `--dir` 優先權較高）：

```sh
curl -fsSL https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.sh | sh -s -- --version v2.0.1 --dir "$HOME/bin"
```

已 clone 專案時，也可以直接在本機執行腳本：

```sh
git clone https://github.com/doggy8088/holidaybook.git
cd holidaybook
sh install.sh --version v2.0.1 --dir "$HOME/bin"
```

安裝完成後，若安裝目錄已在 `PATH` 中，腳本會提示直接執行 `holidaytw --help`；否則會提示先把該目錄加入 `PATH`。可用 `holidaytw --version` 確認安裝成功。

### Windows

以 `install.ps1` 下載最新版，預設安裝到 `%LOCALAPPDATA%\Programs\holidaytw`：

```powershell
irm https://raw.githubusercontent.com/doggy8088/holidaybook/master/install.ps1 | iex
```

指定版本或安裝目錄時，建議先下載腳本再帶參數執行（`-Version`、`-InstallDir`；也可用環境變數 `HOLIDAYTW_INSTALL_DIR` 取代 `-InstallDir`，舊的 `HOLIDAYBOOK_INSTALL_DIR` 仍可作為過渡別名）：

```powershell
git clone https://github.com/doggy8088/holidaybook.git
cd holidaybook
./install.ps1 -Version v2.0.1 -InstallDir "$HOME\bin"
```

安裝完成後，若安裝目錄已在 `PATH` 中可直接執行 `holidaytw --help`；否則腳本會提示加入 `PATH`，或直接以完整路徑執行 `& "<InstallDir>\holidaytw.exe" --help`。可用 `holidaytw --version` 確認安裝成功。

## CLI 使用方式

人類可讀輸出：

```console
$ holidaytw 2025-10-10
2025-10-10：放假（國慶日）
類別：放假之紀念日及節日
說明：全國各機關學校放假一日。

$ holidaytw 2025-10-14
2025-10-14：上班日

$ holidaytw 2025-09-03
2025-09-03：上班日（軍人節）
類別：特定節日
說明：軍人依國防部規定辦理。
```

機器可讀輸出（`--json`，方便串接腳本或代理人）：

```console
$ holidaytw --json 2025-10-10
{"date":"2025-10-10","isHoliday":true,"name":"國慶日","category":"放假之紀念日及節日","description":"全國各機關學校放假一日。"}

$ holidaytw --json 2025-10-14
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

專案內建可分享的 agent skill，共兩份行為一致的定義：

- 根目錄（canonical）：[`skill/SKILL.md`](skill/SKILL.md)
- Repository-scoped 副本：[`.github/skills/query-taiwan-holiday`](.github/skills/query-taiwan-holiday/SKILL.md)（含 `SKILL.md` 與 `agents/openai.yaml` 介面中繼資料）

任何支援 repository skills 的代理人都可以直接載入使用，範例提示（取自 `agents/openai.yaml` 的 `default_prompt`）：

> Use `$query-taiwan-holiday` to check whether a specific Taiwan date is a holiday or workday and return structured data.

該 skill 的行為：依序嘗試已安裝的 `holidaytw`，若環境有 Node.js／npm 則使用已正式發布且已確認名稱所有權的官方 `npx --yes holidaytw`，再依作業系統執行官方 `install.sh`／`install.ps1` 並解析安裝路徑；任一步驟失敗只會繼續嘗試下一步，並非直接判定查詢失敗，只有全部步驟（含靜態 JSON fallback）都失敗時才回報查詢失敗。靜態 JSON fallback 為 `curl` 直接查詢（`https://holiday.gh.miniasp.com/YYYY-MM-DD.json`）。並要求代理人解析 JSON 而非用文字比對、日期需先驗證為合法的 `YYYY-MM-DD`。

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
go build -o holidaytw ./cmd/holidaytw   # 建置執行檔
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
- **發布**（`.github/workflows/release.yml`）：推送符合 `v*` 的 tag 時觸發，先跑 `go test ./...`，再用 [GoReleaser](.goreleaser.yml) 建置並發布 GitHub Release，產出 macOS／Linux／Windows（amd64／arm64）共 6 組壓縮檔（`holidaytw_<os>_<arch>.tar.gz`，Windows 為 `.zip`）與 `checksums.txt`（SHA-256），`install.sh`／`install.ps1` 都會下載並驗證這份 checksum。維護者發布新版時，建立並推送一個帶註解的 tag 即可觸發；v1.0.0 是舊執行檔名稱 `holidaybook` 最後一版，往後（`v2.0.0` 起）發布的都是更名後的 `holidaytw`；以下以目前的 patch release `v2.0.1` 為例：

  ```sh
  git tag -a v2.0.1 -m "holidaytw v2.0.1"
  git push origin v2.0.1
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
