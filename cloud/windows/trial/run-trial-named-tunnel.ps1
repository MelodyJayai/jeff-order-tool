param(
  [string]$InstallRoot = "D:\JeffOrderToolCloudTrial",
  [int]$Port = 3210,
  [string]$Hostname = "",
  [string]$ServerTaskName = "JeffOrderToolCloudTrialServer",
  [string]$EdgeBindAddress = "",
  [ValidateSet("auto", "http2", "quic")]
  [string]$Protocol = "http2"
)

# Runs a Cloudflare *Named* Tunnel (remotely managed, token based).
# Unlike run-trial-tunnel.ps1 the public hostname is fixed and survives restarts.
#
# Prerequisites, created once in the Cloudflare dashboard:
#   Zero Trust -> Networks -> Tunnels -> Create tunnel (Cloudflared)
#   Public hostname:  <Hostname>  ->  http://127.0.0.1:<Port>
# The tunnel token is read from config\tunnel-token.txt so that it never
# appears in the scheduled-task definition or in the process command line.

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
$stdoutLog = Join-Path $logDir "cloudflared-named-$runId.stdout.log"
$stderrLog = Join-Path $logDir "cloudflared-named-$runId.stderr.log"
$currentLogsPath = Join-Path $logDir "cloudflared-current-logs.txt"
$publicUrlPath = Join-Path $root "public-url.txt"
$addressPath = Join-Path $root "Jeff-cloud-trial-address.txt"
$loginInfoPath = Join-Path $root "Jeff-cloud-trial-login.txt"
$configPath = Join-Path $root "config\trial.env"
$tokenPath = Join-Path $root "config\tunnel-token.txt"
$hostnamePath = Join-Path $root "config\tunnel-hostname.txt"
$publicDesktopAddressPath = "C:\Users\Public\Desktop\Jeff-cloud-trial-address.txt"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  throw "cloudflared not found: $cloudflaredPath"
}
if (-not (Test-Path -LiteralPath $tokenPath)) {
  throw "Tunnel token file not found: $tokenPath"
}

if (-not $Hostname) {
  if (-not (Test-Path -LiteralPath $hostnamePath)) {
    throw "No -Hostname given and $hostnamePath is missing."
  }
  $Hostname = (Get-Content -LiteralPath $hostnamePath -Raw).Trim()
}
$Hostname = $Hostname -replace '^https?://', '' -replace '/+$', ''
if (-not $Hostname) {
  throw "Resolved tunnel hostname is empty."
}

$tunnelToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
if (-not $tunnelToken) {
  throw "Tunnel token file is empty: $tokenPath"
}

# A lower-metric virtual default route can carry ordinary HTTPS traffic while
# breaking Cloudflare Tunnel TLS on port 7844. Prefer the physical IPv4 route.
if (-not $EdgeBindAddress) {
  $physicalRoute = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.NextHop -ne "0.0.0.0" -and
      $_.InterfaceAlias -notmatch "^(Meta|Tailscale)$"
    } |
    Sort-Object RouteMetric |
    Select-Object -First 1

  if ($physicalRoute) {
    $EdgeBindAddress = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $physicalRoute.InterfaceIndex -ErrorAction SilentlyContinue |
      Where-Object { $_.AddressState -eq "Preferred" } |
      Select-Object -ExpandProperty IPAddress -First 1
  }
}

$publicUrl = "https://$Hostname"

# Stop any cloudflared started from this install root, quick or named.
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
$edgeDescription = if ($EdgeBindAddress) { " via $EdgeBindAddress" } else { "" }
"[$(Get-Date -Format o)] Starting Cloudflare Named Tunnel $publicUrl -> 127.0.0.1:$Port with $Protocol$edgeDescription" |
  Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append

# The hostname is fixed, so publish it before cloudflared is even up.
Set-TextAtomically $publicUrlPath $publicUrl
$addressText = @(
  "Jeff Order Tool cloud",
  "",
  "Address: $publicUrl",
  "Updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
  "",
  "This address is permanent. It does not change when the server restarts."
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
    "Jeff Order Tool cloud",
    "",
    "Address: $publicUrl",
    "Password: $adminPassword",
    "Version: $version",
    "Updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "",
    "This address is permanent and safe to bookmark.",
    "The cloud database is a synchronized copy of Jeff's offline database."
  ) -join [Environment]::NewLine
  Set-TextAtomically $loginInfoPath $loginText
  & icacls.exe $loginInfoPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
}

$env:TUNNEL_TOKEN = $tunnelToken
$cloudflaredArguments = @(
  "tunnel",
  "--edge-ip-version",
  "4"
)
if ($EdgeBindAddress) {
  $cloudflaredArguments += @(
    "--edge-bind-address",
    $EdgeBindAddress
  )
}
$cloudflaredArguments += @(
  "--protocol",
  $Protocol,
  "--no-autoupdate",
  "run"
)
$process = Start-Process `
  -FilePath $cloudflaredPath `
  -ArgumentList $cloudflaredArguments `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

try {
  # Wait for cloudflared to register at least one connection before declaring success.
  $registered = $false
  for ($attempt = 0; $attempt -lt 120 -and -not $process.HasExited; $attempt += 1) {
    $combined = ""
    if (Test-Path -LiteralPath $stdoutLog) {
      $combined += Get-Content -LiteralPath $stdoutLog -Raw -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $stderrLog) {
      $combined += Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
    }
    if ($combined -match "Registered tunnel connection") {
      $registered = $true
      break
    }
    Start-Sleep -Seconds 1
    $process.Refresh()
  }

  if (-not $registered) {
    throw "Named tunnel did not register a connection. See $stderrLog"
  }

  "[$(Get-Date -Format o)] Named tunnel connected, serving $publicUrl" |
    Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append

  $serverTask = Get-ScheduledTask -TaskName $ServerTaskName -ErrorAction SilentlyContinue
  if ($serverTask -and $serverTask.State -ne "Running") {
    Start-ScheduledTask -TaskName $ServerTaskName
  }

  $process.WaitForExit()
  $exitCode = $process.ExitCode
  "[$(Get-Date -Format o)] cloudflared exited with code $exitCode" |
    Out-File -LiteralPath $wrapperLog -Encoding utf8 -Append
  exit $exitCode
} finally {
  $env:TUNNEL_TOKEN = $null
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
}
