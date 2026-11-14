/**
 * What the phone remote buttons do on a laptop. No AI and no free text: every action
 * is one of a fixed list, and the only things a button can carry are the name of a game
 * from games.json, the name of an app from the list below, or the name of a button from
 * buttons.json. Nothing typed on the phone is ever run as a command.
 *
 * Files (all in ~/.jarvis, which the file tools of Jarvis are not allowed to touch):
 *   games.json    { "pubg": 578080 }
 *   buttons.json  { "my tests": { "command": "npm test", "cwd": "C:\\Users\\you\\project" } }
 *                 You write this file yourself; the phone can only press a button by name.
 *
 * Windows only. The PowerShell parts are passed as an encoded command, so no quoting
 * of the text can change what runs.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, uptime } from 'node:os'
import { join } from 'node:path'

/** Apps the phone may open, by a fixed address each. */
export const APPS = { discord: 'discord://', spotify: 'spotify:', epic: 'com.epicgames.launcher://apps' }

/** Virtual key code and how many times to press it. */
const KEYS = {
  volume_up: [0xaf, 5],
  volume_down: [0xae, 5],
  mute: [0xad, 1],
  media_playpause: [0xb3, 1],
  media_next: [0xb0, 1],
  media_prev: [0xb1, 1],
}
const KEY_MESSAGES = {
  volume_up: 'Volume up.',
  volume_down: 'Volume down.',
  mute: 'Mute toggled.',
  media_playpause: 'Play / pause.',
  media_next: 'Next track.',
  media_prev: 'Previous track.',
}

export const REMOTE_ACTIONS = [
  'steam_open',
  'steam_bigpicture',
  'steam_game',
  'lock',
  'sleep',
  'restart',
  'screen_off',
  'close_game',
  'game_mode',
  'ollama_start',
  'ollama_stop',
  'jarvis_start',
  'git_pull',
  'status',
  'app',
  'button',
  ...Object.keys(KEYS),
]

/** Buttons you defined yourself. Entries that look odd are ignored. */
export function knownButtons(file = join(homedir(), '.jarvis', 'buttons.json')) {
  const out = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const [name, v] of Object.entries(raw)) {
      const key = String(name).toLowerCase().trim()
      const command = typeof v?.command === 'string' ? v.command.trim() : ''
      const cwd = typeof v?.cwd === 'string' && v.cwd.trim() ? v.cwd.trim() : ''
      if (!key || key.length > 40 || !command || command.length > 300) continue
      if (/[\r\n\u0000]/.test(command) || /[\r\n\u0000]/.test(cwd)) continue
      out[key] = { command, cwd }
    }
  } catch {
    // No file: no custom buttons.
  }
  return out
}

function defaultRun(file, args, { timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    // The callback also receives a failure to start, so nothing is left unhandled.
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, stdout) =>
      err ? reject(new Error(String(err.message).split('\n')[0])) : resolve(String(stdout)),
    )
  })
}

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64')
const psArgs = (script) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)]
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

const keyScript = (vk, times) =>
  String.raw`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'
1..${times} | ForEach-Object { [W.K]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero) }`

const SCREEN_OFF = String.raw`Add-Type -Namespace W -Name M -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int h, int m, int w, int l);'
[W.M]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null`

const CLOSE_GAME = String.raw`$g = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\steamapps\common\*' })
$g | ForEach-Object { $_.ProcessName } | Sort-Object -Unique
$g | Stop-Process -Force -ErrorAction SilentlyContinue`

// Only processes that run from this Jarvis folder, so your other projects keep running.
const gameModeScript = (root) => String.raw`$root = ${psQuote(root)}
$n = 0
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -notmatch 'remote\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }
$m = 0
$ol = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ol) { $p = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'; if (Test-Path $p) { $ol = $p } }
if ($ol) {
  & $ol ps | Select-Object -Skip 1 | ForEach-Object {
    $name = ($_ -split '\s+')[0]
    if ($name) { & $ol stop $name | Out-Null; $m++ }
  }
}
"$n|$m"`

const OLLAMA_STOP = String.raw`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'ollama*' } | Stop-Process -Force -ErrorAction SilentlyContinue`

const OLLAMA_START = String.raw`$p = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
if (Test-Path $p) { Start-Process $p } else { Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden }`

const BATTERY = String.raw`$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`

const duration = (seconds) => {
  const m = Math.floor(seconds / 60)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

/**
 * `launch(target)` opens a Steam or app address, `desktop(action)` locks or sleeps,
 * `games()` lists the game names and `gameUrl(name)` gives the Steam address for one.
 * Everything else here is injectable so it can be tested without Windows.
 */
export function createRemoteActions({
  root,
  launch,
  desktop,
  games = () => [],
  gameUrl = () => null,
  buttonsFile,
  run = defaultRun,
  spawnFn = spawn,
  exists = existsSync,
  platform = process.platform,
  uptimeFn = uptime,
}) {
  const winOnly = () => {
    if (platform !== 'win32') throw new Error('This button works on Windows only.')
  }
  const ps = (script, opts) => {
    winOnly()
    return run('powershell.exe', psArgs(script), opts)
  }

  async function perform(action, arg) {
    if (KEYS[action]) {
      const [vk, times] = KEYS[action]
      await ps(keyScript(vk, times))
      return KEY_MESSAGES[action]
    }
    switch (action) {
      case 'steam_open':
        await launch('steam://open/main')
        return 'Opening Steam.'
      case 'steam_bigpicture':
        await launch('steam://open/bigpicture')
        return 'Opening Big Picture.'
      case 'steam_game': {
        const url = gameUrl(arg)
        if (!url) throw new Error('That game is not in games.json on this laptop.')
        await launch(url)
        return `Starting ${arg}. It can take a minute to reach the menu.`
      }
      case 'lock':
        await desktop('lock')
        return 'Locking.'
      case 'sleep':
        await desktop('sleep')
        return 'Going to sleep. The phone cannot wake it, so use the power button.'
      case 'restart':
        winOnly()
        await run('shutdown.exe', ['/r', '/t', '10', '/c', 'Restart from the phone'])
        return 'Restarting in 10 seconds. It comes back on its own. To cancel, run: shutdown /a'
      case 'screen_off':
        await ps(SCREEN_OFF)
        return 'Screen off. Moving the mouse turns it back on.'
      case 'close_game': {
        const names = (await ps(CLOSE_GAME)).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        return names.length ? `Closed: ${names.join(', ')}.` : 'No Steam game is running.'
      }
      case 'game_mode': {
        const out = (await ps(gameModeScript(root), { timeout: 30_000 })).trim().split(/\r?\n/).at(-1) ?? ''
        const [n, m] = out.split('|').map((x) => Number(x) || 0)
        return `Game mode: stopped ${n} Jarvis process${n === 1 ? '' : 'es'}, unloaded ${m} model${m === 1 ? '' : 's'}.`
      }
      case 'ollama_stop':
        await ps(OLLAMA_STOP)
        return 'Ollama stopped.'
      case 'ollama_start':
        await ps(OLLAMA_START)
        return 'Starting Ollama.'
      case 'jarvis_start': {
        const file = join(root, 'Jarvis-Local.cmd')
        if (!exists(file)) throw new Error('Jarvis-Local.cmd was not found in the Jarvis folder.')
        await launch(file)
        return 'Starting Jarvis (local). It opens a window on the laptop.'
      }
      case 'git_pull': {
        const out = await run('git', ['-C', root, 'pull', '--ff-only'], { timeout: 60_000 })
        const last = out.trim().split(/\r?\n/).at(-1) || 'Done.'
        return `Update: ${last.slice(0, 120)}`
      }
      case 'status':
        return statusText()
      case 'app': {
        const key = String(arg ?? '').toLowerCase().trim()
        if (!Object.hasOwn(APPS, key)) throw new Error('Unknown app.')
        await launch(APPS[key])
        return `Opening ${key}.`
      }
      case 'button':
        return runButton(arg)
      default:
        throw new Error('Unknown action.')
    }
  }

  async function statusText() {
    const parts = []
    try {
      const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'])
      const [t, u, used, total] = out.trim().split(/\r?\n/)[0].split(/\s*,\s*/).map(Number)
      if ([t, u, used, total].every(Number.isFinite)) parts.push(`GPU ${t} °C, ${u}% busy, ${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB`)
    } catch {
      // No NVIDIA tool: skip the GPU part.
    }
    try {
      const out = (await ps(BATTERY)).trim()
      const [pct, st] = out.split('|').map(Number)
      if (Number.isFinite(pct)) parts.push(`Battery ${pct}% (${[1, 4, 5].includes(st) ? 'on battery' : 'plugged in'})`)
    } catch {
      // No battery information.
    }
    parts.push(`Up ${duration(uptimeFn())}`)
    return parts.join(' · ')
  }

  function runButton(name) {
    const key = String(name ?? '').toLowerCase().trim()
    const button = Object.hasOwn(knownButtons(buttonsFile), key) ? knownButtons(buttonsFile)[key] : null
    if (!button) throw new Error('That button is not in buttons.json on this laptop.')
    winOnly()
    if (button.cwd && !exists(button.cwd)) throw new Error('The folder for that button does not exist.')
    return new Promise((resolve, reject) => {
      const child = spawnFn('cmd.exe', ['/d', '/s', '/c', `"${button.command}"`], {
        cwd: button.cwd || undefined,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      child.once('error', () => reject(new Error('That command could not be started.')))
      child.once('spawn', () => {
        child.unref()
        resolve(`Started: ${key}.`)
      })
    })
  }

  return {
    run: perform,
    info: () => ({ games: games(), buttons: Object.keys(knownButtons(buttonsFile)), apps: Object.keys(APPS) }),
  }
}
