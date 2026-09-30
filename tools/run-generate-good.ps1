# 好版 16 件奖品：避开失效代理，默认走国内 openapi.tripo3d.com
# 用法：
#   .\tools\run-generate-good.ps1
#   .\tools\run-generate-good.ps1 -Only bread,can,veg
#   .\tools\run-generate-good.ps1 -Force
param(
  [string]$Only = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Remove-Item Env:HTTPS_PROXY, Env:HTTP_PROXY, Env:https_proxy, Env:http_proxy -ErrorAction SilentlyContinue
$env:NODE_USE_ENV_PROXY = ''
if (-not $env:TRIPO_API_BASE) { $env:TRIPO_API_BASE = 'https://openapi.tripo3d.com/v3' }

$argsList = @('tools/generate.mjs', '--set', 'good')
if ($Force) { $argsList += '--force' }
if ($Only) { $argsList += '--only'; $argsList += $Only }

Write-Host "TRIPO_API_BASE=$($env:TRIPO_API_BASE)"
Write-Host "node $($argsList -join ' ')"
& node @argsList
