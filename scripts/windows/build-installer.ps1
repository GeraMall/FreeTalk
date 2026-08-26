$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $workspaceRoot 'outputs'
$version = (Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'package.json') | ConvertFrom-Json).version
$appExecutable = Join-Path $workspaceRoot 'apps\desktop\src-tauri\target\release\freetalk.exe'
$tauriInstaller = Join-Path $workspaceRoot "apps\desktop\src-tauri\target\release\bundle\nsis\FreeTalk_${version}_x64-setup.exe"
$installer = Join-Path $outputDirectory "FreeTalk_${version}_x64-setup.exe"
$portable = Join-Path $outputDirectory "FreeTalk_${version}_portable_x64.exe"
$localBundleConfig = '../../scripts/windows/tauri-local-unsigned.json'

# Desktop shells do not always inherit rustup's PATH even when Rust is installed.
# Resolve the conventional per-user toolchain explicitly before invoking Tauri.
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  $cargoDirectory = Join-Path $env:USERPROFILE '.cargo\bin'
  $cargoExecutable = Join-Path $cargoDirectory 'cargo.exe'
  if (-not (Test-Path -LiteralPath $cargoExecutable)) {
    throw "Cargo was not found in PATH or at $cargoExecutable"
  }
  $env:PATH = "$cargoDirectory;$env:PATH"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

# Use Tauri's maintained NSIS template. The old handwritten fallback could remain
# alive without a visible window on some Windows installations.
& pnpm --filter '@freetalk/desktop' tauri build --bundles nsis --config $localBundleConfig
if ($LASTEXITCODE -ne 0) { throw 'Tauri NSIS build failed' }
if (-not (Test-Path -LiteralPath $tauriInstaller)) {
  throw "Tauri installer not found: $tauriInstaller"
}
if (-not (Test-Path -LiteralPath $appExecutable)) {
  throw "Release executable not found: $appExecutable"
}

Copy-Item -LiteralPath $tauriInstaller -Destination $installer -Force
Copy-Item -LiteralPath $appExecutable -Destination $portable -Force

Write-Output "Created: $installer"
Write-Output "Created: $portable"
