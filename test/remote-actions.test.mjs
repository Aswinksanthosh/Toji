// What the phone buttons do on a laptop. Windows calls are faked, so this runs anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { APPS, REMOTE_ACTIONS, cleanModel, createRemoteActions, knownButtons, parseSteamUser } from '../bridge/remote-actions.mjs'

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
    buttonsFile, run, platform: 'win32', readText: (f) => (read.push(f), VDF),
  })
  const info = await a.info()
  assert.deepEqual(info, {
    games: ['pubg'], buttons: ['my tests'], apps: ['discord', 'spotify', 'epic'],
    model: 'ROG Strix G614JV', steam: { user: 'Current Name', playing: 'pubg' },
  })
  assert.ok(read[0].replace(/\\/g, '/').endsWith('steam/config/loginusers.vdf'))
})

test('info works with no Steam and no model (other systems, or a slow answer)', async () => {
  const a = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, platform: 'linux' })
  assert.deepEqual(await a.info(), { games: [], buttons: [], apps: ['discord', 'spotify', 'epic'], model: '', steam: null })
  const b = createRemoteActions({ root: ROOT, launch: async () => {}, desktop: async () => {}, run: async () => { throw new Error('x') }, platform: 'win32' })
  const info = await b.info()
  assert.equal(info.model, '')
  assert.equal(info.steam, null)
})
