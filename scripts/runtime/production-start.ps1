$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$statePath = Join-Path $root 'data\runtime\state.json'
if (-not (Test-Path $statePath)) { throw 'Missing runtime state.' }

$state = Get-Content -Raw $statePath | ConvertFrom-Json
$active = $state.active
if ($null -eq $active) { throw 'No active release is available.' }

$releaseDir = [string]$active.releaseDir
if (-not (Test-Path $releaseDir)) { throw 'The active release directory is missing.' }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$frontendPort = [int]$active.frontendPort
$backendPort = [int]$active.backendPort
$vinextPort = if ([string]$active.slot -eq 'a') { 3300 } else { 3301 }

function Test-Endpoint([string]$url) {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3).StatusCode -eq 200 }
  catch { return $false }
}

function Get-ListeningPid([int]$port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $listener) { return $null }
  return [int]$listener.OwningProcess
}

function Wait-ForEndpoint([string]$url, [string]$name) {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-Endpoint $url) { return }
    Start-Sleep -Milliseconds 500
  }
  throw ('Timed out while starting {0}: {1}' -f $name, $url)
}

function Start-CmdProcess([string]$workingDirectory, [string]$command) {
  return Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', $command) -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru
}

$backendHealth = 'http://127.0.0.1:{0}/api/health' -f $backendPort
if (-not (Test-Endpoint $backendHealth)) {
  $backendCommand = 'set "FC_DB_PATH={0}\data\fc-support.db" && set "FC_COLLECT_ON_EMPTY=false" && set "FC_COLLECT_ON_STALE=false" && set "FC_RECOVER_ABANDONED_SNAPSHOTS=false" && set "FC_BACKEND_PORT={1}" && set "FC_FRONTEND_ORIGIN=https://fc-support.kr" && "{2}" --env-file-if-exists="{0}\.env" server\index.mjs' -f $root, $backendPort, $node
  [void](Start-CmdProcess $releaseDir $backendCommand)
}
Wait-ForEndpoint $backendHealth 'backend'

$frontendHealth = 'http://127.0.0.1:{0}/' -f $frontendPort
if (-not (Test-Endpoint $frontendHealth)) {
  $frontendCommand = 'set "FC_DB_PATH={0}\data\fc-support.db" && set "FC_COLLECT_ON_EMPTY=false" && set "FC_COLLECT_ON_STALE=false" && set "FC_RECOVER_ABANDONED_SNAPSHOTS=false" && set "PORT={1}" && set "NEXT_PUBLIC_API_BASE_URL=http://localhost:8787" && "{2}" scripts\runtime\frontend-server.mjs port={1} vinextPort={3}' -f $root, $frontendPort, $node, $vinextPort
  [void](Start-CmdProcess $releaseDir $frontendCommand)
}
Wait-ForEndpoint $frontendHealth 'frontend'

if (-not (Test-Endpoint 'http://127.0.0.1:8799/')) {
  $proxyCommand = '"{0}" scripts\runtime\proxy.mjs' -f $node
  [void](Start-CmdProcess $root $proxyCommand)
}
Wait-ForEndpoint 'http://127.0.0.1:8799/' 'switcher'

$active.frontendPid = Get-ListeningPid $frontendPort
$active.backendPid = Get-ListeningPid $backendPort
$state.proxyPid = Get-ListeningPid 3000
$state.active = $active
$state | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $statePath

Write-Output ('Active release {0} restored. frontend={1} backend={2} proxy=3000' -f $active.releaseId, $frontendPort, $backendPort)
