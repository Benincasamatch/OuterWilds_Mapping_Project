# Lists visible top-level windows with class, size, position and owning process.
# Phase 0/4 helper: Wallpaper Engine renders Web wallpapers in a separate
# `webwallpaper64.exe` (CEF) process, so the surface to capture is not always the
# window owned by wallpaper64.exe.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Enumer {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$script:rows = @()
$cb = [Enumer+EnumProc] {
  param($h, $l)
  $t = New-Object System.Text.StringBuilder 512
  $c = New-Object System.Text.StringBuilder 256
  [void][Enumer]::GetWindowTextW($h, $t, 512)
  [void][Enumer]::GetClassNameW($h, $c, 256)
  $r = New-Object Enumer+RECT
  [void][Enumer]::GetWindowRect($h, [ref]$r)
  $wpid = [uint32]0
  [void][Enumer]::GetWindowThreadProcessId($h, [ref]$wpid)
  $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  $pname = if ($p) { $p.ProcessName } else { "?" }
  $w = $r.Right - $r.Left
  $hh = $r.Bottom - $r.Top
  if ($w -gt 80 -and $hh -gt 80) {
    $script:rows += [pscustomobject]@{
      Proc = $pname; Class = $c.ToString(); W = $w; H = $hh; Vis = [Enumer]::IsWindowVisible($h)
      X = $r.Left; Y = $r.Top; Title = $t.ToString(); Pid = $wpid; Hwnd = $h
    }
  }
  return $true
}
[void][Enumer]::EnumWindows($cb, [IntPtr]::Zero)
$script:rows | Where-Object { $_.Proc -match 'wallpaper|Chromium' } |
  Format-Table -AutoSize | Out-String -Width 250
Write-Output ("total visible windows: {0}" -f $script:rows.Count)
