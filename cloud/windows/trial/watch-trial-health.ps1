param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210,
  [string]$ServerTaskName = "JeffOrderToolCloudTrialServer",
  [string]$TunnelTaskName = "JeffOrderToolCloudTrialNamedTunnel",
  # 连续失败次数达到阈值才动手，避免一次网络抖动就重启生产服务。
  [int]$LocalFailureThreshold = 2,
  [int]$PublicFailureThreshold = 3
)

# 看门狗：定期确认云端试用版本机服务与公网入口都真的可用。
#
# 为什么需要这个脚本：
#   JeffOrderToolCloudTrialServer 只有开机触发器，而任务计划的 RestartCount
#   仅在任务“失败”时生效。node 正常退出（exit 0）会被判定为成功，任务不会重启。
#   隧道 wrapper 也只在自己启动那一刻拉起一次 server，之后一直阻塞在 WaitForExit()。
#   2026-09-05 服务就是这样单独退出后无人拉起，隧道仍在线，手机端连续两天 502。

$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$logDir = Join-Path $root "logs"
$watchdogLog = Join-Path $logDir "watchdog.log"
$statePath = Join-Path $logDir "watchdog-state.json"
$publicUrlPath = Join-Path $root "public-url.txt"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-WatchdogLog([string]$Message) {
  "[$(Get-Date -Format o)] $Message" |
    Out-File -LiteralPath $watchdogLog -Encoding utf8 -Append
}

function Get-WatchdogState {
  if (Test-Path -LiteralPath $statePath) {
    try {
      return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } catch {
      Write-WatchdogLog "State file unreadable, resetting counters: $($_.Exception.Message)"
    }
  }
  return [pscustomobject]@{ localFailures = 0; publicFailures = 0 }
}

function Save-WatchdogState($State) {
  $State | ConvertTo-Json -Compress |
    Set-Content -LiteralPath $statePath -Encoding utf8
}

function Test-HealthEndpoint([string]$Url, [int]$TimeoutSec) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($response.StatusCode -ne 200) {
      return @{ ok = $false; detail = "HTTP $($response.StatusCode)" }
    }
    $payload = $response.Content | ConvertFrom-Json
    if (-not $payload.ok) {
      return @{ ok = $false; detail = "health payload ok=false" }
    }
    return @{ ok = $true; detail = "version $($payload.version)" }
  } catch {
    return @{ ok = $false; detail = $_.Exception.Message }
  }
}

function Restart-TrialTask([string]$TaskName) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-WatchdogLog "Cannot restart $TaskName : task not registered"
    return $false
  }
  if ($task.State -eq "Disabled") {
    Write-WatchdogLog "Cannot restart $TaskName : task is disabled"
    return $false
  }

  # Stop 之后必须等任务真的离开 Running，否则 MultipleInstances=IgnoreNew 会丢掉这次 Start。
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 15; $i += 1) {
    Start-Sleep -Seconds 1
    if ((Get-ScheduledTask -TaskName $TaskName).State -ne "Running") { break }
  }

  Start-ScheduledTask -TaskName $TaskName
  Write-WatchdogLog "Restarted $TaskName"
  return $true
}

$state = Get-WatchdogState
$localFailures = [int]$state.localFailures
$publicFailures = [int]$state.publicFailures

# 第一层：本机服务。这是唯一能真正确认业务进程活着的检查。
$localResult = Test-HealthEndpoint "http://127.0.0.1:$Port/api/health" 15

if ($localResult.ok) {
  if ($localFailures -gt 0) {
    Write-WatchdogLog "Local health recovered ($($localResult.detail))"
  }
  $localFailures = 0
} else {
  $localFailures += 1
  Write-WatchdogLog "Local health check failed ($localFailures/$LocalFailureThreshold): $($localResult.detail)"

  if ($localFailures -ge $LocalFailureThreshold) {
    if (Restart-TrialTask $ServerTaskName) {
      # 给 Next.js 留出启动时间，然后当场确认这次重启是否真的救回来了。
      for ($i = 0; $i -lt 30; $i += 1) {
        Start-Sleep -Seconds 3
        $recheck = Test-HealthEndpoint "http://127.0.0.1:$Port/api/health" 10
        if ($recheck.ok) { break }
      }
      if ($recheck.ok) {
        Write-WatchdogLog "Server recovered after restart ($($recheck.detail))"
        $localFailures = 0
      } else {
        Write-WatchdogLog "Server still unhealthy after restart: $($recheck.detail)"
      }
    }
  }
}

# 第二层：公网入口。只有本机健康时公网失败才说明隧道有问题。
# 云桌面的 DNS 可能被本地代理影响，所以阈值放得比本机宽。
if ($localFailures -eq 0 -and (Test-Path -LiteralPath $publicUrlPath)) {
  $publicUrl = (Get-Content -LiteralPath $publicUrlPath -Raw).Trim().TrimEnd("/")
  if ($publicUrl.StartsWith("https://")) {
    $publicResult = Test-HealthEndpoint "$publicUrl/api/health" 25

    if ($publicResult.ok) {
      if ($publicFailures -gt 0) {
        Write-WatchdogLog "Public health recovered at $publicUrl ($($publicResult.detail))"
      }
      $publicFailures = 0
    } else {
      $publicFailures += 1
      Write-WatchdogLog "Public health check failed at $publicUrl ($publicFailures/$PublicFailureThreshold): $($publicResult.detail)"

      if ($publicFailures -ge $PublicFailureThreshold) {
        if (Restart-TrialTask $TunnelTaskName) {
          $publicFailures = 0
        }
      }
    }
  }
}

Save-WatchdogState ([pscustomobject]@{
  localFailures = $localFailures
  publicFailures = $publicFailures
  lastCheckedAt = (Get-Date -Format o)
})
