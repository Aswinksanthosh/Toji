# Looks for the Gemini desktop app and reports what Windows lets a program read
# from its window. Read only: it presses nothing, types nothing, changes nothing.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\gemini-app-probe.ps1

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$procs = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($_.ProcessName -match 'gemini' -or $_.MainWindowTitle -match 'gemini')
}

if (-not $procs) {
  Write-Host "No window with 'gemini' in its name or title was found."
  Write-Host "Open the Gemini app so its window is visible, then run this again."
  Write-Host ""
  Write-Host "Windows that are open right now:"
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object ProcessName, MainWindowTitle | Format-Table -AutoSize
  exit 0
}

foreach ($p in $procs) {
  Write-Host ("Found: process '{0}', window title '{1}'" -f $p.ProcessName, $p.MainWindowTitle)
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Host ("Readable elements inside it: {0}" -f $all.Count)
    $shown = 0
    foreach ($e in $all) {
      $name = $e.Current.Name
      if ($name -and $name.Length -gt 1 -and $shown -lt 40) {
        $kind = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
        $text = $name.Substring(0, [Math]::Min(80, $name.Length))
        Write-Host ("  [{0}] {1}" -f $kind, $text)
        $shown++
      }
    }
    if ($shown -eq 0) { Write-Host "  (nothing readable: this app hides its text from Windows)" }
  } catch {
    Write-Host ("Could not read the window: {0}" -f $_.Exception.Message)
  }
}
