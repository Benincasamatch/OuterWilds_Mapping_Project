# Phase 0 Spike D - does Wallpaper Engine forward mouse input to a web wallpaper while the
# wallpaper runs in DESKTOP state (the state PLAN.md 1.2 actually accepts on)?
#
# Spike A proved forwarding for the POP-OUT PREVIEW window (`openWallpaper -playInWindow`).
# That is a different WE code path, so it does NOT answer "desktop in the foreground". This
# script applies the probe to a monitor (`openWallpaper -monitor N`), injects REAL input
# (SetCursorPos + mouse_event) over the desktop, and reads the answer from the probe's
# beacon log instead of from pixels. It repeats the measurement after `-control hideIcons`
# so the icon layer can be named as the blocker (or cleared as a suspect).
#
# It is guarded: the left button is only pressed when the topmost window under the chosen
# pixel belongs to the desktop shell or to wallpaper64 - never over somebody's editor.
# It also restores the monitor's previous wallpaper (read from WE's own config.json).
#
# Start the receiver first, then run this script:
#   $env:BEACON_LOG="$PWD\spike\beacon-desktop.log"; node spike/beacon-server.mjs
#   powershell -NoProfile -File spike/we-desktop-input.ps1 -Monitor 0
param(
  [switch]$AllowDesktopChanges,
  [int]$Monitor = 0,
  [int]$Warmup = 60,
  [string]$Project = "$PSScriptRoot\input-probe\project.json",
  [string]$WE = "E:\SteamLibrary\steamapps\common\wallpaper_engine\wallpaper64.exe",
  [string]$Config = "E:\SteamLibrary\steamapps\common\wallpaper_engine\config.json",
  [string]$BeaconLog = "$PSScriptRoot\beacon-desktop.log",
  [string]$Report = "$PSScriptRoot\desktop-input-report.txt"
)

if (-not $AllowDesktopChanges) {
  throw 'Legacy probe changes desktop wallpaper/icons and injects input. Prefer spike/README.md; pass -AllowDesktopChanges only after explicit approval.'
}
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Desk {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, IntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$script:lines = New-Object System.Collections.Generic.List[string]
function Say([string]$s) { Write-Host $s; $script:lines.Add($s) }

# --- beacon statistics ---------------------------------------------------------
# Every beacon line looks like `ev=<name>&n=<k>`; k is the true event count (the probe
# only fires a beacon on the 1st and every 5th event), so the max k per name is the count.
function EvStats([string]$path) {
  $st = @{}
  if (-not $path -or -not (Test-Path $path)) { return $st }
  $txt = Get-Content -Raw -Path $path -ErrorAction SilentlyContinue
  if (-not $txt) { return $st }
  foreach ($m in [regex]::Matches($txt, 'ev=([a-z]+)&n=(\d+)')) {
    $k = $m.Groups[1].Value; $v = [int]$m.Groups[2].Value
    if (-not $st.ContainsKey($k) -or $st[$k] -lt $v) { $st[$k] = $v }
  }
  return $st
}
function Stat-Txt($st) {
  if ($st.Count -eq 0) { return '(no beacons at all)' }
  return (($st.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ')
}
# The probe also beacons a cumulative `summary` every 5 s (ptr/mdown/up/drag/wheel/dy/key/
# focus/vis). Its counters are a second, independent read of the same session - and the
# presence of fresh summaries is the proof that the page is actually running (WE pauses or
# throttles the wallpaper when another application holds the focus).
function Summary-Stats([string]$path) {
  if (-not $path -or -not (Test-Path $path)) { return @{} }
  $lines = Select-String -Path $path -Pattern 'ev=summary' -ErrorAction SilentlyContinue
  if (-not $lines) { return @{} }
  $last = $lines[-1].Line
  $st = @{ count = $lines.Count }
  foreach ($kv in ([regex]::Matches($last, '([a-z]+)=([-\w.]+)'))) {
    $st[$kv.Groups[1].Value] = $kv.Groups[2].Value
  }
  return $st
}
function Summary-Txt($st) {
  if ($st.Count -eq 0) { return '(none)' }
  return ((($st.GetEnumerator() | Where-Object { $_.Key -ne 'n' } | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))
}

# WE pauses wallpapers while another application is focused (config: playbackfocus=pause),
# which freezes the CEF page - so the desktop has to be the foreground window for the test
# to mean anything. MinimizeAll/UndoMinimizeAll are the programmatic Win+D.
function Minimize-All {
  try { (New-Object -ComObject Shell.Application).MinimizeAll(); return $true } catch { Say ("  MinimizeAll failed: {0}" -f $_.Exception.Message); return $false }
}
function Restore-All {
  try { (New-Object -ComObject Shell.Application).UndoMinimizeAll(); return $true } catch { Say ("  UndoMinimizeAll failed: {0}" -f $_.Exception.Message); return $false }
}

# --- window probing ------------------------------------------------------------
$shellClasses = @('SysListView32', 'SHELLDLL_DefView', 'WorkerW', 'Progman', 'WPEOverlappedWallpaper',
                  'ProgmanDesktopHost', 'DesktopWindowXamlSource', 'Windows.UI.Core.CoreWindow')
function Win-Info([int]$x, [int]$y) {
  $h = [Desk]::WindowFromPoint((New-Object Desk+POINT -Property @{ X = $x; Y = $y }))
  $cls = New-Object System.Text.StringBuilder 256; [void][Desk]::GetClassNameW($h, $cls, 256)
  $ttl = New-Object System.Text.StringBuilder 256; [void][Desk]::GetWindowTextW($h, $ttl, 256)
  $wpid = [uint32]0; [void][Desk]::GetWindowThreadProcessId($h, [ref]$wpid)
  $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    X = $x; Y = $y; Hwnd = $h; Class = $cls.ToString(); Title = $ttl.ToString()
    Pid = $wpid; Proc = $(if ($p) { $p.ProcessName } else { '?' })
  }
}
function Win-Info-Txt($w) { return ("{0},{1} -> class='{2}' proc={3} pid={4} title='{5}'" -f $w.X, $w.Y, $w.Class, $w.Proc, $w.Pid, $w.Title) }
function Is-Safe($w) { return ($shellClasses -contains $w.Class) -or ($w.Proc -match 'wallpaper') }
function Cef-Pool() { return @(Get-Process -Name webwallpaper64 -ErrorAction SilentlyContinue) }

# --- previous wallpaper for this monitor (from WE's own config) -----------------
function Get-Config {
  if (-not (Test-Path $Config)) { return $null }
  $raw = Get-Content -Raw -Encoding UTF8 -Path $Config
  try { return ($raw | ConvertFrom-Json) } catch {
    Say ("  (ConvertFrom-Json failed: {0})" -f $_.Exception.Message.Split("`n")[0])
    return $null
  }
}

function Prev-Wallpaper([int]$idx) {
  $j = Get-Config
  if (-not $j) { return $null }
  $user = $env:USERNAME
  if (-not ($j.PSObject.Properties.Name -contains $user)) { return $null }
  $sel = $j.$user.general.wallpaperconfig.selectedwallpapers
  if (-not $sel) { return $null }
  $key = "Monitor$idx"
  if (-not ($sel.PSObject.Properties.Name -contains $key)) { return $null }
  return $sel.$key.file
}

# WE's own monitor index space ("location" in config.json, the same index the CLI's
# -monitor parameter uses) is not the Win32 display order: the primary display can be
# location 1. Resolve it through monitormap before aiming any input.
function Display-Bounds([int]$loc) {
  $j = Get-Config
  $dev = $null
  if ($j) {
    $user = $env:USERNAME
    $mm = $j.$user.general.user.monitormap
    if ($mm) {
      foreach ($pr in $mm.PSObject.Properties) {
        if ($pr.Name -notmatch '^//\./DISPLAY\d+$') { continue }
        if ([int]$pr.Value.location -eq $loc) { $dev = $pr.Name; break }
      }
    }
  }
  foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    $norm = $s.DeviceName -replace '^\\\\\.\\', '//./'
    if ($dev -and $norm -ne $dev) { continue }
    return [pscustomobject]@{ Device = $s.DeviceName; We = $dev; Loc = $loc
      X = $s.Bounds.Left; Y = $s.Bounds.Top; W = $s.Bounds.Width; H = $s.Bounds.Height; Primary = $s.Primary }
  }
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  return [pscustomobject]@{ Device = 'primary(fallback)'; We = $dev; Loc = $loc
    X = $b.Left; Y = $b.Top; W = $b.Width; H = $b.Height; Primary = $true }
}

# --- input injection -----------------------------------------------------------
$MOVE = 0x0001; $LEFTDOWN = 0x0002; $LEFTUP = 0x0004; $WHEEL = 0x0800
function MoveTo([int]$x, [int]$y) { [void][Desk]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 40 }

function Inject-Stage([string]$label, [int]$cx, [int]$cy) {
  $before = EvStats $BeaconLog
  $here = Win-Info $cx $cy
  if (-not (Is-Safe $here)) {
    Say ("  {0}: ABORT before clicking - topmost is now {1}" -f $label, (Win-Info-Txt $here))
    return $before
  }
  Write-Host "  injecting input at $cx,$cy ..."
  MoveTo ($cx - 140) $cy
  for ($i = 1; $i -le 7; $i++) { MoveTo ($cx - 140 + $i * 20) ($cy + $i * 4) }
  MoveTo $cx $cy
  [Desk]::mouse_event($LEFTDOWN, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 90
  for ($i = 1; $i -le 8; $i++) { MoveTo ($cx + $i * 14) ($cy + $i * 3) }
  [Desk]::mouse_event($LEFTUP, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 150
  for ($i = 0; $i -lt 3; $i++) { [Desk]::mouse_event($WHEEL, 0, 0, -120, [IntPtr]::Zero); Start-Sleep -Milliseconds 220 }
  for ($i = 0; $i -lt 3; $i++) { [Desk]::mouse_event($WHEEL, 0, 0, 120, [IntPtr]::Zero); Start-Sleep -Milliseconds 220 }
  Start-Sleep -Milliseconds 800
  $after = EvStats $BeaconLog
  $keys = @()
  foreach ($k in $after.Keys) {
    $was = if ($before.ContainsKey($k)) { $before[$k] } else { 0 }
    $d = $after[$k] - $was
    if ($d -gt 0) { $keys += "$k+$d" }
  }
  $delta = if ($keys.Count) { ($keys -join ' ') } else { 'NOTHING' }
  Say ("  {0}: {1}" -f $label, $delta)
  return $after
}

function Cleanup([string]$label, $prev) {
  Say $label
  & $WE -control showIcons | Out-Null
  Start-Sleep -Seconds 1
  if ($prev) {
    Say ("  restoring previous wallpaper: {0}" -f $prev)
    & $WE -control openWallpaper -file $prev -monitor $Monitor | Out-Null
  } else {
    Say "  no previous wallpaper recorded - closing the monitor wallpaper"
    & $WE -control closeWallpaper -monitor $Monitor | Out-Null
  }
  Start-Sleep -Seconds 3
  Say ("  webwallpaper64 pool after cleanup: {0} process(es)" -f (Cef-Pool).Count)
}

# ==============================================================================
if (-not (Test-Path $Project)) { Say "probe project missing: $Project"; exit 1 }
if (-not (Test-Path $WE)) { Say "wallpaper64.exe missing: $WE"; exit 1 }
if (-not (Test-Path $BeaconLog)) {
  Say "beacon log $BeaconLog does not exist - start the receiver first:"
  Say "  `$env:BEACON_LOG='$BeaconLog'; node spike/beacon-server.mjs"
  exit 1
}

$prev = Prev-Wallpaper $Monitor
Say ("user={0}  monitor={1}" -f $env:USERNAME, $Monitor)
Say ("previous wallpaper on Monitor{0}: '{1}' (exists={2})" -f $Monitor, $prev, $(if ($prev) { Test-Path $prev } else { 'n/a' }))

$saved = New-Object Desk+POINT
[void][Desk]::GetCursorPos([ref]$saved)

Say "stage 0: applying the probe to the desktop (openWallpaper -monitor $Monitor)"
& $WE -control play | Out-Null
Start-Sleep -Seconds 2
& $WE -control openWallpaper -file $Project -monitor $Monitor | Out-Null

# wait for the probe page to boot inside WE (this is also the "is it running at all" check)
$deadline = (Get-Date).AddSeconds($Warmup)
$boot = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $st = EvStats $BeaconLog
  if ($st.ContainsKey('boot') -and $st['boot'] -ge 1) { $boot = $true; break }
}
Say ("  probe boot: {0} (after {1:N0}s)" -f $boot, $Warmup)
if (-not $boot) {
  Say "ABORT: the probe page never beaconed - WE is not rendering it on this monitor."
  Say ("current beacons: {0}" -f (Stat-Txt (EvStats $BeaconLog)))
  Cleanup "cleanup after abort" $prev
  $script:lines | Set-Content -Path $Report -Encoding UTF8
  exit 2
}
Say ("  beacons after boot: {0}" -f (Stat-Txt (EvStats $BeaconLog)))
Say ("  webwallpaper64 pool: {0} process(es)" -f (Cef-Pool).Count)

# aim inside the display WE actually put the wallpaper on (its -monitor index space is NOT
# the Win32 display order), and only at a pixel whose topmost window is the desktop shell
$anchor = Display-Bounds $Monitor
Say ("  WE monitor {0} = {1} ({2}) rect {3},{4} {5}x{6} primary={7}" -f `
  $anchor.Loc, $anchor.Device, $anchor.We, $anchor.X, $anchor.Y, $anchor.W, $anchor.H, $anchor.Primary)

$fracs = @(@(0.78, 0.42), @(0.72, 0.62), @(0.86, 0.55), @(0.65, 0.30), @(0.55, 0.72), @(0.80, 0.22))
$chosen = $null
foreach ($f in $fracs) {
  $x = [int]($anchor.X + $anchor.W * $f[0])
  $y = [int]($anchor.Y + $anchor.H * $f[1])
  $w = Win-Info $x $y
  Say ("  candidate {0}" -f (Win-Info-Txt $w))
  if (Is-Safe $w) { $chosen = $w; break }
}
if (-not $chosen) {
  Say "ABORT: no candidate pixel is over the desktop shell / wallpaper (refusing to click)"
  Cleanup "cleanup after abort" $prev
  $script:lines | Set-Content -Path $Report -Encoding UTF8
  exit 3
}
$cx = $chosen.X; $cy = $chosen.Y
Say ("  using {0}" -f (Win-Info-Txt $chosen))

Say ""
Say "stage 1: desktop state, icons visible"
$after1 = Inject-Stage "stage1" $cx $cy
Say ("  topmost after stage1: {0}" -f (Win-Info-Txt (Win-Info $cx $cy)))

Say ""
Say "stage 2: same, with -control hideIcons"
& $WE -control hideIcons | Out-Null
Start-Sleep -Seconds 3
Say ("  topmost with icons hidden: {0}" -f (Win-Info-Txt (Win-Info $cx $cy)))
$after2 = Inject-Stage "stage2" $cx $cy

Say ""
Say "--- cleanup ---"
[void][Desk]::SetCursorPos($saved.X, $saved.Y)
Cleanup "stage 3: icons restored, wallpaper removed from the monitor" $prev

Say ""
Say "=== Spike D verdict (desktop state) ==="
foreach ($k in 'pointermove', 'pointerdown', 'pointerup', 'mousedown', 'wheel', 'keydown', 'focus') {
  $v1 = if ($after1.ContainsKey($k)) { $after1[$k] } else { 0 }
  $v2 = if ($after2.ContainsKey($k)) { $after2[$k] } else { 0 }
  Say ("  {0,-12} icons visible: {1,-6} icons hidden: {2}" -f $k, $v1, $v2)
}
# A boot-only log is inconclusive, not proof of missing input forwarding.
# The read-only analyzer requires sustained unpaused frames AND drag + wheel.
$analysis = & node "$PSScriptRoot/../tools/analyze-input.mjs" $BeaconLog --attempted
foreach ($line in $analysis) { Say $line }

$script:lines | Set-Content -Path $Report -Encoding UTF8
Say ("report: {0}" -f $Report)
