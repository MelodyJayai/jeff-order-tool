param(
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = "D:\JeffOrderToolCloud\data",
  [int]$Port = 3000,
  [string]$PublicUrl = ""
)

$ErrorActionPreference = "Stop"
$resolvedAppDir = (Resolve-Path $AppDir).Path
$resolvedDataDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir)
$logDir = Join-Path $resolvedDataDir "logs"
$serverLog = Join-Path $logDir "server.log"

New-Item -ItemType Directory -Force -Path $resolvedDataDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$env:NODE_ENV = "production"
$env:HOSTNAME = "0.0.0.0"
$env:PORT = [string]$Port
$env:JEFF_DEPLOYMENT_MODE = "cloud"
$env:JEFF_DISABLE_IN_APP_UPDATES = "true"
$env:JEFF_ORDER_DB_PATH = Join-Path $resolvedDataDir "orders.db"
$env:JEFF_BACKUP_DIR = Join-Path $resolvedDataDir "backups"

if ($PublicUrl.Trim()) {
  $env:JEFF_PUBLIC_URL = $PublicUrl.Trim().TrimEnd("/")
  $env:NEXT_PUBLIC_SITE_URL = $env:JEFF_PUBLIC_URL
  $env:JEFF_COOKIE_SECURE = if ($env:JEFF_PUBLIC_URL.StartsWith("https://")) { "true" } else { "false" }
}

Set-Location $resolvedAppDir
"[$(Get-Date -Format o)] Starting Jeff Order Tool cloud server in $resolvedAppDir" | Out-File -FilePath $serverLog -Encoding utf8 -Append
"Data: $env:JEFF_ORDER_DB_PATH" | Out-File -FilePath $serverLog -Encoding utf8 -Append

& npm.cmd run start:cloud *>> $serverLog
