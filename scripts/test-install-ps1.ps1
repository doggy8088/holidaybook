# Static validation for install.ps1: verifies the script still parses as
# valid PowerShell and that the shipped program/env-var names were renamed
# to holidaytw, while the deprecated HOLIDAYBOOK_INSTALL_DIR alias remains
# for migration. This cannot exercise the full download/install flow here
# because install.ps1 intentionally refuses to run on non-Windows hosts
# (Test-WindowsHost); run install.ps1 itself on Windows/CI for that.
#
# Usage: pwsh -NoProfile -File scripts/test-install-ps1.ps1

$ErrorActionPreference = "Stop"
$failures = @()

function Assert-True {
    param([bool] $Condition, [string] $Message)
    if (-not $Condition) {
        $script:failures += $Message
    }
    else {
        Write-Host "PASS: $Message"
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot "install.ps1"
$content = Get-Content -Raw -LiteralPath $scriptPath

# --- Syntax check ---
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$null, [ref]$parseErrors)
Assert-True ($parseErrors.Count -eq 0) "install.ps1 parses without syntax errors"
if ($parseErrors.Count -gt 0) {
    $parseErrors | ForEach-Object { Write-Host "  parse error: $_" }
}

# --- Program identity ---
Assert-True ($content -match '\$program\s*=\s*"holidaytw"') 'program variable is "holidaytw"'
Assert-True ($content -notmatch '\$program\s*=\s*"holidaybook"') 'program variable is not "holidaybook"'

# --- Env var precedence: HOLIDAYTW_INSTALL_DIR preferred, legacy alias kept ---
Assert-True ($content -match '\$env:HOLIDAYTW_INSTALL_DIR') 'reads HOLIDAYTW_INSTALL_DIR'
Assert-True ($content -match '\$env:HOLIDAYBOOK_INSTALL_DIR') 'reads deprecated HOLIDAYBOOK_INSTALL_DIR alias'
$twIndex = $content.IndexOf('$env:HOLIDAYTW_INSTALL_DIR')
$legacyIndex = $content.IndexOf('$env:HOLIDAYBOOK_INSTALL_DIR')
Assert-True ($twIndex -ge 0 -and $legacyIndex -ge 0 -and $twIndex -lt $legacyIndex) `
    'HOLIDAYTW_INSTALL_DIR is checked before the deprecated HOLIDAYBOOK_INSTALL_DIR alias'

# --- Default install directory uses the new program name ---
Assert-True ($content -match 'Programs\\holidaytw') 'default InstallDir uses Programs\holidaytw'

# --- No stale user-facing holidaybook.exe / holidaybook commands ---
Assert-True ($content -notmatch '\bholidaybook\.exe\b') 'no stale holidaybook.exe references'
Assert-True ($content -notmatch '"holidaybook installer') 'error prefix uses holidaytw, not holidaybook'

# --- Repository URL stays pinned to the immutable GitHub repo ---
Assert-True ($content -match '"doggy8088/holidaybook"') 'repository variable still points at doggy8088/holidaybook'

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "FAILURES:"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Host ""
Write-Host "All install.ps1 static checks passed."
