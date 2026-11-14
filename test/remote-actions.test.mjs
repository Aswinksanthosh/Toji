// What the phone buttons do on a laptop. Windows calls are faked, so this runs anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { APPS, REMOTE_ACTIONS, cleanModel, createRemoteActions, knownButtons, parseSteamLogin, parseSteamUser } from '../bridge/remote-actions.mjs'

const ROOT = 'C:\\Users\\me\\Toji'

function setup(over = {}) {
  const calls = { run: [], launch: [], desktop: [], spawn: [] }
  const dir = mkdtempSync(join(tmpdir(), 'btn-'))
  const buttonsFile = join(dir, 'buttons.json')
  writeFileSync(buttonsFile, JSON.stringify({ 'My Tests': { command: 'npm test', cwd: 'C:\\proj' }, bad: { command: 'a\nb' } }))
  const actions = createRemoteActions({
    root: ROOT,
    launch: async (t) => calls.launch.push(t),
    desktop: async (a) => calls.desktop.push(a),
    games: () => ['pubg'],
    gameUrl: (n) => (n === 'pubg' ? 'steam://rungameid/578080' : null),
    buttonsFile,
    run: async (file, args) => (calls.run.push([file, args]), over.out ?? ''),
    spawnFn: (cmd, args, opts) => {
      calls.spawn.push([cmd, args, opts])
      const child = new EventEmitter()
      child.unref = () => {}
      setImmediate(() => child.emit('spawn'))
      return child
    },
    exists: () => true,
    platform: 'win32',
    uptimeFn: () => 7500,
    ...over.extra,
  })
  return { actions, calls }
}
const decode = (args) => Buffer.from(args.at(-1), 'base64').toString('utf16le')

test('every listed action is handled, and an unknown one is refused', async () => {
  const { actions } = setup()
  for (const action of REMOTE_ACTIONS) {
    const arg = action === 'steam_game' ? 'pubg' : action === 'app' ? 'discord' : action === 'button' ? 'my tests' : undefined
    await assert.doesNotReject(actions.run(action, arg), action)
  }
  await assert.rejects(actions.run('format_disk'), /Unknown action/)
  await assert.rejects(actions.run('steam_game; calc'), /Unknown action/)
})

test('steam: a game must be in the list, apps must be in the fixed list', async () => {
  const { actions, calls } = setup()
  await actions.run('steam_game', 'pubg')
  assert.deepEqual(calls.launch, ['steam://rungameid/578080'])
  await assert.rejects(actions.run('steam_game', 'unknown'), /not in games.json/)
  await actions.run('app', 'Discord')
  assert.equal(calls.launch.at(-1), APPS.discord)
  await assert.rejects(actions.run('app', 'calc.exe'), /Unknown app/)
  await assert.rejects(actions.run('app', '__proto__'), /Unknown app/)
  await assert.rejects(actions.run('app', 'toString'), /Unknown app/)
})

test('volume and media keys press the right key the right number of times', async () => {
  const { actions, calls } = setup()
  await actions.run('volume_up')
  const [file, args] = calls.run.at(-1)
  assert.equal(file, 'powershell.exe')
  const script = decode(args)
  assert.match(script, /keybd_event\(175, 0, 0/)
  assert.match(script, /1\.\.5 \|/)
  await actions.run('media_playpause')
  assert.match(decode(calls.run.at(-1)[1]), /keybd_event\(179/)
  await actions.run('mute')
  assert.match(decode(calls.run.at(-1)[1]), /1\.\.1 \|/)
})

test('restart waits 10 seconds so it can be cancelled; screen off and sleep do not need a shell', async () => {
  const { actions, calls } = setup()
  assert.match(await actions.run('restart'), /10 seconds/)
  assert.deepEqual(calls.run.at(-1), ['shutdown.exe', ['/r', '/t', '10', '/c', 'Restart from the phone']])
  await actions.run('screen_off')
  assert.match(decode(calls.run.at(-1)[1]), /0x0112, 0xF170, 2/)
  await actions.run('sleep')
  assert.deepEqual(calls.desktop, ['sleep'])
})

test('close game only touches processes inside steamapps\\common and reports what it closed', async () => {
  const { actions, calls } = setup({ out: 'PUBG\r\nBattlEye\r\n' })
  assert.equal(await actions.run('close_game'), 'Closed: PUBG, BattlEye.')
  assert.match(decode(calls.run.at(-1)[1]), /\\steamapps\\common\\/)
  const none = setup({ out: '' })
  assert.equal(await none.actions.run('close_game'), 'No Steam game is running.')
})

test('game mode only stops processes from this Jarvis folder, never the remote agent, and unloads models', async () => {
  const { actions, calls } = setup({ out: '2|1\r\n' })
  assert.equal(await actions.run('game_mode'), 'Game mode: stopped 2 Jarvis processes, unloaded 1 model.')
  const script = decode(calls.run.at(-1)[1])
  assert.ok(script.includes(`$root = '${ROOT}'`))
  assert.match(script, /notmatch 'remote\\.mjs'/)
  assert.match(script, /ollama|\$ol/)
  assert.doesNotMatch(script, /vite/)
})

test('a folder name with a quote cannot break out of the game mode script', async () => {
  const calls = []
  const a = createRemoteActions({ root: "C:\\it's\\Toji", launch: async () => {}, desktop: async () => {}, run: async (f, args) => (calls.push(args), '0|0'), platform: 'win32' })
  await a.run('game_mode')
  assert.ok(decode(calls[0]).includes("$root = 'C:\\it''s\\Toji'"))
})

test('update runs git pull in the Jarvis folder only, fast-forward only', async () => {
  const { actions, calls } = setup({ out: 'Updating a..b\nFast-forward\nAlready up to date.\n' })
  assert.equal(await actions.run('git_pull'), 'Update: Already up to date.')
  assert.deepEqual(calls.run.at(-1), ['git', ['-C', ROOT, 'pull', '--ff-only']])
})

test('start Jarvis needs Jarvis-Local.cmd to exist in the folder', async () => {
  const { actions, calls } = setup()
  await actions.run('jarvis_start')
  assert.equal(calls.launch.at(-1), join(ROOT, 'Jarvis-Local.cmd'))
  const missing = setup({ extra: { exists: () => false } })
  await assert.rejects(missing.actions.run('jarvis_start'), /not found/)
})

test('status reports graphics card, battery and uptime, and survives a missing card', async () => {
  const outs = ['58, 12, 2048, 8188\n', '80|2\n']
  const a = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, run: async () => outs.shift(), platform: 'win32', uptimeFn: () => 7500 })
  assert.equal(await a.run('status'), 'GPU 58 °C, 12% busy, 2.0/8.0 GB · Battery 80% (plugged in) · Up 2h 5m')
  const b = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, run: async () => { throw new Error('nope') }, platform: 'win32', uptimeFn: () => 90 })
  assert.equal(await b.run('status'), 'Up 1m')
})

test('your own buttons: only names from buttons.json run, never text from the phone', async () => {
  const { actions, calls } = setup()
  assert.match(await actions.run('button', 'MY TESTS'), /Started: my tests/)
  const [cmd, args, opts] = calls.spawn.at(-1)
  assert.equal(cmd, 'cmd.exe')
  assert.deepEqual(args, ['/d', '/s', '/c', '"npm test"'])
  assert.equal(opts.cwd, 'C:\\proj')
  await assert.rejects(actions.run('button', 'npm test'), /not in buttons.json/)
  await assert.rejects(actions.run('button', 'bad'), /not in buttons.json/)
  await assert.rejects(actions.run('button', 'constructor'), /not in buttons.json/)
  assert.equal(calls.spawn.length, 1)
})

test('knownButtons ignores odd entries and a missing file', () => {
  assert.deepEqual(knownButtons(join(tmpdir(), 'no-such-buttons.json')), {})
  const dir = mkdtempSync(join(tmpdir(), 'btn-'))
  const f = join(dir, 'b.json')
  writeFileSync(f, JSON.stringify({ ok: { command: 'echo hi' }, empty: { command: '  ' }, long: { command: 'x'.repeat(400) }, num: { command: 5 }, ['n'.repeat(50)]: { command: 'x' } }))
  assert.deepEqual(Object.keys(knownButtons(f)), ['ok'])
})

test('on other systems the Windows-only buttons say so instead of running anything', async () => {
  const calls = []
  const a = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, run: async (...x) => calls.push(x), platform: 'linux' })
  await assert.rejects(a.run('restart'), /Windows only/)
  await assert.rejects(a.run('volume_up'), /Windows only/)
  assert.deepEqual(calls, [])
})

const VDF = `"users"
{
\t"76561198000000001"
\t{
\t\t"AccountName"\t\t"olduser"
\t\t"PersonaName"\t\t"Old Name"
\t\t"MostRecent"\t\t"0"
\t}
\t"76561198000000002"
\t{
\t\t"AccountName"\t\t"login2"
\t\t"PersonaName"\t\t"Current Name"
\t\t"MostRecent"\t\t"1"
\t}
}`

test('the Steam user is the display name of the most recent login, and passwords are never read', () => {
  assert.equal(parseSteamUser(VDF), 'Current Name')
  assert.equal(parseSteamUser('"users" { "76561198000000009" { "AccountName" "only" } }'), 'only')
  assert.equal(parseSteamUser(''), '')
  assert.equal(parseSteamUser('garbage'), '')
})

test('the model name is shown tidy, and nothing odd gets through', () => {
  assert.equal(cleanModel('ASUSTeK COMPUTER INC.|ROG Strix G614JV_G614JV\r\n'), 'ROG Strix G614JV')
  assert.equal(cleanModel('ASUSTeK COMPUTER INC.|ASUS TUF Gaming A15 FA507NV_FA507NV'), 'ASUS TUF Gaming A15 FA507NV')
  assert.equal(cleanModel('x|<script>alert(1)</script>'), 'scriptalert1script')
  assert.equal(cleanModel(''), '')
})

test('info lists games, button names, apps, the model and the Steam user with the game that is running', async () => {
  const run = async (file, args) => {
    if (file === 'powershell.exe') return 'ASUSTeK COMPUTER INC.|ROG Strix G614JV_G614JV\r\n'
    const joined = args.join(' ')
    if (joined.includes('SteamPath')) return '    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n'
    if (joined.includes('RunningAppID')) return '    RunningAppID    REG_DWORD    0x8d220\r\n'
    return ''
  }
  const read = []
  const dir = mkdtempSync(join(tmpdir(), 'btn-'))
  const buttonsFile = join(dir, 'b.json')
  writeFileSync(buttonsFile, JSON.stringify({ 'My Tests': { command: 'npm test' } }))
  const a = createRemoteActions({
    root: ROOT, launch: async () => {}, desktop: async () => {}, games: () => ['pubg'], gameIds: () => ({ pubg: '578080' }),
    buttonsFile, run, platform: 'win32', readText: (f) => { if (f.endsWith('loginusers.vdf')) { read.push(f); return VDF } throw new Error('no state') },
    exists: () => false, stateFile: 'state.json',
  })
  const info = await a.info()
  assert.deepEqual(info, {
    games: ['pubg'], buttons: ['my tests'], apps: ['discord', 'spotify', 'epic'],
    model: 'ROG Strix G614JV', steam: { user: 'Current Name', playing: 'pubg', avatar: false },
    mode: '', cap: { on: false, target: 70 }, governor: true,
  })
  assert.ok(read[0].replace(/\\/g, '/').endsWith('steam/config/loginusers.vdf'))
})

test('info works with no Steam and no model (other systems, or a slow answer)', async () => {
  const a = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, platform: 'linux', stateFile: 'none.json', readText: () => { throw new Error('none') } })
  assert.deepEqual(await a.info(), { games: [], buttons: [], apps: ['discord', 'spotify', 'epic'], model: '', steam: null, mode: '', cap: { on: false, target: 70 }, governor: false })
  const b = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, run: async () => { throw new Error('x') }, platform: 'win32' })
  const info = await b.info()
  assert.equal(info.model, '')
  assert.equal(info.steam, null)
})

// -- the game window, power modes, the graphics temperature cap and the profile picture --------

function lab(over = {}) {
  const files = new Map()
  const calls = { run: [], timers: [], cleared: [], launch: [] }
  const base = {
    root: ROOT,
    launch: async (t) => calls.launch.push(t),
    desktop: async () => {},
    gameUrl: (n) => (n === 'pubg' ? 'steam://rungameid/578080' : null),
    platform: 'win32',
    stateFile: 'state.json',
    artDir: 'art',
    readText: (f) => { if (files.has(f)) return files.get(f); throw new Error('missing') },
    writeAtomic: (f, text) => files.set(f, text),
    setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; calls.timers.push(t); return t },
    clearTimer: (t) => calls.cleared.push(t),
    focusDelayMs: 120_000,
    run: async (file, args) => { calls.run.push([file, args]); return '' },
  }
  const actions = createRemoteActions({ ...base, ...over })
  return { actions, files, calls }
}

test('after starting a game, the game window is brought to the front 2 minutes later; a new start replaces the timer', async () => {
  const { actions, calls } = lab()
  assert.match(await actions.run('steam_game', 'pubg'), /bring the game to the front in 2 minutes/)
  assert.equal(calls.timers[0].ms, 120_000)
  assert.equal(calls.run.length, 0)
  calls.timers[0].fn()
  await new Promise((r) => setImmediate(r))
  assert.match(decode(calls.run[0][1]), /SetForegroundWindow/)
  assert.match(decode(calls.run[0][1]), /steamapps\\common/)
  await actions.run('steam_game', 'pubg')
  await actions.run('steam_game', 'pubg')
  assert.equal(calls.cleared.length, 1)
})

test('the delay can be turned off, and a failed focus never crashes the agent', async () => {
  const off = lab({ focusDelayMs: 0 })
  assert.doesNotMatch(await off.actions.run('steam_game', 'pubg'), /front/)
  assert.equal(off.calls.timers.length, 0)
  const failing = lab({ run: async () => { throw new Error('boom') } })
  await failing.actions.run('steam_game', 'pubg')
  failing.calls.timers[0].fn()
  await new Promise((r) => setImmediate(r))
})

test('show game focuses the biggest Steam game window and says what it found', async () => {
  assert.equal(await lab({ run: async () => 'PUBG\r\n' }).actions.run('game_focus'), 'Showing PUBG.')
  assert.match(await lab({ run: async () => '' }).actions.run('game_focus'), /No game window/)
})

test('gaming mode sets the Windows power mode and turns the graphics cap on; power saving and balanced turn it off', async () => {
  const { actions, calls, files } = lab()
  const msg = await actions.run('mode_gaming')
  assert.deepEqual(calls.run[0], ['powercfg.exe', ['/overlaysetactive', 'OVERLAY_SCHEME_MAX']])
  assert.match(msg, /^Gaming mode\. Graphics temperature cap 70 °C is on\.$/)
  assert.deepEqual(JSON.parse(files.get('state.json')), { enabled: true, target: 70, mode: 'gaming' })
  assert.match(await actions.run('mode_saver'), /Power saving mode\. Graphics temperature cap is off/)
  assert.deepEqual(calls.run.find((c) => c[1][1] === 'OVERLAY_SCHEME_MIN')[0], 'powercfg.exe')
  assert.deepEqual(JSON.parse(files.get('state.json')), { enabled: false, target: 70, mode: 'saver' })
  await actions.run('mode_balanced')
  assert.ok(calls.run.some((c) => c[1][1] === 'OVERLAY_SCHEME_NONE'))
})

test('if the Windows power mode slider is not available, the older power plan is used, then a copy of High performance', async () => {
  const seen = []
  const run = async (file, args) => {
    seen.push(args)
    if (args[0] === '/overlaysetactive') throw new Error('no overlay')
    if (args[0] === '/setactive' && args[1] === '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c') throw new Error('hidden')
    if (args[0] === '/duplicatescheme') return 'Power Scheme GUID: 12345678-1234-1234-1234-123456789abc  (High performance)'
    return ''
  }
  const { actions } = lab({ run })
  await actions.run('mode_gaming')
  assert.deepEqual(seen.filter((a) => a[0] === '/setactive').at(-1), ['/setactive', '12345678-1234-1234-1234-123456789abc'])
  const used = []
  const saver = lab({ run: async (f, a) => { used.push(a); if (a[0] === '/overlaysetactive') throw new Error('no'); return '' } })
  await saver.actions.run('mode_saver')
  assert.ok(used.some((a) => a[0] === '/setactive' && a[1] === 'a1841308-3541-4fab-bc81-f71556f20b4a'))
  const none = lab({ run: async () => { throw new Error('no') } })
  await assert.rejects(none.actions.run('mode_balanced'), /would not change the power mode/)
})

test('the cap switch changes only the cap, keeps the mode, clamps the target, and tells you when the cap helper is not installed', async () => {
  const { actions, files } = lab({ targetC: 99, run: async (f) => { if (f === 'schtasks.exe') throw new Error('no task'); return '' } })
  assert.match(await actions.run('cap_on'), /Graphics cap on \(85 °C\)\. The cap does nothing until you run Setup-Governor\.cmd/)
  assert.deepEqual(JSON.parse(files.get('state.json')), { enabled: true, target: 85, mode: '' })
  await actions.run('mode_saver').catch(() => {})
  const again = lab()
  await again.actions.run('mode_gaming')
  assert.match(await again.actions.run('cap_off'), /^Graphics cap off\.$/)
  assert.deepEqual(JSON.parse(again.files.get('state.json')), { enabled: false, target: 70, mode: 'gaming' })
  const low = lab({ targetC: 10 })
  await low.actions.run('cap_on')
  assert.equal(JSON.parse(low.files.get('state.json')).target, 60)
})

test('the state file is read back safely: odd content means off and no mode', async () => {
  const { actions, files } = lab()
  files.set('state.json', '{"enabled":"yes","mode":"turbo; calc"}')
  assert.deepEqual((await actions.info()).cap, { on: false, target: 70 })
  assert.equal((await actions.info()).mode, '')
  files.set('state.json', 'not json')
  assert.equal((await actions.info()).mode, '')
  files.set('state.json', '{"enabled":true,"mode":"gaming"}')
  const info = await actions.info()
  assert.deepEqual([info.mode, info.cap.on], ['gaming', true])
})

test('the Steam login gives the id too, and the profile picture is yours first, then Steam\'s own, and never a big file', async () => {
  assert.deepEqual(parseSteamLogin(VDF), { id: '76561198000000002', name: 'Current Name' })
  assert.equal(parseSteamUser(VDF), 'Current Name')
  const png = Buffer.from([0x89, 0x50])
  const sizes = {}
  const have = new Set()
  const base = {
    run: async (file, args) => (file === 'reg.exe' && args.join(' ').includes('SteamPath') ? '    SteamPath    REG_SZ    c:/steam\r\n' : ''),
    readText: (f) => (f.endsWith('loginusers.vdf') ? VDF : (() => { throw new Error('none') })()),
    exists: (f) => have.has(f.replace(/\\/g, '/')),
    fileSize: (f) => sizes[f.replace(/\\/g, '/')] ?? 10,
    readBytes: (f) => Buffer.from(f.replace(/\\/g, '/')),
  }
  const a = lab(base).actions
  assert.equal(await a.avatar(), null)
  have.add('c:/steam/config/avatarcache/76561198000000002.png')
  const steamPic = await a.avatar()
  assert.equal(steamPic.type, 'image/png')
  assert.equal(String(steamPic.bytes), 'c:/steam/config/avatarcache/76561198000000002.png')
  assert.equal((await a.info()).steam.avatar, true)
  have.add('art/avatar.jpg')
  assert.equal(String((await a.avatar()).bytes), 'art/avatar.jpg')
  sizes['art/avatar.jpg'] = 5 * 1024 * 1024
  assert.equal(String((await a.avatar()).bytes), 'c:/steam/config/avatarcache/76561198000000002.png')
  void png
})
