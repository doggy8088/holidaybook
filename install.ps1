[CmdletBinding()]
param(
    [Parameter()]
    [string] $Version = "latest",

    # Left empty by default so environment-variable precedence (see below)
    # can be resolved after parameter binding.
    [Parameter()]
    [string] $InstallDir
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repository = "doggy8088/holidaybook"
$program = "holidaytw"

function Stop-Installer {
    param([string] $Message)
    throw "holidaytw installer: $Message"
}

function Test-WindowsHost {
    # Windows PowerShell (5.1) only runs on Windows; PowerShell 6+ exposes $IsWindows.
    if ($PSVersionTable.PSVersion.Major -lt 6) {
        return $true
    }
    return [bool] $IsWindows
}

function Get-TargetArchitecture {
    $osArchitecture = $null
    try {
        # Available on .NET Framework 4.7.1+ and PowerShell 6+; reports the OS (not process) architecture.
        $osArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    }
    catch {
        $osArchitecture = $null
    }
    if ([string]::IsNullOrWhiteSpace($osArchitecture)) {
        $osArchitecture = $env:PROCESSOR_ARCHITEW6432
    }
    if ([string]::IsNullOrWhiteSpace($osArchitecture)) {
        $osArchitecture = $env:PROCESSOR_ARCHITECTURE
    }

    switch -Regex ($osArchitecture) {
        '^(X64|AMD64)$' { return "amd64" }
        '^ARM64$' { return "arm64" }
        default { Stop-Installer "unsupported architecture: $osArchitecture; use amd64 or arm64" }
    }
}

if (-not (Test-WindowsHost)) {
    Stop-Installer "this installer supports Windows only"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    Stop-Installer "Version cannot be empty"
}

# InstallDir precedence (highest wins): -InstallDir parameter >
# HOLIDAYTW_INSTALL_DIR > HOLIDAYBOOK_INSTALL_DIR (deprecated migration
# alias for pre-v2.0.0 installs) > the default Programs\holidaytw path.
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if (-not [string]::IsNullOrWhiteSpace($env:HOLIDAYTW_INSTALL_DIR)) {
        $InstallDir = $env:HOLIDAYTW_INSTALL_DIR
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:HOLIDAYBOOK_INSTALL_DIR)) {
        $InstallDir = $env:HOLIDAYBOOK_INSTALL_DIR
    }
    else {
        $InstallDir = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Programs\holidaytw"
    }
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    Stop-Installer "InstallDir cannot be empty"
}

$architecture = Get-TargetArchitecture

$archive = "${program}_windows_${architecture}.zip"
if ($Version -eq "latest") {
    $releaseUrl = "https://github.com/$repository/releases/latest/download"
}
else {
    $tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
    $releaseUrl = "https://github.com/$repository/releases/download/$tag"
}

if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Windows PowerShell may default to TLS 1.0/1.1, which GitHub rejects.
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

try {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
catch {
    Stop-Installer "cannot create '$InstallDir'; choose a writable path with -InstallDir"
}

$workDir = Join-Path $InstallDir ".$program-install-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $workDir | Out-Null

try {
    $archivePath = Join-Path $workDir $archive
    $checksumsPath = Join-Path $workDir "checksums.txt"

    Write-Host "Downloading $program (windows/$architecture)..."
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archive" -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/checksums.txt" -OutFile $checksumsPath
    }
    catch {
        Stop-Installer "download failed from GitHub Releases: $($_.Exception.Message)"
    }

    $escapedArchive = [Regex]::Escape($archive)
    $checksumLine = Get-Content $checksumsPath |
        Where-Object { $_ -match "^([0-9a-fA-F]{64})\s+\*?$escapedArchive$" } |
        Select-Object -First 1
    if (-not $checksumLine) {
        Stop-Installer "checksums.txt does not contain an entry for $archive"
    }

    $expectedHash = ([Regex]::Match($checksumLine, "^([0-9a-fA-F]{64})")).Groups[1].Value
    $actualHash = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash
    if ($actualHash -ne $expectedHash) {
        Stop-Installer "checksum mismatch for $archive; the downloaded file was not installed"
    }

    $extractDir = Join-Path $workDir "extract"
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir
    $sourceBinary = Join-Path $extractDir "$program.exe"
    if (-not (Test-Path -LiteralPath $sourceBinary -PathType Leaf)) {
        Stop-Installer "release archive did not contain $program.exe"
    }

    $target = Join-Path $InstallDir "$program.exe"
    $staged = Join-Path $InstallDir ".$program.exe.new-$([Guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $sourceBinary -Destination $staged

    try {
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $backup = Join-Path $InstallDir ".$program.exe.backup-$([Guid]::NewGuid().ToString('N'))"
            [IO.File]::Replace($staged, $target, $backup, $true)
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        }
        else {
            [IO.File]::Move($staged, $target)
        }
    }
    catch {
        Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
        Stop-Installer "cannot install to '$target'; close any running copy and check permissions"
    }

    Write-Host "Installed $program to $target"
    $normalizedInstallDir = $InstallDir.TrimEnd('\', '/')
    $onPath = @($env:PATH -split [IO.Path]::PathSeparator |
        Where-Object { $_ -and $_.TrimEnd('\', '/') -eq $normalizedInstallDir })
    if ($onPath.Count -gt 0) {
        Write-Host "Next: $program --help"
    }
    else {
        Write-Host "Next: add '$InstallDir' to PATH, then run: $program --help"
        Write-Host "Or run now: & `"$target`" --help"
    }
}
finally {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
