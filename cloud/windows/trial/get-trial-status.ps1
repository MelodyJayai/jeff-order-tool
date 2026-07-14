param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210
)

$ErrorActionPreference = "SilentlyContinue"
$root = [System.IO.Path]::GetFullPath($InstallRoot)
$publicUrlPath = Join-Path $root "public-url.txt"
$publicUrl = if (Test-Path -LiteralPath $publicUrlPath) {
  (Get-Content -LiteralPath $publicUrlPath -Raw).Trim()
} else {
  ""
}

$localHealth = $null
$publicHealth = $null
try { $localHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 } catch {}
if ($publicUrl) {
  try { $publicHealth = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 15 } catch {}
}

$taskNames = @(
  "JeffOrderToolCloudTrialServer",
  "JeffOrderToolCloudTrialTunnel",
  "JeffOrderToolCloudTrialDailyBackup"
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

[pscustomobject]@{
  InstallRoot = $root
  PublicUrl = $publicUrl
  LocalHealthy = [bool]($localHealth -and $localHealth.ok)
  PublicHealthy = [bool]($publicHealth -and $publicHealth.ok)
  Version = if ($localHealth) { $localHealth.version } else { $null }
  Database = Join-Path $root "data\orders.db"
  LatestBackup = if ($latestBackup) { $latestBackup.FullName } else { $null }
  Tasks = $tasks
} | ConvertTo-Json -Depth 4
