$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$toolsDirectory = Join-Path $workspaceRoot 'work\installer-tools'
$nsisArchive = Join-Path $toolsDirectory 'nsis.zip'
$nsisDirectory = Join-Path $toolsDirectory 'nsis\nsis-3.11'
$makeNsis = Join-Path $nsisDirectory 'makensis.exe'
$webViewBootstrapper = Join-Path $toolsDirectory 'MicrosoftEdgeWebview2Setup.exe'
$appExecutable = Join-Path $workspaceRoot 'apps\desktop\src-tauri\target\release\freetalk.exe'
$appIcon = Join-Path $workspaceRoot 'apps\desktop\src-tauri\icons\icon.ico'
$outputDirectory = Join-Path $workspaceRoot 'outputs'
$version = (Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'package.json') | ConvertFrom-Json).version
$installer = Join-Path $outputDirectory "FreeTalk_${version}_x64-setup.exe"
$portable = Join-Path $outputDirectory "FreeTalk_${version}_portable_x64.exe"

New-Item -ItemType Directory -Force -Path $toolsDirectory, $outputDirectory | Out-Null

function Get-FileWithNode([string]$Url, [string]$Destination) {
  $download = 'const [url,path]=process.argv.slice(1);fetch(url).then(r=>{if(!r.ok)throw Error(String(r.status));return r.arrayBuffer()}).then(b=>require("fs").writeFileSync(path,Buffer.from(b)))'
  & node -e $download $Url $Destination
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}

if (-not (Test-Path -LiteralPath $makeNsis)) {
  Get-FileWithNode 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip' $nsisArchive
  Expand-Archive -LiteralPath $nsisArchive -DestinationPath (Split-Path $nsisDirectory) -Force
}
if (-not (Test-Path -LiteralPath $webViewBootstrapper)) {
  Get-FileWithNode 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' $webViewBootstrapper
}
if (-not (Test-Path -LiteralPath $appExecutable)) {
  throw "Release executable not found. Run: pnpm --filter @freetalk/desktop tauri build --no-bundle"
}

Copy-Item -LiteralPath $appExecutable -Destination $portable -Force
& $makeNsis "/DAPP_EXE=$appExecutable" "/DOUTPUT_FILE=$installer" "/DWEBVIEW_BOOTSTRAPPER=$webViewBootstrapper" "/DAPP_ICON=$appIcon" (Join-Path $workspaceRoot 'scripts\windows\installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'NSIS compilation failed' }

Write-Output "Created: $installer"
Write-Output "Created: $portable"
