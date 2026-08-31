$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $workspaceRoot 'outputs'
$version = (Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'apps\admin\package.json') | ConvertFrom-Json).version
$targetDirectory = Join-Path $workspaceRoot 'apps\admin\src-tauri\target\release'
$appExecutable = Join-Path $targetDirectory 'freetalk-admin.exe'
$tauriInstaller = Join-Path $targetDirectory "bundle\nsis\FreeTalk Admin_${version}_x64-setup.exe"
$installer = Join-Path $outputDirectory "FreeTalk_Admin_${version}_x64-setup.exe"
$portable = Join-Path $outputDirectory "FreeTalk_Admin_${version}_portable_x64.exe"
$localBundleConfig = '../../scripts/windows/tauri-local-unsigned.json'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  $cargoDirectory = Join-Path $env:USERPROFILE '.cargo\bin'
  $cargoExecutable = Join-Path $cargoDirectory 'cargo.exe'
  if (-not (Test-Path -LiteralPath $cargoExecutable)) {
    throw "Cargo was not found in PATH or at $cargoExecutable"
  }
  $env:PATH = "$cargoDirectory;$env:PATH"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& pnpm --filter '@freetalk/admin' tauri build --bundles nsis --config $localBundleConfig
if ($LASTEXITCODE -ne 0) { throw 'FreeTalk Admin Tauri NSIS build failed' }
if (-not (Test-Path -LiteralPath $tauriInstaller)) { throw "Installer not found: $tauriInstaller" }
if (-not (Test-Path -LiteralPath $appExecutable)) { throw "Executable not found: $appExecutable" }

Copy-Item -LiteralPath $tauriInstaller -Destination $installer -Force
Copy-Item -LiteralPath $appExecutable -Destination $portable -Force
Write-Output "Created: $installer"
Write-Output "Created: $portable"
