$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$outputDirectory = Join-Path $workspaceRoot 'outputs\production-server'
$apiVersion = (Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'apps\api\package.json') | ConvertFrom-Json).version
$signalingVersion = (Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'apps\signaling\package.json') | ConvertFrom-Json).version
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$stagingRoot = Join-Path $outputDirectory "staging-$timestamp"
$apiStaging = Join-Path $stagingRoot 'api'
$protocolStaging = Join-Path $apiStaging 'vendor\protocol'
$apiArtifact = Join-Path $outputDirectory "freetalk-api-$apiVersion-$timestamp.tar.gz"
$signalingArtifact = Join-Path $outputDirectory "freetalk-signaling-$signalingVersion-$timestamp.mjs"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force -Path $protocolStaging | Out-Null
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'apps\api\dist') -Destination $apiStaging -Recurse
Copy-Item -LiteralPath (Join-Path $workspaceRoot 'apps\api\migrations') -Destination $apiStaging -Recurse

$apiPackage = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot 'apps\api\package.json') | ConvertFrom-Json
$apiPackage.dependencies.'@freetalk/protocol' = 'file:./vendor/protocol'
$apiPackageJson = $apiPackage | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText((Join-Path $apiStaging 'package.json'), $apiPackageJson, $utf8NoBom)

$protocolPackage = [ordered]@{
  name = '@freetalk/protocol'
  version = '0.1.0'
  private = $true
  type = 'module'
  exports = './index.js'
  dependencies = [ordered]@{ zod = '^4.1.5' }
}
$protocolPackageJson = $protocolPackage | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $protocolStaging 'package.json'), $protocolPackageJson, $utf8NoBom)

$protocolEntry = Join-Path $workspaceRoot 'packages\protocol\src\index.ts'
$protocolOutput = Join-Path $protocolStaging 'index.js'
& pnpm --filter '@freetalk/signaling' exec esbuild $protocolEntry --bundle --platform=node --format=esm --external:zod "--outfile=$protocolOutput"
if ($LASTEXITCODE -ne 0) { throw 'Protocol deployment bundle failed' }

& node --check (Join-Path $apiStaging 'dist\server.js')
if ($LASTEXITCODE -ne 0) { throw 'API server syntax check failed' }
& node --check (Join-Path $apiStaging 'dist\migrate.js')
if ($LASTEXITCODE -ne 0) { throw 'API migrator syntax check failed' }

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& tar -czf $apiArtifact -C $apiStaging .
if ($LASTEXITCODE -ne 0) { throw 'API archive creation failed' }

Copy-Item -LiteralPath (Join-Path $workspaceRoot 'apps\signaling\dist\server.bundle.mjs') -Destination $signalingArtifact
& node --check $signalingArtifact
if ($LASTEXITCODE -ne 0) { throw 'Signaling bundle syntax check failed' }

Get-FileHash -Algorithm SHA256 -LiteralPath $apiArtifact, $signalingArtifact |
  Select-Object Path, Hash
