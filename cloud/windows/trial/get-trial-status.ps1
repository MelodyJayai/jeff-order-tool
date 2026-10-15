param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210
)

$ErrorActionPreference = "SilentlyContinue"

function Get-EndpointHealth([string]$Uri, [int]$TimeoutSeconds) {
  try {
    return Invoke-RestMethod -Uri $Uri -TimeoutSec $TimeoutSeconds
  } catch {
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    return $null
  }

  $raw = & $curl.Source `
    --silent `
    --show-error `
    --fail `
    --max-time $TimeoutSeconds `
    $Uri 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) {
    return $null
  }

  try {
    return ($raw -join "") | ConvertFrom-Json
  } catch {
    return $null
  }
}

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$publicUrlPath = Join-Path $root "public-url.txt"
$publicUrl = if (Test-Path -LiteralPath $publicUrlPath) {
  (Get-Content -LiteralPath $publicUrlPath -Raw).Trim()
} else {
  ""
}

$localHealth = Get-EndpointHealth "http://127.0.0.1:$Port/api/health" 5
$publicHealth = $null
if ($publicUrl) {
  $publicHealth = Get-EndpointHealth "$publicUrl/api/health" 15
}

$taskNames = @(
  "JeffOrderToolCloudTrialServer",
  "JeffOrderToolCloudTrialNamedTunnel",
  "JeffOrderToolCloudTrialTunnel",
  "JeffOrderToolCloudTrialDailyBackup",
  "JeffOrderToolCloudTrialWatchdog"
)
$tasks = foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  [pscustomobject]@{
    Name = $taskName
    State = [string]$task.State
    LastRunTime = $info.LastRunTime
    LastTaskResult = $info.LastTaskResult
    NextRunTime = $info.NextRunTime
  }
}

$latestBackup = Get-ChildItem -LiteralPath (Join-Path $root "data\backups") -Filter "*.db" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

# 看门狗在一切健康时不写日志，所以 watchdog.log 里有内容就代表期间发生过真实异常。
$watchdogLogPath = Join-Path $root "logs\watchdog.log"
# 必须转成纯 [string[]]。Get-Content 返回的字符串携带 PSPath 等附加属性，
# 直接交给 ConvertTo-Json 会把它们全部展开，输出膨胀到上百 KB。
$watchdogEvents = [string[]]@()
if (Test-Path -LiteralPath $watchdogLogPath) {
  $watchdogEvents = [string[]]@(Get-Content -LiteralPath $watchdogLogPath -Tail 5)
}

$watchdogStatePath = Join-Path $root "logs\watchdog-state.json"
$watchdogState = $null
if (Test-Path -LiteralPath $watchdogStatePath) {
  try {
    $watchdogState = Get-Content -LiteralPath $watchdogStatePath -Raw | ConvertFrom-Json
  } catch {
  }
}

[pscustomobject]@{
  InstallRoot = $root
  PublicUrl = $publicUrl
  LocalHealthy = [bool]($localHealth -and $localHealth.ok)
  PublicHealthy = [bool]($publicHealth -and $publicHealth.ok)
  Version = if ($localHealth) { $localHealth.version } else { $null }
  Database = Join-Path $root "data\orders.db"
  LatestBackup = if ($latestBackup) { $latestBackup.FullName } else { $null }
  Tasks = $tasks
  WatchdogLastCheckedAt = if ($watchdogState) { $watchdogState.lastCheckedAt } else { $null }
  WatchdogRecentEventCount = $watchdogEvents.Count
  WatchdogRecentEvents = $watchdogEvents
} | ConvertTo-Json -Depth 4
