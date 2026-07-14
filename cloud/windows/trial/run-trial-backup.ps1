param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial"
)

$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$nodePath = Join-Path $root "app\runtime\node.exe"
$serverDir = Join-Path $root "app\server"
$backupScript = Join-Path $serverDir "scripts\backup-sqlite.cjs"
$logDir = Join-Path $root "logs"
$backupLog = Join-Path $logDir "backup.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:NODE_ENV = "production"
$env:JEFF_DEPLOYMENT_MODE = "cloud"
$env:JEFF_ORDER_DB_PATH = Join-Path $root "data\orders.db"
$env:JEFF_BACKUP_DIR = Join-Path $root "data\backups"
$env:JEFF_BACKUP_RETENTION_DAYS = "30"

"[$(Get-Date -Format o)] Running SQLite backup" |
  Out-File -LiteralPath $backupLog -Encoding utf8 -Append

Set-Location -LiteralPath $serverDir
$output = & $nodePath $backupScript 2>&1
$exitCode = $LASTEXITCODE
$output | Out-File -LiteralPath $backupLog -Encoding utf8 -Append

"[$(Get-Date -Format o)] Backup task exited with code $exitCode" |
  Out-File -LiteralPath $backupLog -Encoding utf8 -Append
exit $exitCode
