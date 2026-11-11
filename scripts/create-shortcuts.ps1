# Puts three shortcuts on your desktop: Jarvis Local (graphics capped at 80%),
# Jarvis Gemini and Jarvis Claude. Safe to run again; it replaces them.

$desktop = [Environment]::GetFolderPath('Desktop')   # follows OneDrive if the desktop is moved there
$root = Split-Path $PSScriptRoot -Parent
$shell = New-Object -ComObject WScript.Shell

function New-JarvisLink($name, $file, $prefix) {
  $link = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
  $link.TargetPath = 'cmd.exe'
  $link.Arguments = "/c $prefix`"$root\$file`""
  $link.WorkingDirectory = $root
  $link.Description = $name
  $link.Save()
  Write-Host ("  created: {0}" -f $link.FullName)
}

Write-Host "Creating shortcuts on your desktop..."
New-JarvisLink 'Jarvis Local'  'Jarvis-Local.cmd'  'set JARVIS_GPU_PERCENT=80&& '
New-JarvisLink 'Jarvis Gemini' 'Jarvis-Gemini.cmd' ''
New-JarvisLink 'Jarvis Claude' 'Jarvis-Claude.cmd' ''
Write-Host "Done. Double-click one to start Jarvis with that brain."
