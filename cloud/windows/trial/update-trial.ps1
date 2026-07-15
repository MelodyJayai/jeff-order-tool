param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [string]$PackageDir = "",
  [int]$Port = 3210,
  [int]$HealthTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$serverTaskName = "JeffOrderToolCloudTrialServer"

function Resolve-FullPath([string]$Value) {
  return [System.IO.Path]::GetFullPath($Value)
}

function Assert-ChildPath([string]$Candidate, [string]$Root) {
  $fullCandidate = Resolve-FullPath $Candidate
  $fullRoot = (Resolve-FullPath $Root).TrimEnd("\")
  if (-not $fullCandidate.StartsWith(
      $fullRoot + "\",
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Path must remain under the install root: $fullCandidate"
  }
  return $fullCandidate
}

function Stop-TrialNode([string]$NodePath) {
  $normalized = (Resolve-FullPath $NodePath).ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      $_.ExecutablePath.ToLowerInvariant() -eq $normalized -and
      $_.CommandLine -match 'server\.js'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Wait-ForVersion([string]$ExpectedVersion, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 750
    try {
      $health = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$Port/api/health" `
        -TimeoutSec 4 `
        -UseBasicParsing
      if ($health.ok -and $health.version -eq $ExpectedVersion) {
        return $health
      }
    } catch {
    }
  } while ((Get-Date) -lt $deadline)
  throw "Version $ExpectedVersion did not become healthy within $TimeoutSeconds seconds."
}

$root = Resolve-FullPath $InstallRoot
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  throw "Trial install root not found: $root"
}
if (-not $PackageDir) {
  throw "PackageDir is required."
}
$package = Resolve-FullPath $PackageDir
if (-not (Test-Path -LiteralPath $package -PathType Container)) {
  throw "Package directory not found: $package"
}

$packageManifest = Join-Path $package "server\package.json"
$packageServer = Join-Path $package "server\server.js"
$packageNode = Join-Path $package "runtime\node.exe"
$packageBackupScript = Join-Path $package "server\scripts\backup-sqlite.cjs"
foreach ($required in @(
    $packageManifest,
    $packageServer,
    $packageNode,
    $packageBackupScript
  )) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Package is incomplete: $required"
  }
}

$newVersion = (Get-Content -LiteralPath $packageManifest -Raw | ConvertFrom-Json).version
if ($newVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "Invalid package version: $newVersion"
}

$appPath = Assert-ChildPath (Join-Path $root "app") $root
$currentManifest = Join-Path $appPath "server\package.json"
if (-not (Test-Path -LiteralPath $currentManifest -PathType Leaf)) {
  throw "Current trial package is incomplete: $currentManifest"
}
$currentVersion = (Get-Content -LiteralPath $currentManifest -Raw | ConvertFrom-Json).version
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagePath = Assert-ChildPath (Join-Path $root "app-staged-$newVersion-$timestamp") $root
$rollbackPath = Assert-ChildPath (Join-Path $root "app-retained-$currentVersion-$timestamp") $root
$failedPath = Assert-ChildPath (Join-Path $root "app-failed-$newVersion-$timestamp") $root
foreach ($candidate in @($stagePath, $rollbackPath, $failedPath)) {
  if (Test-Path -LiteralPath $candidate) {
    throw "Upgrade path already exists: $candidate"
  }
}

$currentNode = Join-Path $appPath "runtime\node.exe"
$packageServerDir = Join-Path $package "server"
$env:NODE_ENV = "production"
$env:JEFF_DEPLOYMENT_MODE = "cloud"
$env:JEFF_ORDER_DB_PATH = Join-Path $root "data\orders.db"
$env:JEFF_BACKUP_DIR = Join-Path $root "data\backups"
$env:JEFF_BACKUP_RETENTION_DAYS = "30"

$previousErrorActionPreference = $ErrorActionPreference
Push-Location $packageServerDir
try {
  $ErrorActionPreference = "Continue"
  $backupOutput = & $packageNode $packageBackupScript 2>&1
  $backupExitCode = $LASTEXITCODE
  if ($backupExitCode -ne 0) {
    throw "Pre-upgrade database backup failed: $backupOutput"
  }
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
  Pop-Location
}

Copy-Item -LiteralPath $package -Destination $stagePath -Recurse
$stagedVersion = (
  Get-Content -LiteralPath (Join-Path $stagePath "server\package.json") -Raw |
    ConvertFrom-Json
).version
if ($stagedVersion -ne $newVersion) {
  throw "Staged package version mismatch."
}

$swapped = $false
try {
  Stop-ScheduledTask -TaskName $serverTaskName -ErrorAction SilentlyContinue
  Stop-TrialNode $currentNode
  Start-Sleep -Seconds 1

  Move-Item -LiteralPath $appPath -Destination $rollbackPath
  $swapped = $true
  Move-Item -LiteralPath $stagePath -Destination $appPath

  Start-ScheduledTask -TaskName $serverTaskName
  $health = Wait-ForVersion $newVersion $HealthTimeoutSeconds
  $loginInfoPath = Join-Path $root "Jeff-cloud-trial-login.txt"
  if (Test-Path -LiteralPath $loginInfoPath -PathType Leaf) {
    $updatedLoginInfo = foreach ($line in Get-Content -LiteralPath $loginInfoPath) {
      if ($line -match '^Version:') {
        "Version: $newVersion"
      } elseif ($line -match '^Updated:') {
        "Updated: $(Get-Date -Format o)"
      } else {
        $line
      }
    }
    Set-Content -LiteralPath $loginInfoPath -Value $updatedLoginInfo -Encoding utf8
  }

  [pscustomobject]@{
    Updated = $true
    PreviousVersion = $currentVersion
    Version = $health.version
    Database = $env:JEFF_ORDER_DB_PATH
    RetainedPackage = $rollbackPath
    BackupOutput = ($backupOutput -join " ")
  } | ConvertTo-Json -Depth 4
} catch {
  $upgradeError = $_
  if ($swapped) {
    Stop-ScheduledTask -TaskName $serverTaskName -ErrorAction SilentlyContinue
    Stop-TrialNode (Join-Path $appPath "runtime\node.exe")
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $appPath) {
      Move-Item -LiteralPath $appPath -Destination $failedPath
    }
    if (Test-Path -LiteralPath $rollbackPath) {
      Move-Item -LiteralPath $rollbackPath -Destination $appPath
      Start-ScheduledTask -TaskName $serverTaskName
      Wait-ForVersion $currentVersion $HealthTimeoutSeconds | Out-Null
    }
  }
  throw $upgradeError
}
