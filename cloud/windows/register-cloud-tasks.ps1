param(
  [string]$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$DataDir = "D:\JeffOrderToolCloud\data",
  [int]$Port = 3000,
  [string]$PublicUrl = "",
  [string]$ServerTaskName = "JeffOrderToolCloud",
  [string]$BackupTaskName = "JeffOrderToolCloudDailyBackup"
)

$ErrorActionPreference = "Stop"
$resolvedAppDir = (Resolve-Path $AppDir).Path
$serverScript = Join-Path $resolvedAppDir "cloud\windows\run-cloud-server.ps1"
$backupScript = Join-Path $resolvedAppDir "cloud\windows\run-cloud-backup.ps1"
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name

function Quote-Arg([string]$Value) {
  return '"' + $Value.Replace('"', '\"') + '"'
}

$serverArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", (Quote-Arg $serverScript),
  "-AppDir", (Quote-Arg $resolvedAppDir),
  "-DataDir", (Quote-Arg $DataDir),
  "-Port", $Port
)

if ($PublicUrl.Trim()) {
  $serverArgs += @("-PublicUrl", (Quote-Arg $PublicUrl.Trim()))
}

$backupArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", (Quote-Arg $backupScript),
  "-AppDir", (Quote-Arg $resolvedAppDir),
  "-DataDir", (Quote-Arg $DataDir)
)

$serverAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($serverArgs -join " ")
$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($backupArgs -join " ")
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 2:30am
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $ServerTaskName -Action $serverAction -Trigger $serverTrigger -Settings $settings -Principal $principal -Force | Out-Null
Register-ScheduledTask -TaskName $BackupTaskName -Action $backupAction -Trigger $backupTrigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered scheduled tasks:"
Write-Host "  $ServerTaskName - starts when $user logs on"
Write-Host "  $BackupTaskName - runs daily at 02:30"
Write-Host ""
Write-Host "Start now:"
Write-Host "  Start-ScheduledTask -TaskName $ServerTaskName"
