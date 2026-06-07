param(
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = "D:\JeffOrderToolCloud\data",
  [int]$Port = 3000,
  [string]$PublicUrl = "",
  [string]$AdminPassword = "",
  [string]$OldDataPath = "",
  [switch]$OpenFirewall,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipMigration,
  [switch]$SkipTasks,
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PathValue)
}

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Set-EnvLine([string[]]$Lines, [string]$Key, [string]$Value) {
  $escaped = $Value.Replace("`r", "").Replace("`n", "")
  $line = "$Key=$escaped"
  $pattern = "^\s*$([regex]::Escape($Key))="
  $found = $false
  $updated = foreach ($item in $Lines) {
    if ($item -match $pattern) {
      $found = $true
      $line
    } else {
      $item
    }
  }

  if (-not $found) {
    $updated += $line
  }

  return $updated
}

function Get-EnvValue([string[]]$Lines, [string]$Key) {
  $pattern = "^\s*$([regex]::Escape($Key))=(.*)$"
  foreach ($item in $Lines) {
    if ($item -match $pattern) {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }

  return ""
}

function Assert-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command not found: $Name. $InstallHint"
  }
}

function Test-TargetHasOrders([string]$TargetDataDir) {
  $dbPath = Join-Path $TargetDataDir "orders.db"

  if (-not (Test-Path $dbPath)) {
    return $false
  }

  $script = @'
const Database = require('better-sqlite3');
const dbPath = process.argv[2];
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
  if (!exists) {
    console.log('0');
    process.exit(0);
  }
  const row = db.prepare('SELECT COUNT(*) AS count FROM orders').get();
  console.log(String(row.count || 0));
} finally {
  db.close();
}
'@

  $count = $script | node - $dbPath
  return ([int]($count.Trim()) -gt 0)
}

$resolvedAppDir = (Resolve-Path $AppDir).Path
$resolvedDataDir = Resolve-FullPath $DataDir
$envPath = Join-Path $resolvedAppDir ".env.cloud"
$envExamplePath = Join-Path $resolvedAppDir ".env.cloud.example"

Write-Step "Check project directory and tools"
if (-not (Test-Path (Join-Path $resolvedAppDir "package.json"))) {
  throw "AppDir is not a Jeff Order Tool project directory: $resolvedAppDir"
}

Assert-Command "node" "Install Node.js LTS first."
Assert-Command "npm.cmd" "Install Node.js LTS first and make sure npm is in PATH."

Write-Host "AppDir: $resolvedAppDir"
Write-Host "DataDir: $resolvedDataDir"
Write-Host "Port: $Port"
Write-Host "Node: $(node -v)"
Write-Host "npm: $(npm -v)"

Write-Step "Prepare .env.cloud"
if (-not (Test-Path $envPath)) {
  if (Test-Path $envExamplePath) {
    Copy-Item -LiteralPath $envExamplePath -Destination $envPath
  } else {
    New-Item -ItemType File -Path $envPath -Force | Out-Null
  }
}

$envLines = @(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
$dbPath = Join-Path $resolvedDataDir "orders.db"
$backupDir = Join-Path $resolvedDataDir "backups"
$logDir = Join-Path $resolvedDataDir "logs"

$envLines = Set-EnvLine $envLines "JEFF_DEPLOYMENT_MODE" "cloud"
$envLines = Set-EnvLine $envLines "JEFF_DISABLE_IN_APP_UPDATES" "true"
$envLines = Set-EnvLine $envLines "JEFF_ORDER_DB_PATH" $dbPath
$envLines = Set-EnvLine $envLines "JEFF_BACKUP_DIR" $backupDir
$envLines = Set-EnvLine $envLines "PORT" ([string]$Port)

if ($PublicUrl.Trim()) {
  $cleanUrl = $PublicUrl.Trim().TrimEnd("/")
  $cookieSecure = if ($cleanUrl.StartsWith("https://")) { "true" } else { "false" }
  $envLines = Set-EnvLine $envLines "JEFF_PUBLIC_URL" $cleanUrl
  $envLines = Set-EnvLine $envLines "NEXT_PUBLIC_SITE_URL" $cleanUrl
  $envLines = Set-EnvLine $envLines "JEFF_COOKIE_SECURE" $cookieSecure
}

if ($AdminPassword) {
  if ($AdminPassword.Length -lt 8) {
    throw "AdminPassword must be at least 8 characters."
  }

  $envLines = Set-EnvLine $envLines "JEFF_ADMIN_PASSWORD" $AdminPassword
}

New-Item -ItemType Directory -Force -Path $resolvedDataDir, $backupDir, $logDir | Out-Null
Set-Content -LiteralPath $envPath -Value $envLines -Encoding UTF8

$configuredPassword = Get-EnvValue $envLines "JEFF_ADMIN_PASSWORD"
if (-not $configuredPassword -or $configuredPassword -eq "replace-with-a-strong-password") {
  Write-Warning "JEFF_ADMIN_PASSWORD is not configured. First visit will open /setup. Use a strong password before public deployment."
}

Write-Step "Install dependencies and build"
Set-Location $resolvedAppDir
if (-not $SkipInstall) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
} else {
  Write-Host "Skipped npm ci"
}

if (-not $SkipBuild) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} else {
  Write-Host "Skipped npm run build"
}

if ($OldDataPath.Trim() -and -not $SkipMigration) {
  Write-Step "Migrate Jeff old data"
  if (Test-TargetHasOrders $resolvedDataDir) {
    Write-Warning "Target cloud data already has orders. Migration skipped to avoid overwrite."
  } else {
    & npm.cmd run migrate:cloud-data -- --from $OldDataPath --to $resolvedDataDir
    if ($LASTEXITCODE -ne 0) { throw "Data migration failed" }
  }
} elseif ($OldDataPath.Trim()) {
  Write-Host "Skipped data migration"
}

if ($OpenFirewall) {
  Write-Step "Configure Windows Firewall"
  $ruleName = "Jeff Order Tool Cloud Port $Port"
  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "Firewall rule already exists: $ruleName"
  } else {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $Port `
      -Profile Private,Domain `
      | Out-Null
    Write-Host "Created firewall rule: $ruleName"
  }
}

if (-not $SkipTasks) {
  Write-Step "Register auto-start and daily backup tasks"
  $taskArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $resolvedAppDir "cloud\windows\register-cloud-tasks.ps1"),
    "-AppDir", $resolvedAppDir,
    "-DataDir", $resolvedDataDir,
    "-Port", $Port
  )

  if ($PublicUrl.Trim()) {
    $taskArgs += @("-PublicUrl", $PublicUrl.Trim())
  }

  & powershell.exe @taskArgs
  if ($LASTEXITCODE -ne 0) { throw "Scheduled task registration failed" }
} else {
  Write-Host "Skipped scheduled task registration"
}

if (-not $SkipStart) {
  Write-Step "Start cloud service and check health"
  Start-ScheduledTask -TaskName "JeffOrderToolCloud"
  Start-Sleep -Seconds 3

  $healthUrl = "http://127.0.0.1:$Port/api/health"
  $health = $null
  for ($i = 0; $i -lt 20; $i += 1) {
    try {
      $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $health -or -not $health.ok) {
    throw "Cloud service health check failed: $healthUrl. Check $logDir\server.log"
  }

  Write-Host "Health check OK: $healthUrl"
  Write-Host "Version: $($health.version)"
} else {
  Write-Host "Skipped service start"
}

Write-Step "Done"
if ($PublicUrl.Trim()) {
  Write-Host "Jeff access URL: $($PublicUrl.Trim().TrimEnd('/'))"
} else {
  Write-Host "Local check URL: http://127.0.0.1:$Port"
}
Write-Host "Data directory: $resolvedDataDir"
Write-Host "Backup directory: $backupDir"
Write-Host "Log directory: $logDir"
