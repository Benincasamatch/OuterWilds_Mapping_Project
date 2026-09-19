# Passive performance sampler. Does NOT change windows, wallpaper or host settings.
param(
  [ValidateRange(10,3600)][int]$Seconds=600,
  [ValidateRange(2,30)][int]$Interval=5,
  [ValidatePattern('^[a-z0-9-]+$')][string]$Label='desktop'
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=Join-Path $root '.desktop-test'
[void][IO.Directory]::CreateDirectory($output)
$log=Join-Path $output ($Label+'-samples.jsonl')
if(Test-Path -LiteralPath $log){throw "Report exists; choose a new label: $Label"}
$cores=[Environment]::ProcessorCount
$stopwatch=[Diagnostics.Stopwatch]::StartNew()
$previous=@{}; $previousAt=0; $records=New-Object System.Collections.Generic.List[object]
function Read-Pool {
  @(Get-Process -Name webwallpaper64,wallpaperui,wallpaper64 -ErrorAction SilentlyContinue | ForEach-Object {
    try { [pscustomobject]@{id=$_.Id;name=$_.ProcessName;cpu=$_.TotalProcessorTime.TotalSeconds;ws=$_.WorkingSet64} } catch {}
  })
}
foreach($p in (Read-Pool)){$previous[$p.id]=$p.cpu}
while($previousAt -lt $Seconds){
  Start-Sleep -Seconds $Interval
  $stamp=$stopwatch.Elapsed.TotalSeconds
  $pool=Read-Pool; $cpuPool=0.0; $cpuHost=0.0; $wsPool=0L; $wsHost=0L; $next=@{}
  foreach($p in $pool){
    $next[$p.id]=$p.cpu
    $delta=if($previous.ContainsKey($p.id)){[Math]::Max(0.0,[double]($p.cpu-$previous[$p.id]))}else{0}
    if($p.name -eq 'wallpaper64'){$cpuHost+=$delta;$wsHost+=$p.ws}else{$cpuPool+=$delta;$wsPool+=$p.ws}
  }
  $ids=@($pool | Where-Object name -ne 'wallpaper64' | ForEach-Object id)
  $gpuValid=$false;$gpuSum=$null;$gpuMax=$null;$errorText=$null
  try {
    $counterErrors=@()
    $counter=Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue -ErrorVariable counterErrors
    if(-not $counter -or $ids.Count -eq 0){throw 'No CEF/UI process or no GPU counter data'}
    $matching=0; $badMatching=0
    $gpuSum=0.0;$gpuMax=0.0
    foreach($c in $counter.CounterSamples){
      if($c.InstanceName -match '^pid_(\d+)_' -and $ids -contains [int]$Matches[1]){
        if($c.Status -ne 0){$badMatching++;continue}
        $matching++
        $value=[Math]::Max(0,[double]$c.CookedValue)
        $gpuSum+=$value;$gpuMax=[Math]::Max($gpuMax,$value)
      }
    }
    $gpuValid=$matching -gt 0 -and $badMatching -eq 0
    if(-not $gpuValid){$errorText='Missing or invalid GPU counter for target process'}
  }catch{$errorText=$_.Exception.Message}
  $record=[ordered]@{utc=(Get-Date).ToUniversalTime().ToString('o');elapsedS=$stamp;intervalS=($stamp-$previousAt);
    cefAndUiCpuPct=100*$cpuPool/($stamp-$previousAt)/$cores;hostCpuPct=100*$cpuHost/($stamp-$previousAt)/$cores;
    cefAndUiWorkingSetMB=$wsPool/1MB;hostWorkingSetMB=$wsHost/1MB;gpuEngineSumPct=$gpuSum;gpuLargestEnginePct=$gpuMax;gpuValid=$gpuValid;
    pids=@($pool | Select-Object id,name);gpuError=$errorText}
  $json=$record|ConvertTo-Json -Compress -Depth 5
  [IO.File]::AppendAllText($log,$json+[Environment]::NewLine)
  $records.Add([pscustomobject]$record)
  $previous=$next;$previousAt=$stamp
}
$summary=[ordered]@{label=$Label;requestedSeconds=$Seconds;sampledSeconds=$previousAt;samples=$records.Count;logicalProcessors=$cores;
  cpuAveragePct=(($records | ForEach-Object { $_.cefAndUiCpuPct*$_.intervalS } | Measure-Object -Sum).Sum/$previousAt);cpuMaxPct=($records|Measure-Object cefAndUiCpuPct -Maximum).Maximum;
  gpuEngineSumAveragePct=($records|Where-Object gpuValid|Measure-Object gpuEngineSumPct -Average).Average;
  gpuEngineSumMaxPct=($records|Where-Object gpuValid|Measure-Object gpuEngineSumPct -Maximum).Maximum;
  gpuValidSamples=@($records|Where-Object gpuValid).Count;
  workingSetAverageMB=($records|Measure-Object cefAndUiWorkingSetMB -Average).Average;
  notes='CEF pool + wallpaperui CPU/working set; host separate. GPU is sum of process engine counters, not Task Manager whole-GPU percentage. Correlate renderer liveness separately; process activity alone does not prove a running wallpaper.'}
$summary|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $output ($Label+'-summary.json')) -Encoding utf8
$summary|ConvertTo-Json -Depth 5


