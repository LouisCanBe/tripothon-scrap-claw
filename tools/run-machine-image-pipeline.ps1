# 机柜：Seedream 单图 → Tripo image-to-model（易整柜化，优先用 run-machine-multiview-pipeline.ps1）
#   .\tools\run-machine-image-pipeline.ps1
#   .\tools\run-machine-image-pipeline.ps1 -SkipImages -Only "machine_frame,machine_top"
param(
  [switch]$SkipImages,
  [switch]$SkipBackup,
  [string]$Only = '',
  [int]$ImgParallel = 2,
  [int]$TripoParallel = 3
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
Remove-Item Env:TRIPO_API_BASE -ErrorAction SilentlyContinue

if (-not $SkipBackup) {
  .\tools\backup-machine-glb.ps1 -Ids 'machine_base,machine_frame,machine_top,machine_back,machine_panel' -Tag 'pre-img-pipeline'
}

if (-not $SkipImages) {
  $imgArgs = @('tools/gen-machine-part-images.mjs')
  if ($ImgParallel -gt 1) { $imgArgs += '--parallel' }
  if ($Only) {
    foreach ($part in ($Only -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
      $imgArgs += $part.Replace('machine_', '')
    }
  }
  Write-Host "node $($imgArgs -join ' ')"
  & node @imgArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$genArgs = @('tools/generate.mjs', '--set', 'machine-img', '--parallel', "$TripoParallel", '--force')
if ($Only) { $genArgs += '--only'; $genArgs += $Only }
Write-Host "node $($genArgs -join ' ')"
& node @genArgs
