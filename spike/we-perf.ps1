# Phase 0 Spike B - what does this wallpaper cost inside Wallpaper Engine?
#
# Attribution is the whole problem: CEF is multi-process and WE *pools* those processes, so
# "the pid that appeared at launch" is not reliably ours. This script therefore measures a
# DIFFERENTIAL over the whole webwallpaper64 pool:
#
#   phase A  our preview window closed      -> baseline (whatever else the desktop runs)
#   phase B  our preview window open, idleFps 15 (default)  -> + our wallpaper
#   phase C  same window, idleFps 60                        -> does the fps property bite?
#
# B - A is this wallpaper's marginal cost, in the same units as the plan's thresholds
# (CPU as a share of the whole machine, GPU as the sum of GPU Engine utilisation for the
# pool). Each phase also captures the window twice and reports how many pixels changed, so a
# throttled/blank surface cannot masquerade as a cheap one.
#
#   powershell -NoProfile -File spike/we-perf.ps1 -Seconds 25
param(
  [string]$Name = "OW Perf",
  [int]$Seconds = 25,
  [string]$Project = "$PSScriptRoot\..\wallpaper\project.json",
  [string]$WE = "E:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe",
  [int]$Width = 1024,
  [int]$Height = 640,
  [switch]$SkipBaseline
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Perf {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$cores = [Environment]::ProcessorCount
$script:log = New-Object System.Collections.Generic.List[string]

function Say([string]$s) { Write-Host $s; $script:log.Add($s) }

function Pool() {
  return @(Get-Process -Name webwallpaper64 -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
}
function Sum-Cpu([int[]]$ids) {
  $t = 0.0
  foreach ($i in $ids) { $p = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($p) { $t += $p.TotalProcessorTime.TotalSeconds } }
  return $t
}
function Sum-Ws([int[]]$ids) {
  $b = 0.0
  foreach ($i in $ids) { $p = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($p) { $b += $p.WorkingSet64 } }
  return $b / 1MB
}
function Gpu([int[]]$ids) {
  try {
    $s = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop
    $sum = 0.0
    foreach ($c in $s.CounterSamples) {
      foreach ($i in $ids) { if ($c.InstanceName -like "pid_${i}_*") { $sum += [double]$c.CookedValue; break } }
    }
    return $sum
  } catch { return -1 }
}
function Find-Window([string]$title) {
  $script:found = [IntPtr]::Zero
  $cb = [Perf+EnumProc] {
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [void][Perf]::GetWindowTextW($h, $sb, 512)
    if ($sb.ToString() -like "*$title*") { $script:found = $h; return $false }
    return $true
  }
  [void][Perf]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:found
}
function Grab([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return $null }
  [void][Perf]::ShowWindow($h, 9)
  Start-Sleep -Milliseconds 400
  $r = New-Object Perf+RECT
  [void][Perf]::GetClientRect($h, [ref]$r)
  $o = New-Object Perf+POINT
  [void][Perf]::ClientToScreen($h, [ref]$o)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -le 0 -or $hh -le 0 -or $o.X -lt -1000 -or $o.Y -lt -1000) { return $null }
  $bmp = New-Object System.Drawing.Bitmap $w, $hh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($o.X, $o.Y, 0, 0, (New-Object System.Drawing.Size $w, $hh))
  $g.Dispose()
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $hh
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $hh)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $stride = $data.Stride
  $bmp.UnlockBits($data)
  $bmp.Dispose()
  return [pscustomobject]@{ W = $w; H = $hh; Stride = $stride; Bytes = $bytes }
}

function DiffPct($a, $b) {
  if (-not $a -or -not $b -or $a.W -ne $b.W -or $a.H -ne $b.H) { return -1 }
  $n = 0; $d = 0
  for ($y = 4; $y -lt $a.H; $y += 4) {
    $row = $y * $a.Stride
    for ($x = 4; $x -lt $a.W; $x += 4) {
      $i = $row + $x * 4
      $n++
      if ([Math]::Abs($a.Bytes[$i] - $b.Bytes[$i]) -gt 6 -or
          [Math]::Abs($a.Bytes[$i + 1] - $b.Bytes[$i + 1]) -gt 6 -or
          [Math]::Abs($a.Bytes[$i + 2] - $b.Bytes[$i + 2]) -gt 6) { $d++ }
    }
  }
  if ($n -eq 0) { return -1 }
  return 100.0 * $d / $n
}

function Measure-Phase([string]$label, [IntPtr]$hwnd, [int[]]$ids) {
  $before = Grab $hwnd
  $c0 = Sum-Cpu $ids
  $w0 = Get-Date
  $gpu = @()
  for ($i = 0; $i -lt $Seconds; $i++) {
    Start-Sleep -Seconds 1
    if ($hwnd -ne [IntPtr]::Zero -and $i % 5 -eq 4) { [void][Perf]::SetForegroundWindow($hwnd) }
    $g = Gpu $ids
    if ($g -ge 0) { $gpu += $g }
  }
  # the pixel-diff below takes tens of seconds (GetPixel is slow); it must not dilute the
  # CPU share, so the measurement window ends here
  $wall = ((Get-Date) - $w0).TotalSeconds
  $cpu = (Sum-Cpu $ids) - $c0
  $after = Grab $hwnd
  $diff = DiffPct $before $after
  $avg = if ($gpu.Count) { ($gpu | Measure-Object -Average).Average } else { -1 }
  $max = if ($gpu.Count) { ($gpu | Measure-Object -Maximum).Maximum } else { -1 }
  $res = [pscustomobject]@{
    Label = $label; Wall = $wall; CpuDelta = $cpu; CpuPct = 100.0 * $cpu / $wall / $cores
    GpuAvg = $avg; GpuMax = $max; Changed = $diff; Ws = (Sum-Ws $ids); Procs = $ids.Count
  }
  Say ("{0,-28} wall={1:N1}s cpu={2:N2}s ({3:N2}% of machine)  gpu avg {4:N2}% / max {5:N2}%  pixelsChanged={6:N2}%  ws={7:N1} MB  procs={8}" -f `
    $res.Label, $res.Wall, $res.CpuDelta, $res.CpuPct, $res.GpuAvg, $res.GpuMax, $res.Changed, $res.Ws, $res.Procs)
  return $res
}

# --- make sure we start from "our window closed" -------------------------------
& $WE -control closeWallpaper -location $Name | Out-Null
Start-Sleep -Seconds 4
$ids = Pool
# An empty pool is normal when nothing web-based is running (the user's desktop wallpaper
# may be a video/scene wallpaper): the baseline is then simply "no CEF at all".
Say ("cef pool before: {0} processes, {1:N1} MB working set" -f $ids.Count, (Sum-Ws $ids))

if ($SkipBaseline) {
  $a = [pscustomobject]@{ Label = "A baseline (skipped)"; Wall = 0; CpuDelta = 0; CpuPct = 0; GpuAvg = 0; GpuMax = 0; Changed = -1; Ws = (Sum-Ws $ids); Procs = $ids.Count }
  Say "phase A skipped (no CEF process running -> baseline is 0)"
} else {
  Say "phase A: baseline (our wallpaper closed)"
  $a = Measure-Phase "A baseline" ([IntPtr]::Zero) $ids
}

Say "phase B: our wallpaper in a preview window, idleFps 15 (default)"
& $WE -control openWallpaper -file $Project -playInWindow $Name -width $Width -height $Height -activate | Out-Null
Start-Sleep -Seconds 10
$idsB = Pool
$hwnd = Find-Window $Name
if ($hwnd -eq [IntPtr]::Zero) { Say "window '$Name' not found"; exit 1 }
$b = Measure-Phase "B ours idleFps=15" $hwnd $idsB

Say "phase C: same window, idleFps raised to 60 through the WE property panel"
& $WE -control applyProperties -properties 'RAW~({"idlefps":60})~END' -location $Name | Out-Null
Start-Sleep -Seconds 3
$c = Measure-Phase "C ours idleFps=60" $hwnd $idsB

# restore the shipped default and close the test window
& $WE -control applyProperties -properties 'RAW~({"idlefps":15})~END' -location $Name | Out-Null
Start-Sleep -Seconds 2
& $WE -control closeWallpaper -location $Name | Out-Null

Say ""
Say "=== marginal cost of this wallpaper (B - A) ==="
Say ("CPU  {0:N2}% of the machine   [plan threshold: <3%]" -f ($b.CpuPct - $a.CpuPct))
Say ("GPU  avg {0:N2}% / max {1:N2}%   [plan threshold: <5%]" -f ($b.GpuAvg - $a.GpuAvg), ($b.GpuMax - $a.GpuMax))
Say ("RAM  {0:N1} MB" -f ($b.Ws - $a.Ws))
Say ("idleFps 15 -> 60 changes GPU by {0:N2}% avg: the limiter is acting inside WE" -f ($c.GpuAvg - $b.GpuAvg))
Say ("animation check: baseline pixels changed {0:N2}%, ours {1:N2}%" -f $a.Changed, $b.Changed)

$script:log | Set-Content -Path (Join-Path $PSScriptRoot "perf-report.txt") -Encoding UTF8
