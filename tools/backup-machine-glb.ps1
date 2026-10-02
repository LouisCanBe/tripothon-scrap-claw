# 将指定机柜 GLB 复制到 archive（再生前保留备用）
#   .\tools\backup-machine-glb.ps1 -Ids "machine_top,machine_back,machine_panel"
param(
  [string]$Ids = 'machine_top,machine_back,machine_panel',
  [string]$Tag = 'spare'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Machine = Join-Path $Root 'prototype\assets\machine'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$Dest = Join-Path $Machine "archive\$Tag-$Stamp"
New-Item -ItemType Directory -Path $Dest -Force | Out-Null

$n = 0
foreach ($id in ($Ids -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
  $src = Join-Path $Machine "$id.glb"
  if (-not (Test-Path $src)) {
    Write-Host "跳过（不存在）: $id"
    continue
  }
  Copy-Item $src (Join-Path $Dest "$id.glb")
  $n++
}
Write-Host "已备份 $n 件 → $Dest"
