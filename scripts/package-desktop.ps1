$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceDir = Join-Path $root "release\JeffOrderTool"
$packageRoot = Join-Path $root "release-package"
$cleanDir = Join-Path $packageRoot "JeffOrderTool"
$archiveDir = Join-Path $root "release-archives"
$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$archivePath = Join-Path $archiveDir "JeffOrderTool-v$version.7z"

function Copy-Directory($source, $destination) {
  if (Test-Path $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }
}

function Find-7Zip {
  $candidates = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command 7z -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "7-Zip was not found. Install 7-Zip or add 7z.exe to PATH."
}

Push-Location $root
try {
  & npm run build:desktop
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build:desktop failed."
  }
}
finally {
  Pop-Location
}

if (!(Test-Path $sourceDir)) {
  throw "Desktop release folder was not found: $sourceDir"
}

New-Item -ItemType Directory -Force -Path $packageRoot, $archiveDir | Out-Null
Copy-Directory $sourceDir $cleanDir

$cleanDataDir = Join-Path $cleanDir "data"
$cleanLogsDir = Join-Path $cleanDir "logs"

if (Test-Path $cleanDataDir) {
  Remove-Item -LiteralPath $cleanDataDir -Recurse -Force
}
if (Test-Path $cleanLogsDir) {
  Remove-Item -LiteralPath $cleanLogsDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $cleanDataDir | Out-Null

Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue

$sevenZip = Find-7Zip
Push-Location $packageRoot
try {
  & $sevenZip a -t7z -mx=9 $archivePath "JeffOrderTool"
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip packaging failed."
  }
}
finally {
  Pop-Location
}

Write-Host "Clean desktop package created:" $archivePath
