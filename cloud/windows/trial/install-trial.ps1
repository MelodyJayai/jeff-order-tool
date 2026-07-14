param(
  [string]$PackageSource = (Join-Path $PSScriptRoot "..\..\..\release-package\JeffOrderTool"),
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210,
  [string]$CloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/download/2026.7.1/cloudflared-windows-amd64.exe",
  [string]$CloudflaredSha256 = "ccb0756de288d3c2c076d19764ca53e0849a10f2dd9c23f8656ac42bdeb45001"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this installer from an elevated PowerShell window."
  }
}

function New-TrialPassword([int]$Length = 24) {
  $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-_"
  $bytes = New-Object byte[] $Length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Set-AdminOnlyAcl([string]$Path) {
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer) {
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)' | Out-Null
  } else {
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restrict access to $Path"
  }
}

function New-TaskActionForScript([string]$ScriptPath, [string]$Root, [int]$TaskPort = 0) {
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -InstallRoot `"$Root`""
  if ($TaskPort -gt 0) {
    $arguments += " -Port $TaskPort"
  }
  return New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
}

Assert-Administrator

$resolvedPackageSource = (Resolve-Path -LiteralPath $PackageSource).Path
$root = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
if ([System.IO.Path]::GetPathRoot($root) -eq $root) {
  throw "InstallRoot cannot be a drive root."
}
if (Test-Path -LiteralPath $root) {
  $existing = Get-ChildItem -Force -LiteralPath $root -ErrorAction SilentlyContinue
  if ($existing) {
    throw "InstallRoot is not empty: $root"
  }
}

$appDir = Join-Path $root "app"
$configDir = Join-Path $root "config"
$dataDir = Join-Path $root "data"
$backupDir = Join-Path $dataDir "backups"
$logDir = Join-Path $root "logs"
$scriptDir = Join-Path $root "scripts"
$toolDir = Join-Path $root "tools"
$configPath = Join-Path $configDir "trial.env"
$loginInfoPath = Join-Path $root "Jeff-cloud-trial-login.txt"
$cloudflaredPath = Join-Path $toolDir "cloudflared.exe"

New-Item -ItemType Directory -Force -Path $root, $configDir, $dataDir, $backupDir, $logDir, $scriptDir, $toolDir | Out-Null
Set-AdminOnlyAcl $root
Copy-Item -LiteralPath $resolvedPackageSource -Destination $appDir -Recurse -Force

$helperScripts = @(
  "run-trial-server.ps1",
  "run-trial-tunnel.ps1",
  "run-trial-backup.ps1",
  "get-trial-status.ps1"
)
foreach ($helperScript in $helperScripts) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $helperScript) -Destination (Join-Path $scriptDir $helperScript) -Force
}

$serverScriptDir = Join-Path $appDir "server\scripts"
New-Item -ItemType Directory -Force -Path $serverScriptDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\..\..\scripts\backup-sqlite.cjs") -Destination (Join-Path $serverScriptDir "backup-sqlite.cjs") -Force

$downloadPath = "$cloudflaredPath.download"
Invoke-WebRequest -UseBasicParsing -Uri $CloudflaredUrl -OutFile $downloadPath
$actualHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $CloudflaredSha256.ToLowerInvariant()) {
  Remove-Item -LiteralPath $downloadPath -Force
  throw "cloudflared SHA256 mismatch. Expected $CloudflaredSha256, got $actualHash"
}
Move-Item -LiteralPath $downloadPath -Destination $cloudflaredPath -Force

$adminPassword = New-TrialPassword
$configLines = @(
  "JEFF_ADMIN_PASSWORD=$adminPassword",
  "JEFF_DEPLOYMENT_MODE=cloud",
  "JEFF_DISABLE_IN_APP_UPDATES=true"
)
Set-Content -LiteralPath $configPath -Value $configLines -Encoding utf8
Set-AdminOnlyAcl $configPath

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$longRunningSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 50 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$backupSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

$serverTaskName = "JeffOrderToolCloudTrialServer"
$tunnelTaskName = "JeffOrderToolCloudTrialTunnel"
$backupTaskName = "JeffOrderToolCloudTrialDailyBackup"
$serverAction = New-TaskActionForScript (Join-Path $scriptDir "run-trial-server.ps1") $root $Port
$tunnelAction = New-TaskActionForScript (Join-Path $scriptDir "run-trial-tunnel.ps1") $root $Port
$backupAction = New-TaskActionForScript (Join-Path $scriptDir "run-trial-backup.ps1") $root
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 2:30am

Register-ScheduledTask -TaskName $serverTaskName -Action $serverAction -Trigger $startupTrigger -Settings $longRunningSettings -Principal $principal -Description "Jeff Order Tool cloud trial server" -Force | Out-Null
Register-ScheduledTask -TaskName $tunnelTaskName -Action $tunnelAction -Trigger $startupTrigger -Settings $longRunningSettings -Principal $principal -Description "Jeff Order Tool Cloudflare trial tunnel" -Force | Out-Null
Register-ScheduledTask -TaskName $backupTaskName -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Principal $principal -Description "Jeff Order Tool daily SQLite backup" -Force | Out-Null

Start-ScheduledTask -TaskName $tunnelTaskName
$publicUrlPath = Join-Path $root "public-url.txt"
for ($attempt = 0; $attempt -lt 120 -and -not (Test-Path -LiteralPath $publicUrlPath); $attempt += 1) {
  Start-Sleep -Seconds 1
}
if (-not (Test-Path -LiteralPath $publicUrlPath)) {
  throw "Trial tunnel did not publish an address. See $logDir\tunnel-wrapper.log and cloudflared-current-logs.txt"
}
$publicUrl = (Get-Content -LiteralPath $publicUrlPath -Raw).Trim()

Start-ScheduledTask -TaskName $serverTaskName
$localHealth = $null
for ($attempt = 0; $attempt -lt 90; $attempt += 1) {
  try {
    $localHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    if ($localHealth.ok) { break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $localHealth -or -not $localHealth.ok) {
  throw "Local health check failed. See $logDir\server.log"
}

$publicHealth = $null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $publicHealth = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 10
    if ($publicHealth.ok) { break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $publicHealth -or -not $publicHealth.ok) {
  throw "Public health check failed: $publicUrl/api/health"
}

Start-ScheduledTask -TaskName $backupTaskName
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  $latestBackup = Get-ChildItem -LiteralPath $backupDir -Filter "*.db" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latestBackup) { break }
  Start-Sleep -Seconds 1
}

$loginInfo = @(
  "Jeff Order Tool cloud trial",
  "",
  "Address: $publicUrl",
  "Password: $adminPassword",
  "Version: $($localHealth.version)",
  "Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "",
  "The address is temporary and can change after a server or tunnel restart.",
  "The cloud trial database is separate from Jeff's offline database."
) -join [Environment]::NewLine
Set-Content -LiteralPath $loginInfoPath -Value $loginInfo -Encoding utf8
Set-AdminOnlyAcl $loginInfoPath

$desktopInfoPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Jeff-cloud-trial-login.txt"
if ($desktopInfoPath) {
  Set-Content -LiteralPath $desktopInfoPath -Value $loginInfo -Encoding utf8
  Set-AdminOnlyAcl $desktopInfoPath
}

Write-Host ""
Write-Host "Jeff Order Tool cloud trial is online." -ForegroundColor Green
Write-Host "Address: $publicUrl"
Write-Host "Password: $adminPassword"
Write-Host "Version: $($localHealth.version)"
Write-Host "Install root: $root"
Write-Host "Login info: $loginInfoPath"
$latestBackupText = if ($latestBackup) { $latestBackup.FullName } else { "Pending until first login initializes the database" }
Write-Host "Latest backup: $latestBackupText"
