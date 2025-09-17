# 資安弱點分析報告 (Security Vulnerability Analysis)

## 概述 (Overview)
這份報告分析了 holidaybook 專案中可能存在的資安弱點。專案是一個從台北市開放資料平台獲取假期資訊並生成靜態 JSON API 的應用程式。

## 緊急風險弱點 (Critical Risk Vulnerabilities)

### 0. 已知的套件漏洞 (Known Package Vulnerabilities)

#### 0.1 System.Text.Json 高風險漏洞
**風險等級**: 緊急
**檔案**: `StaticGenerator/StaticGenerator.csproj` (相依套件)
**問題描述**: 
- 發現 System.Text.Json 8.0.0 有兩個高風險安全漏洞
- GitHub 安全公告: 
  - GHSA-hh2w-p6rv-4g7w (高風險)
  - GHSA-8g4q-xg66-9fp4 (高風險)
- 這些漏洞可能導致拒絕服務攻擊或記憶體消耗攻擊

**掃描結果**:
```
Project `StaticGenerator` has the following vulnerable packages
   [net8.0]: 
   Transitive Package      Resolved   Severity   Advisory URL                                     
   > System.Text.Json      8.0.0      High       https://github.com/advisories/GHSA-hh2w-p6rv-4g7w
                                      High       https://github.com/advisories/GHSA-8g4q-xg66-9fp4
```

**立即修復建議**:
1. 更新 .NET 套件到最新版本
2. 升級到 .NET 9.0.x 或最新的 8.0.x 版本
3. 重新建置並測試應用程式

## 高風險弱點 (High Risk Vulnerabilities)

### 1. 網路通訊安全 (Network Communication Security)

#### 1.1 憑證驗證不足 (Insufficient Certificate Validation)
**風險等級**: 高
**檔案**: `StaticGenerator/Program.cs` (Line 28-35)
**問題描述**: 
- HTTP 客戶端雖然限制使用 TLS 1.2/1.3，但沒有額外的憑證驗證
- 容易受到中間人攻擊 (MITM) 影響

**建議修復**:
```csharp
SslOptions = new SslClientAuthenticationOptions
{
    EnabledSslProtocols = SslProtocols.Tls13 | SslProtocols.Tls12,
    ApplicationProtocols = new List<SslApplicationProtocol>
    {
        SslApplicationProtocol.Http11
    },
    // 加強憑證驗證
    CertificateRevocationCheckMode = X509RevocationMode.Online,
    RemoteCertificateValidationCallback = ValidateServerCertificate
}
```

#### 1.2 DNS 解析安全風險 (DNS Resolution Security Risk)
**風險等級**: 中
**檔案**: `StaticGenerator/Program.cs` (Line 20-21)
**問題描述**:
- 使用 `Dns.GetHostAddressesAsync()` 可能受到 DNS 劫持攻擊
- 強制使用 IPv4 可能不是最佳實踐

### 2. 輸入驗證弱點 (Input Validation Vulnerabilities)

#### 2.1 不安全的 JSON 反序列化 (Unsafe JSON Deserialization)
**風險等級**: 高
**檔案**: `StaticGenerator/Program.cs` (Line 158)
**問題描述**:
- 直接反序列化來自外部 API 的 JSON 資料，沒有適當的驗證
- 可能導致反序列化攻擊或資料毒化

**建議修復**:
```csharp
// 添加 JSON 大小限制和驗證
private static Holiday ValidateAndDeserialize(string json)
{
    // 檢查 JSON 大小限制
    if (json.Length > 10_000_000) // 10MB 限制
        throw new ArgumentException("JSON response too large");
    
    // 驗證 JSON 格式
    var data = Holiday.FromJson(json);
    if (data?.Result?.Results == null)
        throw new InvalidOperationException("Invalid JSON structure");
        
    // 驗證資料內容
    foreach (var item in data.Result.Results)
    {
        if (!DateTime.TryParseExact(item.Date, "yyyyMMdd", null, DateTimeStyles.None, out _))
            throw new ArgumentException($"Invalid date format: {item.Date}");
    }
    
    return data;
}
```

#### 2.2 路徑遍歷風險 (Path Traversal Risk)
**風險等級**: 中
**檔案**: `StaticGenerator/Program.cs` (Line 192, 251, 278)
**問題描述**:
- 輸出目錄和檔案路徑沒有適當的驗證
- 可能允許寫入到預期目錄之外的位置

**建議修復**:
```csharp
private static string ValidatePath(string basePath, string fileName)
{
    var fullPath = Path.Combine(basePath, fileName);
    var normalizedPath = Path.GetFullPath(fullPath);
    var normalizedBase = Path.GetFullPath(basePath);
    
    if (!normalizedPath.StartsWith(normalizedBase))
        throw new ArgumentException("Invalid file path");
        
    return normalizedPath;
}
```

## 中風險弱點 (Medium Risk Vulnerabilities)

### 3. 資訊洩露風險 (Information Disclosure Risks)

#### 3.1 詳細錯誤訊息洩露 (Detailed Error Message Disclosure)
**風險等級**: 中
**檔案**: `StaticGenerator/Program.cs` (Line 78, 148)
**問題描述**:
- 錯誤訊息可能洩露敏感的系統資訊
- 堆疊追蹤可能暴露內部架構

**建議修復**:
```csharp
catch (Exception ex)
{
    // 記錄詳細錯誤供除錯使用
    _logger.LogError(ex, "API fetch failed");
    
    // 對外只顯示一般錯誤訊息
    throw new Exception("Failed to fetch holiday data. Please try again later.");
}
```

#### 3.2 API URL 暴露 (API URL Exposure)
**風險等級**: 低
**檔案**: `StaticGenerator/appsettings.json` (Line 3)
**問題描述**:
- API URL 在設定檔中明文存儲
- 雖然是公開 API，但仍建議保護設定資訊

### 4. GitHub Actions 安全風險 (GitHub Actions Security Risks)

#### 4.1 過度的權限設定 (Excessive Permissions)
**風險等級**: 中
**檔案**: `.github/workflows/generate-data.yml` (Line 15-16)
**問題描述**:
- `contents: write` 權限允許修改整個儲存庫
- 建議採用最小權限原則

**建議修復**:
```yaml
permissions:
  contents: write  # 只允許寫入必要的檔案
  pages: write     # 如果需要部署到 GitHub Pages
  id-token: write  # 如果使用 OIDC
```

#### 4.2 秘密管理 (Secret Management)
**風險等級**: 低
**檔案**: `.github/workflows/generate-data.yml` (Line 84-86)
**問題描述**:
- SendGrid API 金鑰和電子郵件透過 GitHub Secrets 管理 (這是正確做法)
- 但沒有秘密輪換機制

### 5. 依賴套件安全風險 (Dependency Security Risks)

#### 5.1 沒有依賴套件掃描 (No Dependency Scanning)
**風險等級**: 中
**檔案**: `StaticGenerator/StaticGenerator.csproj`
**問題描述**:
- 沒有自動化的依賴套件漏洞掃描
- 無法及時發現已知的安全漏洞

**建議修復**: 加入 GitHub Dependabot 或 NuGet 套件稽核:
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "nuget"
    directory: "/StaticGenerator"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

### 6. 輸出資料安全 (Output Data Security)

#### 6.1 靜態檔案沒有完整性檢查 (No Integrity Check for Static Files)
**風險等級**: 低
**檔案**: `docs/` 目錄中的 JSON 檔案
**問題描述**:
- 生成的 JSON 檔案沒有完整性檢查機制
- 無法確認檔案是否被篡改

**建議修復**: 加入檔案雜湊值：
```csharp
private static async Task GenerateIntegrityFile(string outputDir)
{
    var checksums = new Dictionary<string, string>();
    var files = Directory.GetFiles(outputDir, "*.json");
    
    foreach (var file in files)
    {
        var bytes = await File.ReadAllBytesAsync(file);
        var hash = SHA256.HashData(bytes);
        checksums[Path.GetFileName(file)] = Convert.ToHexString(hash);
    }
    
    var integrityJson = JsonSerializer.Serialize(checksums, new JsonSerializerOptions { WriteIndented = true });
    await File.WriteAllTextAsync(Path.Combine(outputDir, "integrity.json"), integrityJson);
}
```

## 低風險弱點 (Low Risk Vulnerabilities)

### 7. 設定管理 (Configuration Management)

#### 7.1 設定驗證不足 (Insufficient Configuration Validation)
**風險等級**: 低
**檔案**: `StaticGenerator/Program.cs` (Line 297-313)
**問題描述**:
- 設定驗證相對簡單，可以加強

### 8. 日誌安全 (Logging Security)

#### 8.1 可能的敏感資訊記錄 (Potential Sensitive Information Logging)
**風險等級**: 低
**檔案**: `StaticGenerator/Program.cs` (Line 114, 124)
**問題描述**:
- 記錄 API URL 可能洩露敏感參數

## 建議的安全改善措施 (Recommended Security Improvements)

### 1. 立即實施 (Immediate Actions)
1. 加強 JSON 反序列化驗證
2. 實施路徑驗證防止路徑遍歷
3. 改善錯誤處理避免資訊洩露
4. 加入依賴套件漏洞掃描

### 2. 短期實施 (Short-term Actions)
1. 實施憑證固定或加強驗證
2. 加入檔案完整性檢查
3. 改善 GitHub Actions 權限設定
4. 加入更詳細的設定驗證

### 3. 長期實施 (Long-term Actions)
1. 考慮實施 API 金鑰驗證
2. 加入監控和警報機制
3. 定期進行安全稽核
4. 實施自動化安全測試

## 合規性考量 (Compliance Considerations)

### GDPR/個資法
- 雖然處理的是公開假期資訊，但仍需注意日誌中是否包含個人識別資訊

### 資安標準
- 建議遵循 OWASP Top 10 和 NIST Cybersecurity Framework

## 總結 (Summary)

整體而言，holidaybook 專案具有基本的安全措施，但仍有改善空間。主要的安全風險集中在：
1. 外部 API 資料處理的安全性
2. 檔案系統操作的安全性
3. GitHub Actions 的權限管理

建議優先處理高風險和中風險的弱點，以提升整體安全性。