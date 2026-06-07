$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$installerScript = Join-Path $root "installer\JeffOrderTool.iss"
$outputDir = Join-Path $root "release-installers"
$installerPath = Join-Path $outputDir "JeffOrderToolSetup-v$version.exe"

function Find-InnoSetupCompiler {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command iscc -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Inno Setup Compiler (ISCC.exe) was not found. Install Inno Setup 6 first."
}

Push-Location $root
try {
  & npm run package:desktop
  if ($LASTEXITCODE -ne 0) {
    throw "npm run package:desktop failed."
  }
}
finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue

$iscc = Find-InnoSetupCompiler
Push-Location (Join-Path $root "installer")
try {
  & $iscc "/DMyAppVersion=$version" $installerScript
  if ($LASTEXITCODE -ne 0) {
    throw "ISCC failed."
  }
}
finally {
  Pop-Location
}

if (!(Test-Path $installerPath)) {
  throw "Installer was not created: $installerPath"
}

Write-Host "Installer created:" $installerPath
