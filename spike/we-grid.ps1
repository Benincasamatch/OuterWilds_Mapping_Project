# Prints a coarse brightness/colour grid of the whole desktop plus selected windows.
# Diagnostic for Phase 0/4 capture: shows *where* Wallpaper Engine's surface actually is,
# since its preview window composite does not always survive an occlusion move.
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Grid {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
Add-Type -AssemblyName System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output ("screen {0}x{1}" -f $b.Width, $b.Height)

$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $b.Width, $b.Height))

$cols = 10; $rows = 6
$cw = [int]($b.Width / $cols); $ch = [int]($b.Height / $rows)
Write-Output "grid luma (cols x rows, block averages):"
for ($ry = 0; $ry -lt $rows; $ry++) {
  $line = @()
  for ($rx = 0; $rx -lt $cols; $rx++) {
    $sum = 0.0; $n = 0
    for ($y = $ry * $ch; $y -lt [Math]::Min(($ry + 1) * $ch, $b.Height); $y += 6) {
      for ($x = $rx * $cw; $x -lt [Math]::Min(($rx + 1) * $cw, $b.Width); $x += 6) {
        $c = $bmp.GetPixel($x, $y); $sum += ($c.R + $c.G + $c.B) / 3.0; $n++
      }
    }
    $line += ('{0,4}' -f [int]($sum / $n))
  }
  Write-Output ('  ' + ($line -join ' '))
}
$g.Dispose(); $bmp.Dispose()

$script:rows2 = @()
$cb = [Grid+EnumProc] {
  param($h, $l)
  $t = New-Object System.Text.StringBuilder 512
  $c = New-Object System.Text.StringBuilder 256
  [void][Grid]::GetWindowTextW($h, $t, 512)
  [void][Grid]::GetClassNameW($h, $c, 256)
  $r = New-Object Grid+RECT
  [void][Grid]::GetWindowRect($h, [ref]$r)
  $wpid = [uint32]0
  [void][Grid]::GetWindowThreadProcessId($h, [ref]$wpid)
  $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  $pname = if ($p) { $p.ProcessName } else { "?" }
  if ($pname -match 'wallpaper') {
    $script:rows2 += [pscustomobject]@{ Proc = $pname; Class = $c.ToString(); X = $r.Left; Y = $r.Top
      W = ($r.Right - $r.Left); H = ($r.Bottom - $r.Top); Title = $t.ToString() }
  }
  return $true
}
[void][Grid]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output "wallpaper-related windows:"
$script:rows2 | Format-Table -AutoSize | Out-String -Width 250
