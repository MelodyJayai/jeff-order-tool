$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$appName = "JeffOrderTool"
$releaseRoot = Join-Path $root "release"
$appDir = Join-Path $releaseRoot $appName
$serverDir = Join-Path $appDir "server"
$runtimeDir = Join-Path $appDir "runtime"
$dataDir = Join-Path $appDir "data"
$supportDir = Join-Path $appDir "SupportFiles"

function New-TextFromCodePoints($values) {
  return -join ($values | ForEach-Object { [char]$_ })
}

function Copy-Directory($source, $destination) {
  if (Test-Path $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  }
}

function Find-Csc {
  $candidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "csc.exe was not found. Cannot compile Windows launcher."
}

Push-Location $root
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed."
  }
}
finally {
  Pop-Location
}

if (Test-Path $appDir) {
  Remove-Item -LiteralPath $appDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $serverDir, $runtimeDir, $dataDir, $supportDir | Out-Null

Copy-Directory (Join-Path $root ".next\standalone") $serverDir
$tracedDataDir = Join-Path $serverDir "data"
if (Test-Path $tracedDataDir) {
  Remove-Item -LiteralPath $tracedDataDir -Recurse -Force
}

Copy-Directory (Join-Path $root ".next\static") (Join-Path $serverDir ".next\static")

$publicDir = Join-Path $root "public"
if (Test-Path $publicDir) {
  Copy-Directory $publicDir (Join-Path $serverDir "public")
}

$nodeExe = Join-Path (Split-Path (Get-Command node).Source) "node.exe"
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeDir "node.exe") -Force

$csc = Find-Csc
$openExeName = New-TextFromCodePoints @(0x6253, 0x5F00, 0x004A, 0x0065, 0x0066, 0x0066, 0x8BA2, 0x5355, 0x5DE5, 0x5177, 0x002E, 0x0065, 0x0078, 0x0065)
$launcherExe = Join-Path $appDir $openExeName
$shutdownExe = Join-Path $supportDir "CloseJeffOrderTool.exe"
& $csc /nologo /target:winexe /platform:anycpu /codepage:65001 /reference:System.Windows.Forms.dll "/out:$launcherExe" (Join-Path $root "desktop\JeffOrderToolLauncher.cs")
if ($LASTEXITCODE -ne 0) {
  throw "Launcher compile failed."
}

& $csc /nologo /target:winexe /platform:anycpu /codepage:65001 /reference:System.Windows.Forms.dll "/out:$shutdownExe" (Join-Path $root "desktop\JeffOrderToolShutdown.cs")
if ($LASTEXITCODE -ne 0) {
  throw "Shutdown launcher compile failed."
}

Copy-Item -LiteralPath (Join-Path $root "desktop\README.txt") -Destination (Join-Path $appDir "README.txt") -Force

Write-Host "Desktop package created:" $appDir
