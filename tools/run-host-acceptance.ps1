# Approved desktop acceptance sequence. Uses only the official WE CLI and passive counters.
# Always restores the selected monitor even if a phase fails. No mouse injection or icon changes.
param(
  [ValidateRange(0,16)][int]$Monitor=2,
  [ValidateRange(10,3600)][int]$Seconds=600,
  [ValidatePattern('^[a-z0-9-]+$')][string]$Run='primary-20260919'
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$statePath=Join-Path $root '.desktop-test/restore-state.json'
if(-not(Test-Path -LiteralPath $statePath)){throw 'Capture restoration state before running'}
$state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
$we=$state.weExecutable
$key="Monitor$Monitor"
$original=$state.selectedWallpapers.$key.file
if(-not $original -or -not(Test-Path -LiteralPath $original)){throw 'Original wallpaper unavailable; refusing to switch'}
function Set-Wallpaper([string]$file){
  $args=@('-control','openWallpaper','-file',('"'+$file+'"'),'-monitor',[string]$Monitor)
  $process=Start-Process -FilePath $we -ArgumentList $args -WindowStyle Hidden -Wait -PassThru
  if($process.ExitCode -ne 0){throw "WE command exited $($process.ExitCode)"}
  Start-Sleep -Seconds 4
}
$phases=@('idle','active','peak')
$record=[ordered]@{run=$Run;monitor=$Monitor;start=(Get-Date).ToUniversalTime().ToString('o');phases=@();restore='pending'}
try {
  foreach($phase in $phases){
    $duration=if($phase -eq 'peak'){60}else{$Seconds}
    $file=Join-Path $root ".desktop-test/runtime-$phase/project.json"
    if(-not(Test-Path -LiteralPath $file)){throw "Build diagnostic wrapper first: $phase"}
    $start=(Get-Date).ToUniversalTime().ToString('o')
    Set-Wallpaper $file
    Start-Sleep -Seconds 8
    Write-Output "Starting $phase, duration $duration seconds"
    & (Join-Path $PSScriptRoot 'measure-host.ps1') -Seconds $duration -Interval 5 -Label "$Run-$phase"
    $record.phases+=@{mode=$phase;start=$start;end=(Get-Date).ToUniversalTime().ToString('o');requestedSeconds=$duration}
    $record|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $root ".desktop-test/$Run-sequence.json") -Encoding utf8
  }
} finally {
  try { Set-Wallpaper $original; $record.restore='command-succeeded; verify actual config separately' }
  catch { $record.restore='FAILED: '+$_.Exception.Message; Write-Warning $record.restore }
  $record.end=(Get-Date).ToUniversalTime().ToString('o')
  $record|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $root ".desktop-test/$Run-sequence.json") -Encoding utf8
}
