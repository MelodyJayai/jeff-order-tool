param(
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = "D:\JeffOrderToolCloud\data"
)

$ErrorActionPreference = "Stop"
$resolvedAppDir = (Resolve-Path $AppDir).Path
$resolvedDataDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir)
$logDir = Join-Path $resolvedDataDir "logs"
$backupLog = Join-Path $logDir "backup.log"

New-Item -ItemType Directory -Force -Path $resolvedDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$env:NODE_ENV = "production"
$env:JEFF_DEPLOYMENT_MODE = "cloud"
$env:JEFF_ORDER_DB_PATH = Join-Path $resolvedDataDir "orders.db"
$env:JEFF_BACKUP_DIR = Join-Path $resolvedDataDir "backups"

Set-Location $resolvedAppDir
"[$(Get-Date -Format o)] Running daily backup" | Out-File -FilePath $backupLog -Encoding utf8 -Append
& npm.cmd run backup:daily *>> $backupLog
