# 好版奖品：读根目录 .env.local（TRIPO_API_KEY / TRIPO_API_BASE / HTTPS_PROXY）
# 用法：
#   .\tools\run-generate-good.ps1 -Force
#   .\tools\run-generate-good.ps1 -Force -Only "bread,can,veg"
#   .\tools\run-generate-good.ps1 -Force -NoProxy   # 仅当代理端口失效、需直连 .com 时用
param(
  [string]$Only = '',
  [switch]$Force,
  [switch]$NoProxy
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if ($NoProxy) {
  Remove-Item Env:HTTPS_PROXY, Env:HTTP_PROXY, Env:https_proxy, Env:http_proxy -ErrorAction SilentlyContinue
  $env:NODE_USE_ENV_PROXY = ''
}
# 勿在 shell 里写死 TRIPO_API_BASE：国际站 key 打 .com 会 Invalid API key；域名以 .env.local 为准
Remove-Item Env:TRIPO_API_BASE -ErrorAction SilentlyContinue

$argsList = @('tools/generate.mjs', '--set', 'good')
if ($Force) { $argsList += '--force' }
if ($Only) { $argsList += '--only'; $argsList += $Only }

Write-Host "node $($argsList -join ' ')"
& node @argsList
