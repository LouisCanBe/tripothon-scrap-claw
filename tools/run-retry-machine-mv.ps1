# 仅重跑四视图 Tripo 建模（图已存在时用 -SkipImages）
#   .\tools\run-retry-machine-mv.ps1
#   .\tools\run-retry-machine-mv.ps1 -Only "machine_base,machine_back"
param(
  [string]$Only = 'machine_base,machine_back',
  [switch]$SkipImages,
  [int]$Parallel = 1
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
Remove-Item Env:TRIPO_API_BASE -ErrorAction SilentlyContinue

if ($SkipImages) {
  & .\tools\run-machine-multiview-pipeline.ps1 -SkipBackup -TripoParallel $Parallel -Only $Only -SkipImages
} else {
  & .\tools\run-machine-multiview-pipeline.ps1 -SkipBackup -TripoParallel $Parallel -Only $Only
}
