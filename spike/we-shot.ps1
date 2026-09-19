# Captures a top-level window's client area to a PNG and prints pixel statistics.
# Used for Phase 0/4 verification inside Wallpaper Engine, which has no automation API:
#   powershell -NoProfile -File spike/we-shot.ps1 -Match "OW Preview" -Out spike/we-preview.png
# Stats (mean luma / bright & dark fractions / distinct colours) are the machine-readable
# part: a black CEF surface and a rendered solar system are trivially distinguishable.
param(
  [Parameter(Mandatory = $true)][string]$Match,
  [string]$Out = "",
  [switch]$List,
  [switch]$Activate,
  [switch]$Plain,
  [int]$X = [int]::MinValue,
  [int]$Y = [int]::MinValue,
  [int]$W = 0,
  [int]$H = 0
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$found = @()
$cb = [Win+EnumProc] {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 512
  [void][Win]::GetWindowTextW($h, $sb, 512)
  $title = $sb.ToString()
  if ($title -and [Win]::IsWindowVisible($h) -and $title -like "*$Match*") {
    $script:found += [pscustomobject]@{ Handle = $h; Title = $title }
  }
  return $true
}
[void][Win]::EnumWindows($cb, [IntPtr]::Zero)

if ($List -or $found.Count -eq 0) {
  Write-Output ("windows matching '{0}': {1}" -f $Match, $found.Count)
  foreach ($f in $found) { Write-Output ("  {0}  {1}" -f $f.Handle, $f.Title) }
  if ($found.Count -eq 0) { exit 1 }
}

$win = $found[0]
$h = $win.Handle
if ($Activate -and -not $Plain) {
  # CopyFromScreen captures the composited desktop, so an occluded window yields whatever
  # is on top of it. Raise the target above everything (HWND_TOPMOST) and optionally move
  # it to a known rectangle before capturing.
  $flags = 0x0040 -bor 0x0010 -bor 0x0002   # SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_NOMOVE
  $mx = 0; $my = 0; $mw = 0; $mh = 0
  if ($X -ne [int]::MinValue -or $Y -ne [int]::MinValue) {
    $flags = 0x0040 -bor 0x0010
    $mx = if ($X -eq [int]::MinValue) { 0 } else { $X }
    $my = if ($Y -eq [int]::MinValue) { 0 } else { $Y }
    $mw = $W; $mh = $H
  }
  [void][Win]::SetWindowPos($h, [IntPtr](-1), $mx, $my, $mw, $mh, $flags)
  [void][Win]::ShowWindow($h, 9)          # SW_RESTORE
  [void][Win]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 1500
}
$r = New-Object Win+RECT
[void][Win]::GetClientRect($h, [ref]$r)
$origin = New-Object Win+POINT
[void][Win]::ClientToScreen($h, [ref]$origin)
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
Write-Output ("window '{0}' client {1}x{2} at {3},{4}" -f $win.Title, $w, $hgt, $origin.X, $origin.Y)
if ($w -le 0 -or $hgt -le 0) { exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size $w, $hgt))

if ($Out) {
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("saved {0}" -f $Out)
}

# Pixel statistics: sampled every 3rd pixel, colours quantised to 4 bits per channel.
$sum = 0.0; $n = 0; $bright = 0; $dark = 0
$colours = New-Object 'System.Collections.Generic.HashSet[string]'
for ($y = 0; $y -lt $hgt; $y += 3) {
  for ($x = 0; $x -lt $w; $x += 3) {
    $c = $bmp.GetPixel($x, $y)
    $luma = ($c.R + $c.G + $c.B) / 3.0
    $sum += $luma; $n++
    if ($luma -gt 40) { $bright++ }
    if ($luma -lt 8) { $dark++ }
    [void]$colours.Add(('{0},{1},{2}' -f ($c.R -shr 4), ($c.G -shr 4), ($c.B -shr 4)))
  }
}
$g.Dispose(); $bmp.Dispose()
Write-Output ("pixels={0} meanLuma={1} bright%={2} dark%={3} distinctColours={4}" -f `
  $n, [Math]::Round($sum / $n, 2), [Math]::Round(100.0 * $bright / $n, 2), `
  [Math]::Round(100.0 * $dark / $n, 2), $colours.Count)
