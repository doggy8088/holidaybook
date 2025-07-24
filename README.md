# Taiwan Holiday Static Site

這是一個專門用來提供台灣假日資訊的靜態網站專案，假期的資料來源是[臺北市資料大平臺](https://data.taipei/)的[臺北市政府行政機關辦公日曆表](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738)資料。

本專案使用 GitHub Actions 每日自動更新假期資料，並通過 GitHub Pages 提供靜態 JSON API 服務。

## Basic Usage

查詢特定日期的假期資訊，只需要訪問對應的 JSON 檔案：

### 單日查詢

- 格式: `https://doggy8088.github.io/holidaybook/{YYYY-MM-DD}.json`
- 範例: `https://doggy8088.github.io/holidaybook/2025-07-20.json`

### 月份查詢

查詢特定月份的所有假期資訊：

- 格式: `https://doggy8088.github.io/holidaybook/{YYYY-MM}.json`
- 範例: `https://doggy8088.github.io/holidaybook/2024-01.json`

### 年度查詢

查詢特定年度的所有假期資訊：

- 格式: `https://doggy8088.github.io/holidaybook/{YYYY}.json`
- 範例: `https://doggy8088.github.io/holidaybook/2024.json`

## Remark

有一些特殊節日不是所有人都放假：

1. 軍人節

    只有軍人才放假！本系統已將軍人節設定為非假日 (`isHoliday`: 0)。

2. 勞動節

    只有勞工才放假！

## 資料更新

- 資料每日透過 GitHub Actions 自動更新
- 資料範圍：從 2024-01-01 開始，涵蓋未來 2 年
- 如果 API 獲取失敗，會透過 SendGrid 發送錯誤通知郵件

## Development

### 本地測試靜態產生器

1. Download

    ```sh
    git clone https://github.com/doggy8088/holidaybook.git
    cd holidaybook
    ```

2. 執行靜態產生器

    ```sh
    cd StaticGenerator
    dotnet run
    ```

3. 查看產生的檔案

    ```sh
    ls docs/
    cat docs/2024-01-01.json
    ```

### GitHub Actions 設定

需要在 Repository Secrets 中設定以下變數（用於錯誤通知）：

- `SENDGRID_API_KEY`: SendGrid API 金鑰
- `NOTIFICATION_EMAIL`: 接收錯誤通知的信箱
- `FROM_EMAIL`: 發送錯誤通知的信箱（可選，預設為 noreply@github.com）

## DataSource

- API
  - 2024 年所有假期的網址:
    - <https://data.taipei/api/v1/dataset/964e936d-d971-4567-a467-aa67b930f98e?scope=resourceAquire&offset=1316&limit=1000>
- [臺北市資料大平臺](https://data.taipei/)
  - [臺北市政府行政機關辦公日曆表](https://data.taipei/dataset/detail?id=c30ca421-d935-4faa-b523-9c175c8de738)
