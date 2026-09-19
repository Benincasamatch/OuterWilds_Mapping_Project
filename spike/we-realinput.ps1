# Sends REAL synthetic input (SetCursorPos + mouse_event) at a Wallpaper Engine window and
# lets the probe's beacons report what the page received. This is the ground truth for
# Phase 0 Spike A: posted messages are not what a human hand produces.
#
# Safety: every click is guarded by WindowFromPoint - the left button is only pressed if
# the topmost window under the target pixel belongs to the wallpaper process.
#   powershell -NoProfile -File spike/we-realinput.ps1 -Match "OW Probe2" -Mode all
param(
  [Parameter(Mandatory = $true)][string]$Match,
  [ValidateSet('move', 'drag', 'wheel', 'all')][string]$Mode = 'all',
  [int]$PauseMs = 260
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Real {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$script:target = [IntPtr]::Zero
$cb = [Real+EnumProc] {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][Real]::GetWindowTextW($h, $sb, 512)
  if ($sb.ToString() -like "*$Match*") { $script:target = $h; return $false }
  return $true
}
[void][Real]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:target -eq [IntPtr]::Zero) { Write-Output "window '$Match' not found"; exit 1 }
$h = $script:target

[void][Real]::ShowWindow($h, 9)
[void][Real]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 700

$r = New-Object Real+RECT
[void][Real]::GetClientRect($h, [ref]$r)
$origin = New-Object Real+POINT
[void][Real]::ClientToScreen($h, [ref]$origin)
$cx = $origin.X + [int](($r.Right - $r.Left) / 2)
$cy = $origin.Y + [int](($r.Bottom - $r.Top) / 2)

$under = [Real]::WindowFromPoint((New-Object Real+POINT -Property @{ X = $cx; Y = $cy }))
$upid = [uint32]0
[void][Real]::GetWindowThreadProcessId($under, [ref]$upid)
$wname = if ($under -eq $h) { 'target' } else { (Get-Process -Id $upid -ErrorAction SilentlyContinue).ProcessName }
Write-Output ("target hwnd={0} pid={1} centre={2},{3} topmost-under-cursor={4} (pid {5})" -f `
  $h, (Get-Process -Id $upid -ErrorAction SilentlyContinue).Id, $cx, $cy, $wname, $upid)

$guard = $wname -eq 'target' -or "$wname" -match 'wallpaper'
if (-not $guard) {
  Write-Output "ABORT: the topmost window under the target pixel is '$wname', not the wallpaper window - refusing to click"
  exit 2
}

$saved = New-Object Real+POINT
[void][Real]::GetCursorPos([ref]$saved)

$MOVE = 0x0001; $LEFTDOWN = 0x0002; $LEFTUP = 0x0004; $WHEEL = 0x0800

function MoveTo([int]$x, [int]$y) { [void][Real]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 40 }

if ($Mode -eq 'move' -or $Mode -eq 'all') {
  Write-Output "moving cursor in from the left edge over the window"
  MoveTo ($cx - 120) $cy
  for ($i = 1; $i -le 8; $i++) { MoveTo ($cx - 120 + $i * 15) ($cy + $i * 3) }
}
if ($Mode -eq 'drag' -or $Mode -eq 'all') {
  MoveTo $cx $cy
  [Real]::mouse_event($LEFTDOWN, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 90
  for ($i = 1; $i -le 8; $i++) { MoveTo ($cx + $i * 12) ($cy + $i * 4) }
  [Real]::mouse_event($LEFTUP, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 120
}
if ($Mode -eq 'wheel' -or $Mode -eq 'all') {
  MoveTo $cx $cy
  for ($i = 0; $i -lt 3; $i++) { [Real]::mouse_event($WHEEL, 0, 0, -120, [IntPtr]::Zero); Start-Sleep -Milliseconds $PauseMs }
  for ($i = 0; $i -lt 3; $i++) { [Real]::mouse_event($WHEEL, 0, 0, 120, [IntPtr]::Zero); Start-Sleep -Milliseconds $PauseMs }
}

Start-Sleep -Milliseconds 400
[void][Real]::SetCursorPos($saved.X, $saved.Y)
Write-Output ("done ($Mode); cursor restored to {0},{1}" -f $saved.X, $saved.Y)
