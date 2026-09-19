# Posts synthetic mouse/keyboard messages to a window (no cursor movement).
# Phase 0 Spike A: drives the probe wallpaper inside Wallpaper Engine and lets the
# probe's HTTP beacons report which events actually reached the page.
#   powershell -NoProfile -File spike/we-input.ps1 -Match "OW Probe2" -Mode all
param(
  [Parameter(Mandatory = $true)][string]$Match,
  [ValidateSet('move', 'drag', 'wheel', 'key', 'all')][string]$Mode = 'all'
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Inp {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$script:target = [IntPtr]::Zero
$cb = [Inp+EnumProc] {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][Inp]::GetWindowTextW($h, $sb, 512)
  if ($sb.ToString() -like "*$Match*") { $script:target = $h; return $false }
  return $true
}
[void][Inp]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:target -eq [IntPtr]::Zero) { Write-Output "window '$Match' not found"; exit 1 }
$h = $script:target

[void][Inp]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300

$r = New-Object Inp+RECT
[void][Inp]::GetClientRect($h, [ref]$r)
$cw = $r.Right - $r.Left
$ch = $r.Bottom - $r.Top
$cx = [int]($cw / 2)
$cy = [int]($ch / 2)
$scr = New-Object Inp+POINT
[void][Inp]::ClientToScreen($h, [ref]$scr)
Write-Output ("target hwnd={0} client {1}x{2} screen {3},{4}" -f $h, $cw, $ch, $scr.X, $scr.Y)

function LP([int]$x, [int]$y) { return [IntPtr](($y -shl 16) -bor ($x -band 0xFFFF)) }

$WM_MOUSEMOVE = 0x0200
$WM_LBUTTONDOWN = 0x0201
$WM_LBUTTONUP = 0x0202
$WM_MOUSEWHEEL = 0x020A
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$MK_LBUTTON = 0x0001

function Send-Move([int]$x, [int]$y, [int]$keys) {
  [void][Inp]::PostMessage($h, $WM_MOUSEMOVE, [IntPtr]$keys, (LP $x $y))
}
function Send-Wheel([int]$delta, [int]$x, [int]$y) {
  $w = [IntPtr]((($delta -band 0xFFFF) -shl 16) -bor 0)     # low word = key state 0
  $lp = LP ($scr.X + $x) ($scr.Y + $y)                      # wheel uses SCREEN coords
  [void][Inp]::PostMessage($h, $WM_MOUSEWHEEL, $w, $lp)
}

switch ($Mode) {
  'move' {
    for ($i = 0; $i -lt 6; $i++) { Send-Move ($cx + $i * 6) ($cy + $i * 3) 0; Start-Sleep -Milliseconds 60 }
  }
  'drag' {
    Send-Move $cx $cy 0
    [void][Inp]::PostMessage($h, $WM_LBUTTONDOWN, [IntPtr]$MK_LBUTTON, (LP $cx $cy))
    Start-Sleep -Milliseconds 80
    for ($i = 1; $i -le 8; $i++) { Send-Move ($cx + $i * 12) ($cy + $i * 5) $MK_LBUTTON; Start-Sleep -Milliseconds 60 }
    [void][Inp]::PostMessage($h, $WM_LBUTTONUP, [IntPtr]0, (LP ($cx + 96) ($cy + 40)))
  }
  'wheel' {
    Send-Move $cx $cy 0
    for ($i = 0; $i -lt 3; $i++) { Send-Wheel -120 $cx $cy; Start-Sleep -Milliseconds 120 }
    for ($i = 0; $i -lt 3; $i++) { Send-Wheel 120 $cx $cy; Start-Sleep -Milliseconds 120 }
  }
  'key' {
    [void][Inp]::PostMessage($h, $WM_KEYDOWN, [IntPtr]0x48, [IntPtr]0)   # 'H'
    Start-Sleep -Milliseconds 100
    [void][Inp]::PostMessage($h, $WM_KEYUP, [IntPtr]0x48, [IntPtr]0)
  }
  'all' {
    for ($i = 0; $i -lt 6; $i++) { Send-Move ($cx + $i * 6) ($cy + $i * 3) 0; Start-Sleep -Milliseconds 60 }
    Start-Sleep -Milliseconds 200
    Send-Move $cx $cy 0
    [void][Inp]::PostMessage($h, $WM_LBUTTONDOWN, [IntPtr]$MK_LBUTTON, (LP $cx $cy))
    Start-Sleep -Milliseconds 80
    for ($i = 1; $i -le 8; $i++) { Send-Move ($cx + $i * 12) ($cy + $i * 5) $MK_LBUTTON; Start-Sleep -Milliseconds 60 }
    [void][Inp]::PostMessage($h, $WM_LBUTTONUP, [IntPtr]0, (LP ($cx + 96) ($cy + 40)))
    Start-Sleep -Milliseconds 200
    for ($i = 0; $i -lt 3; $i++) { Send-Wheel -120 $cx $cy; Start-Sleep -Milliseconds 120 }
    for ($i = 0; $i -lt 3; $i++) { Send-Wheel 120 $cx $cy; Start-Sleep -Milliseconds 120 }
    Start-Sleep -Milliseconds 200
    [void][Inp]::PostMessage($h, $WM_KEYDOWN, [IntPtr]0x48, [IntPtr]0)
    Start-Sleep -Milliseconds 100
    [void][Inp]::PostMessage($h, $WM_KEYUP, [IntPtr]0x48, [IntPtr]0)
  }
}
Write-Output "posted $Mode"
