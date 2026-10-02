# 机柜：每件 4 视图 Seedream → Tripo P2 multiview-to-model（推荐，替代单图）
#   .\tools\run-machine-multiview-pipeline.ps1
#   .\tools\run-machine-multiview-pipeline.ps1 -Only "machine_base,machine_back" -SkipImages
param(
  [switch]$SkipImages,
  [switch]$SkipBackup,
  [string]$Only = '',
  [int]$TripoParallel = 2
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
Remove-Item Env:TRIPO_API_BASE -ErrorAction SilentlyContinue

if (-not $SkipBackup) {
  $ids = if ($Only) { $Only } else { 'machine_base,machine_frame,machine_top,machine_back,machine_panel' }
  .\tools\backup-machine-glb.ps1 -Ids $ids -Tag 'pre-mv-pipeline'
}

if (-not $SkipImages) {
  $imgArgs = @('tools/gen-machine-part-multiview-images.mjs', '--parallel')
  if ($Only) {
    foreach ($part in ($Only -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
      $imgArgs += $part.Replace('machine_', '')
    }
  }
  & node @imgArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$genArgs = @('tools/generate.mjs', '--set', 'machine-mv', '--parallel', "$TripoParallel", '--force')
if ($Only) { $genArgs += '--only'; $genArgs += $Only }
& node @genArgs
