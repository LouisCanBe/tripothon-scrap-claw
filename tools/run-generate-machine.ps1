# 娃娃机外壳 Tripo 分件（P2 减面）
#   .\tools\run-generate-machine.ps1 -Force
#   .\tools\run-generate-machine.ps1 -Force -Only "machine_base,machine_frame" -Parallel 2
param(
  [string]$Only = '',
  [switch]$Force,
  [switch]$NoProxy,
  [int]$Parallel = 3
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if ($NoProxy) {
  Remove-Item Env:HTTPS_PROXY, Env:HTTP_PROXY, Env:https_proxy, Env:http_proxy -ErrorAction SilentlyContinue
  $env:NODE_USE_ENV_PROXY = ''
}
Remove-Item Env:TRIPO_API_BASE -ErrorAction SilentlyContinue

$argsList = @('tools/generate.mjs', '--set', 'machine', '--parallel', "$Parallel")
if ($Force) { $argsList += '--force' }
if ($Only) { $argsList += '--only'; $argsList += $Only }

Write-Host "node $($argsList -join ' ')"
& node @argsList
