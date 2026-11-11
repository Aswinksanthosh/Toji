# Asks the Gemini app (or the Gemini page open in a browser) one question and
# prints its answer, by driving the window through Windows UI Automation.
#
# Input comes in environment variables, never in this text:
#   JARVIS_Q        the question
#   JARVIS_TIMEOUT  seconds to wait for the answer
#   JARVIS_DEBUG    1 to list what was seen, on stderr, to help tune this
#
# Exit codes: 3 no Gemini window, 4 no prompt box found, 5 no answer appeared.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic
Add-Type @"
using System.Runtime.InteropServices;
public class JK { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, int f, int e); }
"@

# Never fail silently: say what went wrong, and exit with its own code.
trap {
  [Console]::Error.WriteLine('error: ' + $_.Exception.Message)
  exit 9
}

$question = $env:JARVIS_Q
$timeout = [Math]::Min([Math]::Max([int]$env:JARVIS_TIMEOUT, 10), 120)
$debug = $env:JARVIS_DEBUG -eq '1'
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Tap([byte[]]$mods, [byte]$key) {
  foreach ($m in $mods) { [JK]::keybd_event($m, 0, 0, 0) }
  [JK]::keybd_event($key, 0, 0, 0)
  [JK]::keybd_event($key, 0, 2, 0)
  [array]::Reverse($mods)
  foreach ($m in $mods) { [JK]::keybd_event($m, 0, 2, 0) }
}

# Only ever a window that is the Gemini app or a page titled Google Gemini, so
# the question can never be pasted into anything else.
function Find-Target {
  $procs = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and ($_.ProcessName -eq 'Gemini' -or $_.MainWindowTitle -match 'Google Gemini')
  } | Sort-Object { if ($_.ProcessName -eq 'Gemini') { 0 } else { 1 } }
  foreach ($p in $procs) {
    $root = $AE::FromHandle($p.MainWindowHandle)
    $isEdit = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $edits = $root.FindAll($TS::Descendants, $isEdit)
    if ($debug) { [Console]::Error.WriteLine(('candidate: {0} "{1}" with {2} text boxes' -f $p.ProcessName, $p.MainWindowTitle, $edits.Count)) }
    foreach ($e in $edits) {
      $n = $e.Current.Name
      if ($n -notmatch 'Address|search bar' -and ($n -match 'prompt|Gemini|Ask|message' -or $edits.Count -eq 1)) {
        return @{ Proc = $p; Root = $root; Box = $e }
      }
    }
  }
  return $null
}

function Snapshot($root) {
  $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($e in $all) {
    $n = $e.Current.Name
    if ($n -and $n.Length -gt 1) {
      $list.Add([pscustomobject]@{ Kind = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''); Name = $n })
    }
  }
  return ,$list
}

# Chrome-based windows only build their accessibility tree after the first time
# something asks for it, so the first look often finds nothing. Ask, wait, ask again.
function Find-WithWarmup([int]$tries) {
  for ($i = 0; $i -lt $tries; $i++) {
    $found = Find-Target
    if ($found) { return $found }
    Start-Sleep -Milliseconds 1500
  }
  return $null
}

$t = Find-WithWarmup 5
if (-not $t) {
  # The app may be hidden: its own shortcut (win+alt+space) brings up the overlay.
  Tap @(0x5B, 0x12) 0x20
  Start-Sleep -Seconds 2
  $t = Find-WithWarmup 4
}
if (-not $t) { [Console]::Error.WriteLine('no gemini window'); exit 3 }

function Step($text) { if ($debug) { [Console]::Error.WriteLine("step: $text") } }

Step 'window found, bringing it to the front'
[Microsoft.VisualBasic.Interaction]::AppActivate($t.Proc.Id)
Start-Sleep -Milliseconds 400
Step 'reading what is on screen before sending'

$seen = @{}
foreach ($i in (Snapshot $t.Root)) { $seen[$i.Name] = $true }

$oldClip = $null
try { $oldClip = Get-Clipboard -Raw } catch {}
try {
  Step 'pasting the question'
  Set-Clipboard -Value $question
  try { $t.Box.SetFocus() } catch {}
  Start-Sleep -Milliseconds 200
  Tap @(0x11) 0x56      # ctrl+v
  Start-Sleep -Milliseconds 400
  Tap @() 0x0D          # enter
  Step 'question sent, waiting for the answer'

  $deadline = (Get-Date).AddSeconds($timeout)
  $last = ''
  $stable = 0
  $answer = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $fresh = @(Snapshot $t.Root | Where-Object {
      -not $seen.ContainsKey($_.Name) -and
      $_.Kind -in @('Text', 'Document', 'Group', 'ListItem') -and
      $_.Name -ne $question -and -not $question.Contains($_.Name)
    })
    $text = ($fresh | ForEach-Object { $_.Name } | Select-Object -Unique) -join "`n"
    if ($text -and $text -eq $last) { $stable++ } else { $stable = 0 }
    $last = $text
    if ($text -and $stable -ge 4) { $answer = $text; break }
  }
  if (-not $answer -and $last) { $answer = $last }
  if ($debug) {
    # Everything new in the window, of any kind, so we can see how the answer is exposed.
    [Console]::Error.WriteLine('--- new in the window after sending (any kind) ---')
    foreach ($i in (Snapshot $t.Root)) {
      if (-not $seen.ContainsKey($i.Name)) {
        $shown = $i.Name
        if ($shown.Length -gt 100) { $shown = $shown.Substring(0, 100) }
        [Console]::Error.WriteLine(('{0}: {1}' -f $i.Kind, $shown))
      }
    }
    [Console]::Error.WriteLine('--- end ---')
  }
}
finally {
  if ($null -ne $oldClip) { try { Set-Clipboard -Value $oldClip } catch {} }
}

Step 'finished waiting'
if (-not $answer) { [Console]::Error.WriteLine('no answer appeared'); exit 5 }
[Console]::Out.WriteLine($answer)
