param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210,
  [string]$ServerTaskName = "JeffOrderToolCloudTrialServer",
  [ValidateSet("auto", "http2", "quic")]
  [string]$Protocol = "http2"
)

$ErrorActionPreference = "Stop"

function Set-TextAtomically([string]$Path, [string]$Value) {
  $tempPath = "$Path.$PID.tmp"
  Set-Content -LiteralPath $tempPath -Value $Value -Encoding utf8
  Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

$root = [System.IO.Path]::GetFullPath($InstallRoot)
$cloudflaredPath = Join-Path $root "tools\cloudflared.exe"
$logDir = Join-Path $root "logs"
$wrapperLog = Join-Path $logDir "tunnel-wrapper.log"
$runId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
$stdoutLog = Join-Path $logDir "cloudflared-$runId.stdout.log"
$stderrLog = Join-Path $logDir "cloudflared-$runId.stderr.log"
$currentLogsPath = Join-Path $logDir "cloudflared-current-logs.txt"
$publicUrlPath = Join-Path $root "public-url.txt"
$addressPath = Join-Path $root "Jeff-cloud-trial-address.txt"
$loginInfoPath = Join-Path $root "Jeff-cloud-trial-login.txt"
$configPath = Join-Path $root "config\trial.env"
$publicDesktopAddressPath = "C:\Users\Public\Desktop\Jeff-cloud-trial-address.txt"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  throw "cloudflared not found: $cloudflaredPath"
}

$previousUrl = ""
if (Test-Path -LiteralPath $publicUrlPath) {
  $previousUrl = (Get-Content -LiteralPath $publicUrlPath -Raw).Trim()
}

$normalizedCloudflaredPath = $cloudflaredPath.ToLowerInvariant()
Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant() -eq $normalizedCloudflaredPath
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Set-TextAtomically $currentLogsPath (@(
  "stdout=$stdoutLog",
  "stderr=$stderrLog"
) -join [Environment]::NewLine)
"[$(Get-Date -Format o)] Starting Cloudflare Quick Tunnel for 127.0.0.1:$Port with $Protocol" |
  Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append

$process = Start-Process `
  -FilePath $cloudflaredPath `
  -ArgumentList @(
    "tunnel",
    "--url",
    "http://127.0.0.1:$Port",
    "--protocol",
    $Protocol,
    "--no-autoupdate"
  ) `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

try {
  $publicUrl = ""
  for ($attempt = 0; $attempt -lt 120 -and -not $process.HasExited; $attempt += 1) {
    $combined = ""
    if (Test-Path -LiteralPath $stdoutLog) {
      $combined += Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrLog) {
      $combined += Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
    }

    $match = [regex]::Match($combined, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) {
      $publicUrl = $match.Value.TrimEnd("/")
      break
    }

    Start-Sleep -Seconds 1
    $process.Refresh()
  }

  if (-not $publicUrl) {
    throw "Cloudflare Quick Tunnel did not publish a URL. See $stderrLog"
  }

  Set-TextAtomically $publicUrlPath $publicUrl
  $addressText = @(
    "Jeff Order Tool cloud trial",
    "",
    "Address: $publicUrl",
    "Updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "",
    "This temporary address can change after a server or tunnel restart."
  ) -join [Environment]::NewLine
  Set-TextAtomically $addressPath $addressText
  New-Item -ItemType Directory -Force -Path (Split-Path $publicDesktopAddressPath) | Out-Null
  Set-TextAtomically $publicDesktopAddressPath $addressText

  $adminPassword = ""
  foreach ($line in Get-Content -LiteralPath $configPath -ErrorAction SilentlyContinue) {
    if ($line -match '^JEFF_ADMIN_PASSWORD=(.*)$') {
      $adminPassword = $Matches[1]
      break
    }
  }
  if ($adminPassword) {
    $packageJsonPath = Join-Path $root "app\server\package.json"
    $version = if (Test-Path -LiteralPath $packageJsonPath) {
      (Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json).version
    } else {
      "unknown"
    }
    $loginText = @(
      "Jeff Order Tool cloud trial",
      "",
      "Address: $publicUrl",
      "Password: $adminPassword",
      "Version: $version",
      "Updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
      "",
      "The address is temporary and can change after a server or tunnel restart.",
      "The cloud trial database is separate from Jeff's offline database."
    ) -join [Environment]::NewLine
    Set-TextAtomically $loginInfoPath $loginText
    & icacls.exe $loginInfoPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  }

  "[$(Get-Date -Format o)] Published $publicUrl" |
    Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append

  $serverTask = Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue
  if ($serverTask) {
    if ($previousUrl -and $previousUrl -ne $publicUrl -and $serverTask.State -eq "Running") {
      Stop-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Start-ScheduledTask -TaskName $ServerTaskName
    } elseif ($serverTask.State -ne "Running") {
      Start-ScheduledTask -TaskName $ServerTaskName
    }
  }

  $process.WaitForExit()
  $exitCode = $process.ExitCode
  "[$(Get-Date -Format o)] cloudflared exited with code $exitCode" |
    Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append
  exit $exitCode
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
