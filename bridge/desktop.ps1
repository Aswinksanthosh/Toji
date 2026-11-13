# Hands-free desktop actions for Jarvis, one per run.
#
# The action and its inputs arrive in environment variables, never in this text:
#   JARVIS_ACTION   type | click | list | scroll | lock | sleep
#   JARVIS_TEXT     the text to type             (type)
#   JARVIS_SUBMIT   1 to press Enter afterwards  (type)
#   JARVIS_NAME     the visible name to click    (click)
#   JARVIS_DIR      up | down                    (scroll)
#   JARVIS_AMOUNT   wheel notches                (scroll)
#   JARVIS_X, JARVIS_Y, JARVIS_BUTTON, JARVIS_DOUBLE   position and button      (clickat)
#
# Exit codes: 8 the click position is off the screen,
#             6 a terminal has focus (typing and clicking refused),
#             7 nothing with that name was found, 2 unknown action.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JD {
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, int f, int e);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@

[void][JD]::SetProcessDPIAware()   # so screenshot and click positions are real pixels
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

# Typing or clicking into these would turn speech into commands.
$blocked = @('powershell', 'pwsh', 'cmd', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'powershell_ise', 'regedit', 'mmc', 'wsl', 'bash')

function Get-ForegroundProcess {
  $h = [JD]::GetForegroundWindow()
  $procId = 0
  [void][JD]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -eq 0) { return $null }
  return Get-Process -Id $procId -ErrorAction SilentlyContinue
}

function Assert-NotTerminal {
  $p = Get-ForegroundProcess
  if ($p -and ($blocked -contains $p.ProcessName.ToLower())) {
    [Console]::Error.WriteLine('a terminal has focus')
    exit 6
  }
}

function Tap([byte[]]$mods, [byte]$key) {
  foreach ($m in $mods) { [JD]::keybd_event($m, 0, 0, 0) }
  [JD]::keybd_event($key, 0, 0, 0)
  [JD]::keybd_event($key, 0, 2, 0)
  [array]::Reverse($mods)
  foreach ($m in $mods) { [JD]::keybd_event($m, 0, 2, 0) }
}

function Get-Targets {
  $root = $AE::FromHandle([JD]::GetForegroundWindow())
  $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $kinds = @('Button', 'Hyperlink', 'MenuItem', 'TabItem', 'CheckBox', 'RadioButton', 'ListItem', 'SplitButton')
  $found = New-Object System.Collections.Generic.List[object]
  foreach ($e in $all) {
    $c = $e.Current
    $kind = $c.ControlType.ProgrammaticName.Replace('ControlType.', '')
    if ($kinds -contains $kind -and $c.Name -and $c.IsEnabled -and -not $c.IsOffscreen) {
      $found.Add([pscustomobject]@{ Kind = $kind; Name = $c.Name; Element = $e })
    }
  }
  return ,$found
}

switch ($env:JARVIS_ACTION) {
  'type' {
    Assert-NotTerminal
    $old = $null
    try { $old = Get-Clipboard -Raw } catch {}
    try {
      Set-Clipboard -Value $env:JARVIS_TEXT
      Start-Sleep -Milliseconds 150
      Tap @(0x11) 0x56                       # ctrl+v
      Start-Sleep -Milliseconds 300
      if ($env:JARVIS_SUBMIT -eq '1') { Tap @() 0x0D }
    } finally {
      if ($null -ne $old) { try { Set-Clipboard -Value $old } catch {} }
    }
  }
  'click' {
    Assert-NotTerminal
    $want = $env:JARVIS_NAME
    $targets = Get-Targets
    $hit = $targets | Where-Object { $_.Name -ieq $want } | Select-Object -First 1
    if (-not $hit) { $hit = $targets | Where-Object { $_.Name -ilike "*$want*" } | Select-Object -First 1 }
    if (-not $hit) { [Console]::Error.WriteLine('not found'); exit 7 }
    $pattern = $null
    if ($hit.Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      $pattern.Invoke()
    } else {
      $r = $hit.Element.Current.BoundingRectangle
      [void][JD]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
      [JD]::mouse_event(0x0002, 0, 0, 0, 0)
      [JD]::mouse_event(0x0004, 0, 0, 0, 0)
    }
    [Console]::Out.WriteLine($hit.Name)
  }
  'list' {
    $names = Get-Targets | Select-Object -First 40 | ForEach-Object { '{0}: {1}' -f $_.Kind, $_.Name }
    [Console]::Out.WriteLine(($names -join "`n"))
  }
  'scroll' {
    $n = [Math]::Min([Math]::Max([int]$env:JARVIS_AMOUNT, 1), 20)
    $delta = 120 * $n
    if ($env:JARVIS_DIR -eq 'down') { $delta = -$delta }
    [JD]::mouse_event(0x0800, 0, 0, $delta, 0)
  }
  'shot' {
    # The main screen, shrunk to at most 1280 wide, as base64 PNG. First line: real and image size.
    $scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $scr.Width, $scr.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($scr.X, $scr.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    $nw = $scr.Width
    $nh = $scr.Height
    if ($nw -gt 1280) { $nh = [int]($scr.Height * 1280 / $scr.Width); $nw = 1280 }
    $small = New-Object System.Drawing.Bitmap $nw, $nh
    $g2 = [System.Drawing.Graphics]::FromImage($small)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($bmp, 0, 0, $nw, $nh)
    $g2.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Out.WriteLine(("meta:{0},{1},{2},{3}" -f $scr.Width, $scr.Height, $nw, $nh))
    [Console]::Out.WriteLine([Convert]::ToBase64String($ms.ToArray()))
  }
  'clickat' {
    Assert-NotTerminal
    $scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $x = [int]$env:JARVIS_X
    $y = [int]$env:JARVIS_Y
    if ($x -lt 0 -or $y -lt 0 -or $x -ge $scr.Width -or $y -ge $scr.Height) { [Console]::Error.WriteLine('off screen'); exit 8 }
    [void][JD]::SetCursorPos($scr.X + $x, $scr.Y + $y)
    Start-Sleep -Milliseconds 80
    $down = 0x0002
    $up = 0x0004
    if ($env:JARVIS_BUTTON -eq 'right') { $down = 0x0008; $up = 0x0010 }
    $times = 1
    if ($env:JARVIS_DOUBLE -eq '1') { $times = 2 }
    for ($i = 0; $i -lt $times; $i++) {
      [JD]::mouse_event($down, 0, 0, 0, 0)
      [JD]::mouse_event($up, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 60
    }
  }
  'lock' { Start-Process rundll32.exe -ArgumentList 'user32.dll,LockWorkStation' }
  'sleep' { Start-Process rundll32.exe -ArgumentList 'powrprof.dll,SetSuspendState 0,1,0' }
  default { [Console]::Error.WriteLine('unknown action'); exit 2 }
}
