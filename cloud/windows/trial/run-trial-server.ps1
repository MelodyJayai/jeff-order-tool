param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210
)

$ErrorActionPreference = "Stop"

function Import-TrialEnvironment([string]$ConfigPath) {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Trial configuration not found: $ConfigPath"
  }

  foreach ($line in Get-Content -LiteralPath $ConfigPath) {
    if ($line -match '^\s*([^#][^=]*)=(.*)$') {
      Set-Item -Path "Env:$($Matches[1].Trim())" -Value $Matches[2]
    }
  }
}

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$configPath = Join-Path $root "config\trial.env"
$logDir = Join-Path $root "logs"
$serverLog = Join-Path $logDir "server.log"
$runId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
$serverStdoutLog = Join-Path $logDir "server-$runId.stdout.log"
$serverStderrLog = Join-Path $logDir "server-$runId.stderr.log"
$currentLogsPath = Join-Path $logDir "server-current-logs.txt"
$nodePath = Join-Path $root "app\runtime\node.exe"
$serverDir = Join-Path $root "app\server"
$serverPath = Join-Path $serverDir "server.js"
$publicUrlPath = Join-Path $root "public-url.txt"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Import-TrialEnvironment $configPath

if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $serverPath)) {
  throw "Packaged application is incomplete under $root\app"
}

$env:NODE_ENV = "production"
$env:HOSTNAME = "127.0.0.1"
$env:PORT = [string]$Port
$env:JEFF_DEPLOYMENT_MODE = "cloud"
$env:JEFF_DISABLE_IN_APP_UPDATES = "true"
$env:JEFF_CLOUD_SYNC_READ_ONLY = if ($env:JEFF_CLOUD_SYNC_READ_ONLY) { $env:JEFF_CLOUD_SYNC_READ_ONLY } else { "true" }
$env:JEFF_ORDER_DB_PATH = Join-Path $root "data\orders.db"
$env:JEFF_BACKUP_DIR = Join-Path $root "data\backups"
$env:JEFF_BACKUP_RETENTION_DAYS = "30"
$env:JEFF_COOKIE_SECURE = "true"
$env:JEFF_APP_BASE_DIR = $root

if (Test-Path -LiteralPath $publicUrlPath) {
  $publicUrl = (Get-Content -LiteralPath $publicUrlPath -Raw).Trim().TrimEnd("/")
  if ($publicUrl.StartsWith("https://")) {
    $env:JEFF_PUBLIC_URL = $publicUrl
    $env:NEXT_PUBLIC_SITE_URL = $publicUrl
  }
}

$normalizedNodePath = $nodePath.ToLowerInvariant()
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ExecutablePath -and
    $_.ExecutablePath.ToLowerInvariant() -eq $normalizedNodePath -and
    $_.CommandLine -match 'server\.js'
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Set-Content -LiteralPath $currentLogsPath -Value @(
  "stdout=$serverStdoutLog",
  "stderr=$serverStderrLog"
) -Encoding utf8

"[$(Get-Date -Format o)] Starting Jeff Order Tool trial on 127.0.0.1:$Port" |
  Out-File -LiteralPath $serverLog -Encoding utf8 -Append
"Data: $env:JEFF_ORDER_DB_PATH" |
  Out-File -LiteralPath $serverLog -Encoding utf8 -Append
"Public URL: $($env:JEFF_PUBLIC_URL)" |
  Out-File -LiteralPath $serverLog -Encoding utf8 -Append

Set-Location -LiteralPath $serverDir
$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @("`"$serverPath`"") `
  -WorkingDirectory $serverDir `
  -RedirectStandardOutput $serverStdoutLog `
  -RedirectStandardError $serverStderrLog `
  -WindowStyle Hidden `
  -PassThru

try {
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  "[$(Get-Date -Format o)] Server exited with code $exitCode" |
    Out-File -LiteralPath $serverLog -Encoding utf8 -Append
  exit $exitCode
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
