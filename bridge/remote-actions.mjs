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
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, uptime } from 'node:os'
import { dirname, join } from 'node:path'

/** Apps the phone may open, by a fixed address each. */
export const APPS = { discord: 'discord://', spotify: 'spotify:', epic: 'com.epicgames.launcher://apps' }

/** Apps found by their name in the Start menu (Store apps have no simple address). `*` matches anything. */
export const START_APPS = { claude: 'Claude', glidex: '*Glide*X*' }

/** Apps you add yourself: { "name on the button": "exact name in the Start menu" }. Odd entries are ignored. */
export function knownRemoteApps(file = join(homedir(), '.jarvis', 'remote-apps.json')) {
  const out = {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const [name, v] of Object.entries(raw)) {
      const key = String(name).toLowerCase().trim()
      const target = typeof v === 'string' ? v.trim() : ''
      // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
      if (!key || key.length > 30 || !target || target.length > 60 || /[\u0000-\u001f]/.test(key + target)) continue
      if (Object.hasOwn(APPS, key) || Object.hasOwn(START_APPS, key)) continue
      out[key] = target
    }
  } catch {
    // No file: only the built-in apps.
  }
  return out
}

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
  'update_remote',
  'status',
  'app',
  'button',
  'game_focus',
  'mode_saver',
  'mode_balanced',
  'mode_gaming',
  'cap_on',
  'cap_off',
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
      // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
      if (/[\r\n\u0000]/.test(command) || /[\r\n\u0000]/.test(cwd)) continue
      out[key] = { command, cwd }
    }
  } catch {
    // No file: no custom buttons.
  }
  return out
}

function defaultRun(file, args, { timeout = 15_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // The callback also receives a failure to start, so nothing is left unhandled.
    execFile(file, args, { windowsHide: true, timeout, cwd, maxBuffer: 1 << 20 }, (err, stdout) =>
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

/** Windows power modes. The overlay is the Windows 11 "Power mode" slider; the plan is the older fallback. */
const MODES = {
  saver: { name: 'Power saving', overlay: 'OVERLAY_SCHEME_MIN', plan: 'a1841308-3541-4fab-bc81-f71556f20b4a', cap: false },
  balanced: { name: 'Balanced', overlay: 'OVERLAY_SCHEME_NONE', plan: '381b4222-f694-41f0-9685-ff5bb260df2e', cap: false },
  gaming: { name: 'Gaming', overlay: 'OVERLAY_SCHEME_MAX', plan: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', cap: true },
}
export const GOVERNOR_TASK = 'Jarvis GPU Governor'

const FOCUS_GAME = String.raw`Add-Type -Namespace W -Name F -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'
$g = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*\steamapps\common\*' -and $_.MainWindowHandle -ne 0 } | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
if ($g) {
  [W.F]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W.F]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [W.F]::ShowWindow($g.MainWindowHandle, 9) | Out-Null
  [W.F]::SetForegroundWindow($g.MainWindowHandle) | Out-Null
  $g.ProcessName
}`

const startAppScript = (name, exact) => String.raw`$n = ${psQuote(name)}
$a = Get-StartApps | Where-Object { ${exact ? '$_.Name -eq $n' : '$_.Name -like $n'} } | Select-Object -First 1
if ($a) { Start-Process explorer.exe ("shell:AppsFolder\" + $a.AppID); $a.Name }`

// Restarts only the remote (never Jarvis): waits so the answer can be sent first, stops the old copy, starts the new one.
const restartRemoteScript = (root, task) => String.raw`$root = ${psQuote(root)}
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'remote\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
if (Get-ScheduledTask -TaskName ${psQuote(task)} -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName ${psQuote(task)} }
else { Start-Process node -ArgumentList 'scripts\remote.mjs' -WorkingDirectory $root -WindowStyle Hidden }`
export const REMOTE_TASK = 'Jarvis Remote Buttons'

const MODEL = String.raw`Get-CimInstance Win32_ComputerSystem | ForEach-Object { "$($_.Manufacturer)|$($_.Model)" }`

/** "ROG Strix G614JV_G614JV" -> "ROG Strix G614JV". Only a name to show, never used for anything else. */
export function cleanModel(text) {
  const model = String(text ?? '').trim().split(/\r?\n/).at(-1)?.split('|').slice(1).join('|') ?? ''
  return model.replace(/_.*$/, '').replace(/[^\w .+-]/g, '').trim().slice(0, 40)
}

/** The signed-in Steam user (display name and 17-digit id) from config/loginusers.vdf. No passwords are touched. */
export function parseSteamLogin(vdf) {
  const users = []
  for (const m of String(vdf ?? '').matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
    const field = (k) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[2])?.[1]
    users.push({ id: m[1], name: field('PersonaName') || field('AccountName') || '', recent: field('MostRecent') === '1' })
  }
  const pick = users.find((u) => u.recent && u.name) ?? users.find((u) => u.name)
  return pick ? { id: pick.id, name: pick.name.slice(0, 40) } : { id: '', name: '' }
}
export const parseSteamUser = (vdf) => parseSteamLogin(vdf).name

const regValue = (out, name) => new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i').exec(String(out))?.[1]?.trim() ?? ''

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
  gameIds = () => ({}),
  gameUrl = () => null,
  buttonsFile,
  appsFile,
  stateFile = join(homedir(), '.jarvis', 'gpu-governor.json'),
  artDir = join(homedir(), '.jarvis', 'art'),
  targetC = Number(process.env.JARVIS_GPU_TARGET_C) || 70,
  capEnabled = process.env.JARVIS_REMOTE_CAP === '1',
  focusDelayMs = Number(process.env.JARVIS_GAME_FOCUS_SECONDS ?? 120) * 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  readText = (file) => readFileSync(file, 'utf8'),
  readBytes = (file) => readFileSync(file),
  fileSize = (file) => statSync(file).size,
  writeAtomic = (file, text) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  },
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
        const wait = focusDelayMs > 0 ? scheduleFocus() : ''
        return `Starting ${arg}. It can take a minute to reach the menu.${wait}`
      }
      case 'game_focus':
        return focusGame()
      case 'mode_saver':
      case 'mode_balanced':
      case 'mode_gaming':
        return setMode(action.slice(5))
      case 'cap_on':
      case 'cap_off': {
        if (!capEnabled) throw new Error('The software graphics cap is off on this laptop. Set JARVIS_REMOTE_CAP=1 to use it.')
        const state = readState()
        writeState({ ...state, enabled: action === 'cap_on' })
        return `Graphics cap ${action === 'cap_on' ? `on (${clampTarget(targetC)} °C)` : 'off'}.${await governorNote()}`
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
      case 'update_remote':
        return updateRemote()
      case 'status':
        return statusText()
      case 'app': {
        const key = String(arg ?? '').toLowerCase().trim()
        if (Object.hasOwn(APPS, key)) {
          await launch(APPS[key])
          return `Opening ${key}.`
        }
        const custom = knownRemoteApps(appsFile)
        const found = Object.hasOwn(START_APPS, key) ? { name: START_APPS[key], exact: false } : Object.hasOwn(custom, key) ? { name: custom[key], exact: true } : null
        if (!found) throw new Error('Unknown app.')
        const opened = (await ps(startAppScript(found.name, found.exact))).trim().split(/\r?\n/)[0]
        if (!opened) throw new Error(`${key} was not found in the Start menu on this laptop.`)
        return `Opening ${opened}.`
      }
      case 'button':
        return runButton(arg)
      default:
        throw new Error('Unknown action.')
    }
  }

  // -- game window, power modes and the graphics temperature cap --------------------------

  let focusTimer = null
  function scheduleFocus() {
    if (focusTimer) clearTimer(focusTimer)
    focusTimer = setTimer(() => {
      focusTimer = null
      ps(FOCUS_GAME).catch(() => {})
    }, focusDelayMs)
    focusTimer?.unref?.()
    const min = focusDelayMs / 60_000
    return ` I will bring the game to the front in ${Number.isInteger(min) ? min : min.toFixed(1)} minute${min === 1 ? '' : 's'}.`
  }

  async function focusGame() {
    const name = (await ps(FOCUS_GAME)).trim().split(/\r?\n/)[0]
    return name ? `Showing ${name}.` : 'No game window was found yet.'
  }

  const clampTarget = (n) => Math.min(Math.max(Math.round(Number(n) || 70), 60), 85)
  function readState() {
    try {
      const raw = JSON.parse(readText(stateFile))
      return { enabled: raw?.enabled === true, mode: Object.hasOwn(MODES, raw?.mode) ? raw.mode : '' }
    } catch {
      return { enabled: false, mode: '' }
    }
  }
  function writeState({ enabled, mode }) {
    writeAtomic(stateFile, JSON.stringify({ enabled: Boolean(enabled), target: clampTarget(targetC), mode: mode ?? '' }))
  }

  let governorCache = { at: 0, value: false }
  async function governorInstalled() {
    if (platform !== 'win32') return false
    if (Date.now() - governorCache.at < 60_000) return governorCache.value
    const value = await run('schtasks.exe', ['/query', '/tn', GOVERNOR_TASK]).then(() => true, () => false)
    governorCache = { at: Date.now(), value }
    return value
  }
  async function governorNote() {
    return (await governorInstalled()) ? '' : ' The cap does nothing until you run Setup-Governor.cmd once as administrator.'
  }

  async function setMode(mode) {
    winOnly()
    const m = MODES[mode]
    try {
      await run('powercfg.exe', ['/overlaysetactive', m.overlay])
    } catch {
      try {
        await run('powercfg.exe', ['/setactive', m.plan])
      } catch {
        // "High performance" is hidden on some laptops; make a copy of it and use that.
        const copy = mode === 'gaming' ? /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(await run('powercfg.exe', ['/duplicatescheme', m.plan]).catch(() => ''))?.[1] : null
        if (!copy) throw new Error('Windows would not change the power mode on this laptop.')
        await run('powercfg.exe', ['/setactive', copy])
      }
    }
    const cap = m.cap && capEnabled
    writeState({ enabled: cap, mode })
    if (!capEnabled) return `${m.name} mode: Windows power mode set.`
    return `${m.name} mode.${cap ? ` Graphics temperature cap ${clampTarget(targetC)} °C is on.${await governorNote()}` : ' Graphics temperature cap is off.'}`
  }

  let versionCache = { at: 0, value: '' }
  async function gitVersion() {
    if (Date.now() - versionCache.at < 20_000) return versionCache.value
    const value = await run('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).then((o) => (/^[0-9a-f]{4,12}$/.exec(o.trim()) ?? [''])[0], () => '')
    versionCache = { at: Date.now(), value }
    return value
  }

  async function updateRemote() {
    const head = async () => (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).trim()
    const before = await head()
    await run('git', ['-C', root, 'pull', '--ff-only'], { timeout: 60_000 })
    const after = await head()
    versionCache.at = 0
    if (before === after) return 'Already up to date. Nothing to restart.'
    const changed = (await run('git', ['-C', root, 'diff', '--name-only', before, after])).split(/\r?\n/).filter(Boolean)
    if (changed.some((f) => f === 'package.json' || f === 'package-lock.json')) {
      winOnly()
      await run('cmd.exe', ['/d', '/s', '/c', 'npm install'], { timeout: 180_000, cwd: root })
    }
    winOnly()
    const child = spawnFn('powershell.exe', psArgs(restartRemoteScript(root, REMOTE_TASK)), { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', () => {})
    child.unref?.()
    return `Updated ${changed.length} file${changed.length === 1 ? '' : 's'} to ${after.slice(0, 7)}. Restarting the remote: reload this page in about 20 seconds.`
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

  let modelCache = null
  const loadModel = () =>
    (modelCache ??= (platform === 'win32' ? ps(MODEL).then(cleanModel, () => '') : Promise.resolve('')))

  async function steamInfo() {
    if (platform !== 'win32') return null
    try {
      const key = 'HKCU\\Software\\Valve\\Steam'
      const path = regValue(await run('reg.exe', ['query', key, '/v', 'SteamPath']), 'SteamPath') || 'C:\\Program Files (x86)\\Steam'
      const login = parseSteamLogin(readText(join(path, 'config', 'loginusers.vdf')))
      const user = login.name
      let playing = ''
      try {
        const id = Number.parseInt(regValue(await run('reg.exe', ['query', key, '/v', 'RunningAppID']), 'RunningAppID'), 16)
        if (id > 0) playing = Object.entries(gameIds()).find(([, v]) => Number(v) === id)?.[0] ?? `app ${id}`
      } catch {
        // Not running a game, or the value is missing.
      }
      return { user, playing, id: login.id, path }
    } catch {
      return null
    }
  }

  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  /** Where the picture is: one you chose (art/avatar.*), else the profile picture Steam keeps for the signed-in user. Small files only. */
  function avatarFile(steam) {
    const candidates = []
    for (const ext of Object.keys(IMAGE_TYPES)) candidates.push([join(artDir, `avatar.${ext}`), ext])
    if (platform === 'win32' && steam?.id && steam.path) {
      for (const ext of ['png', 'jpg']) candidates.push([join(steam.path, 'config', 'avatarcache', `${steam.id}.${ext}`), ext])
    }
    for (const [file, ext] of candidates) {
      try {
        if (exists(file) && fileSize(file) <= 1024 * 1024) return { file, type: IMAGE_TYPES[ext] }
      } catch {
        // Unreadable: try the next one.
      }
    }
    return null
  }
  /** Picture for a game: art/games/<game name>.(png|jpg|webp). Only names from your own games list, so nothing else can be reached. */
  function gameArtFile(name) {
    const key = String(name ?? '').toLowerCase().trim()
    if (!/^[a-z0-9 _.+-]{1,60}$/.test(key) || key.includes('..') || !games().map((g) => String(g).toLowerCase()).includes(key)) return null
    for (const ext of Object.keys(IMAGE_TYPES)) {
      const file = join(artDir, 'games', `${key}.${ext}`)
      try {
        if (exists(file) && fileSize(file) <= 1.5 * 1024 * 1024) return { file, type: IMAGE_TYPES[ext] }
      } catch {
        // Unreadable: try the next one.
      }
    }
    return null
  }
  async function gameArt(name) {
    const found = gameArtFile(name)
    return found ? { type: found.type, bytes: readBytes(found.file) } : null
  }
  async function avatar() {
    const found = avatarFile(await steamInfo())
    return found ? { type: found.type, bytes: readBytes(found.file) } : null
  }

  return {
    run: perform,
    async info() {
      let timer
      const model = await Promise.race([loadModel(), new Promise((r) => (timer = setTimeout(() => r(''), 1200)))])
      clearTimeout(timer)
      const steam = await steamInfo()
      const state = readState()
      return {
        games: games(),
        buttons: Object.keys(knownButtons(buttonsFile)),
        version: await gitVersion(),
        gameArt: games().filter((g) => gameArtFile(g)),
        apps: [...Object.keys(APPS), ...Object.keys(START_APPS), ...Object.keys(knownRemoteApps(appsFile))],
        model,
        steam: steam ? { user: steam.user, playing: steam.playing, avatar: Boolean(avatarFile(steam)) } : null,
        mode: state.mode,
        cap: capEnabled ? { on: state.enabled, target: clampTarget(targetC) } : null,
        governor: capEnabled ? await governorInstalled() : false,
      }
    },
    avatar,
    gameArt,
  }
}
