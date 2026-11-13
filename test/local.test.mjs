// Keyboard shortcuts and file tools: what is allowed, and what must never be.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { fileRoots, decideTool } from '../bridge/policy.mjs'
import { listFolder, localServer, makeFolder, parseShortcut, readFile, writeFile } from '../bridge/local.mjs'

function ctx() {
  const workspace = mkdtempSync(join(tmpdir(), 'jarvis-ws-'))
  return { workspace, roots: fileRoots({ workspace }) }
}

test('shortcuts parse into modifiers and a key', () => {
  const s = parseShortcut('Ctrl + Shift + T')
  assert.equal(s.key, 0x54)
  assert.deepEqual(s.mods, [0x11, 0x10])
  assert.equal(parseShortcut('f11').key, 0x7a)
  assert.equal(parseShortcut('win+left').extended, true)
  assert.equal(parseShortcut('volumeup').key, 0xaf)
})

test('nonsense shortcuts are refused with a plain reason', () => {
  assert.match(parseShortcut('').error, /Say which keys/)
  assert.match(parseShortcut('hyper+t').error, /not a modifier/)
  assert.match(parseShortcut('ctrl+banana').error, /not a key/)
})

test('dangerous combinations are refused, however they are spelled', () => {
  for (const k of ['win+r', 'Win+R', 'windows+x', 'cmd+l', 'ctrl+alt+del', 'alt+ctrl+delete', 'ctrl+shift+esc', 'shift+ctrl+escape']) {
    assert.match(parseShortcut(k).error ?? '', /not allowed/, k)
  }
  assert.equal(parseShortcut('ctrl+t').error, undefined)
})

test('files can be written and read back inside the workspace', () => {
  const c = ctx()
  assert.equal(makeFolder('notes', c).isError, undefined)
  assert.equal(writeFile('notes/a.txt', 'hello', false, c).isError, undefined)
  assert.equal(readFileSync(join(c.workspace, 'notes', 'a.txt'), 'utf8'), 'hello')
  assert.match(readFile('notes/a.txt', c).content[0].text, /hello/)
  assert.match(listFolder('notes', c).content[0].text, /a\.txt/)
})

test('an existing file is never overwritten unless asked', () => {
  const c = ctx()
  writeFile('a.txt', 'one', false, c)
  assert.equal(writeFile('a.txt', 'two', false, c).isError, true)
  assert.equal(readFileSync(join(c.workspace, 'a.txt'), 'utf8'), 'one')
  assert.equal(writeFile('a.txt', 'two', true, c).isError, undefined)
  assert.equal(readFileSync(join(c.workspace, 'a.txt'), 'utf8'), 'two')
})

test('paths outside the allowed folders are refused, for reading and writing', () => {
  const c = ctx()
  const outside = mkdtempSync(join(process.cwd(), '.outside-'))
  try {
    writeFileSync(join(outside, 'secret.txt'), 'nope')
    assert.match(readFile(outside + '/secret.txt', c).content[0].text, /Blocked/)
    assert.equal(writeFile(outside + '/new.txt', 'x', false, c).isError, true)
    assert.equal(existsSync(join(outside, 'new.txt')), false)
    assert.equal(makeFolder(outside + '/dir', c).isError, true)
    assert.match(readFile('../../../../etc/hostname', c).content[0].text, /Blocked/)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('credential files are refused even inside an allowed folder', () => {
  const c = ctx()
  writeFileSync(join(c.workspace, '.env'), 'KEY=1')
  mkdirSync(join(c.workspace, 'sub'))
  assert.match(readFile('.env', c).content[0].text, /credentials/)
  assert.equal(writeFile('sub/id_rsa', 'x', false, c).isError, true)
  assert.equal(writeFile('cert.pem', 'x', false, c).isError, true)
})

test('a symlink cannot be used to escape the allowed folders', (t) => {
  const c = ctx()
  const outside = mkdtempSync(join(process.cwd(), '.outside-'))
  try {
    symlinkSync(outside, join(c.workspace, 'link'))
  } catch {
    rmSync(outside, { recursive: true, force: true })
    return t.skip('symlinks are not available here')
  }
  try {
    assert.equal(writeFile('link/escaped.txt', 'x', false, c).isError, true)
    assert.equal(existsSync(join(outside, 'escaped.txt')), false)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

async function toolNames(server) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(b)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(a)
  return (await client.listTools()).tools.map((t) => t.name).sort()
}

test('read-only mode offers no tool that changes anything', async () => {
  const c = ctx()
  const names = await toolNames(localServer({ ...c, allowWrites: false, platform: 'win32' }))
  assert.deepEqual(names, ['list_folder', 'read_file'])
})

test('writes mode adds file writing, and the keyboard only on Windows', async () => {
  const c = ctx()
  assert.deepEqual(await toolNames(localServer({ ...c, allowWrites: true, platform: 'win32' })), ['ask_gemini', 'click_element', 'list_clickable', 'list_folder', 'lock_screen', 'make_folder', 'open_app', 'open_url', 'play_youtube', 'press_keys', 'read_file', 'scroll', 'sleep_computer', 'steam_launch', 'steam_open', 'type_text', 'write_file'])
  assert.deepEqual(await toolNames(localServer({ ...c, allowWrites: true, platform: 'linux' })), ['list_folder', 'make_folder', 'read_file', 'write_file'])
})

test('press_keys passes the parsed shortcut to the runner, and refuses blocked ones before running', async () => {
  const c = ctx()
  const pressed = []
  const server = localServer({ ...c, allowWrites: true, platform: 'win32', press: async (s, app) => pressed.push([s.name, app]) })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(b)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(a)
  const good = await client.callTool({ name: 'press_keys', arguments: { keys: 'ctrl+t', app: 'chrome' } })
  assert.match(good.content[0].text, /Pressed ctrl\+t/)
  const bad = await client.callTool({ name: 'press_keys', arguments: { keys: 'win+r' } })
  assert.equal(bad.isError, true)
  assert.deepEqual(pressed, [['ctrl+t', 'chrome']])
})

test('the permission gate: reads are free, changes need writes mode', () => {
  assert.equal(decideTool('mcp__jarvis_local__list_folder', false), true)
  assert.equal(decideTool('mcp__jarvis_local__read_file', false), true)
  assert.equal(decideTool('mcp__jarvis_local__write_file', false), false)
  assert.equal(decideTool('mcp__jarvis_local__press_keys', false), false)
  assert.equal(decideTool('mcp__jarvis_local__press_keys', true), true)
})

test('ask_gemini passes a tidy question to the runner and labels the answer as untrusted', async () => {
  const c = ctx()
  const asked = []
  const server = localServer({ ...c, allowWrites: true, platform: 'win32', ask: async (q) => (asked.push(q), 'You have two meetings.') })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(b)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(a)
  const r = await client.callTool({ name: 'ask_gemini', arguments: { question: '  what is   on my calendar?\n' } })
  assert.deepEqual(asked, ['what is on my calendar?'])
  assert.match(r.content[0].text, /another AI/)
  assert.match(r.content[0].text, /two meetings/)
})

test('ask_gemini reports a failure plainly, and is absent without writes mode or off Windows', async () => {
  const c = ctx()
  const server = localServer({ ...c, allowWrites: true, platform: 'win32', ask: async () => { throw new Error('Gemini did not produce an answer in time.') } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(b)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(a)
  const r = await client.callTool({ name: 'ask_gemini', arguments: { question: 'hi' } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /in time/)
  assert.ok(!(await toolNames(localServer({ ...c, allowWrites: false, platform: 'win32' }))).includes('ask_gemini'))
  assert.ok(!(await toolNames(localServer({ ...c, allowWrites: true, platform: 'linux' }))).includes('ask_gemini'))
  assert.equal(decideTool('mcp__jarvis_local__ask_gemini', false), false)
})

// -- hands-free desktop controls ------------------------------------------------

import { knownApps, webAddress } from '../bridge/local.mjs'

async function connected(opts) {
  const c = ctx()
  const server = localServer({ ...c, allowWrites: true, platform: 'win32', ...opts })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(b)
  const client = new Client({ name: 't', version: '1' })
  await client.connect(a)
  return client
}

test('only web addresses can be opened, never files, scripts or app links', () => {
  assert.equal(webAddress('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(webAddress('http://localhost:5173'), 'http://localhost:5173/')
  for (const bad of ['file:///C:/Windows/system32/cmd.exe', 'javascript:alert(1)', 'ms-settings:', 'calc.exe', 'C:\\Windows\\notepad.exe', '', 'not a url']) {
    assert.equal(webAddress(bad), null, bad)
  }
})

test('open_app launches only names from the list, and nothing the model invents', async () => {
  const launched = []
  const client = await connected({ launch: async (t, o) => launched.push([t, o]), appsFile: join(tmpdir(), 'no-such-apps.json') })
  const ok = await client.callTool({ name: 'open_app', arguments: { name: 'Notepad' } })
  assert.match(ok.content[0].text, /Opened/)
  assert.deepEqual(launched, [['notepad.exe', undefined]])
  const bad = await client.callTool({ name: 'open_app', arguments: { name: 'powershell -c calc' } })
  assert.equal(bad.isError, true)
  assert.match(bad.content[0].text, /only know these/)
  assert.equal(launched.length, 1)
})

test('your own apps.json adds names, and cannot be used to smuggle a name in from a page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-apps-'))
  const file = join(dir, 'apps.json')
  writeFileSync(file, JSON.stringify({ Code: 'C:\\Tools\\Code.exe', bad: 5 }))
  const apps = knownApps(file)
  assert.equal(apps.code, 'C:\\Tools\\Code.exe')
  assert.equal(apps.bad, undefined)
  assert.equal(apps.notepad, 'notepad.exe')
})

test('open_url refuses anything but http and https', async () => {
  const launched = []
  const client = await connected({ launch: async (t, o) => launched.push([t, o]) })
  const good = await client.callTool({ name: 'open_url', arguments: { url: 'https://youtube.com' } })
  assert.equal(good.isError, undefined)
  assert.deepEqual(launched, [['https://youtube.com/', { web: true }]])
  const bad = await client.callTool({ name: 'open_url', arguments: { url: 'file:///C:/secret.txt' } })
  assert.equal(bad.isError, true)
  assert.equal(launched.length, 1)
})

test('typing, clicking, scrolling, locking and sleeping reach the desktop runner with clean inputs', async () => {
  const calls = []
  const client = await connected({ desktop: async (action, params) => (calls.push([action, params]), 'Send') })
  await client.callTool({ name: 'type_text', arguments: { text: 'hello team', submit: true } })
  await client.callTool({ name: 'click_element', arguments: { name: 'Send' } })
  await client.callTool({ name: 'scroll', arguments: { direction: 'down', amount: 5 } })
  await client.callTool({ name: 'list_clickable', arguments: {} })
  await client.callTool({ name: 'lock_screen', arguments: {} })
  await client.callTool({ name: 'sleep_computer', arguments: {} })
  assert.deepEqual(calls, [
    ['type', { text: 'hello team', submit: true }],
    ['click', { name: 'Send' }],
    ['scroll', { dir: 'down', amount: 5 }],
    ['list', {}],
    ['lock', {}],
    ['sleep', {}],
  ])
})

test('when a terminal has focus the refusal is spoken plainly, not a crash', async () => {
  const client = await connected({ desktop: async () => { throw new Error('I will not type or click while a terminal window has focus.') } })
  const r = await client.callTool({ name: 'type_text', arguments: { text: 'rm -rf /' } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /terminal/)
})

test('out-of-range scroll and over-long text are rejected before reaching the desktop', async () => {
  const calls = []
  const client = await connected({ desktop: async (a) => (calls.push(a), '') })
  const tooMuch = await client.callTool({ name: 'scroll', arguments: { direction: 'down', amount: 500 } }).catch((e) => ({ isError: true, e }))
  const tooLong = await client.callTool({ name: 'type_text', arguments: { text: 'x'.repeat(5000) } }).catch((e) => ({ isError: true, e }))
  assert.equal(tooMuch.isError, true)
  assert.equal(tooLong.isError, true)
  assert.deepEqual(calls, [])
})

test('none of the desktop tools exist without writes mode', async () => {
  const names = await toolNames(localServer({ ...ctx(), allowWrites: false, platform: 'win32' }))
  for (const n of ['open_app', 'open_url', 'type_text', 'click_element', 'list_clickable', 'scroll', 'lock_screen', 'sleep_computer']) {
    assert.ok(!names.includes(n), n)
  }
})

import { youtubeTarget } from '../bridge/local.mjs'

const page = (id) => ({ ok: true, text: async () => `...{"videoRenderer":{"videoId":"${id}","thumbnail":{}}...` })

test('play_youtube opens the top result as a watch link that autoplays', async () => {
  const seen = []
  const fetchFn = async (url) => (seen.push(url), page('dQw4w9WgXcQ'))
  assert.equal(await youtubeTarget('lo-fi beats & chill', fetchFn), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1')
  assert.equal(seen[0], 'https://www.youtube.com/results?search_query=lo-fi%20beats%20%26%20chill')
})

test('if YouTube cannot be read, the results page opens instead of nothing', async () => {
  const results = 'https://www.youtube.com/results?search_query=jazz'
  assert.equal(await youtubeTarget('jazz', async () => { throw new Error('offline') }), results)
  assert.equal(await youtubeTarget('jazz', async () => ({ ok: false, text: async () => '' })), results)
  assert.equal(await youtubeTarget('jazz', async () => ({ ok: true, text: async () => '<html>no videos</html>' })), results)
})

test('play_youtube launches in the browser you name, and open_url accepts a browser', async () => {
  const launched = []
  const client = await connected({ launch: async (t, o) => launched.push([t, o]), fetchFn: async () => page('abcdefghijk') })
  const r = await client.callTool({ name: 'play_youtube', arguments: { query: 'relaxing piano', browser: 'brave' } })
  assert.match(r.content[0].text, /Playing the top result/)
  await client.callTool({ name: 'open_url', arguments: { url: 'https://example.com', browser: 'brave' } })
  assert.deepEqual(launched, [
    ['https://www.youtube.com/watch?v=abcdefghijk&autoplay=1', { web: true, browser: 'brave' }],
    ['https://example.com/', { web: true, browser: 'brave' }],
  ])
  const bad = await client.callTool({ name: 'open_url', arguments: { url: 'https://example.com', browser: 'netscape' } }).catch((e) => ({ isError: true, e }))
  assert.equal(bad.isError, true)
})

test('the video id is still found when the keys inside videoRenderer are in a different order', async () => {
  const html = '..."videoRenderer":{"thumbnail":{"thumbnails":[{"url":"x"}]},"title":{"runs":[{"text":"A"}]},"videoId":"ZYXWVUTSRQP"}...'
  assert.equal(await youtubeTarget('x', async () => ({ ok: true, text: async () => html })), 'https://www.youtube.com/watch?v=ZYXWVUTSRQP&autoplay=1')
  const shortsOnly = '..."reelItemRenderer":{"videoId":"SHORTSSHORT"}...'
  assert.equal(await youtubeTarget('x', async () => ({ ok: true, text: async () => shortsOnly })), 'https://www.youtube.com/results?search_query=x')
})

test('the Gemini-app tool can be switched off, and the other desktop tools stay', async () => {
  const names = await toolNames(localServer({ ...ctx(), allowWrites: true, platform: 'win32', geminiApp: false }))
  assert.ok(!names.includes('ask_gemini'))
  assert.ok(names.includes('open_app') && names.includes('type_text') && names.includes('play_youtube'))
})

// -- Steam ------------------------------------------------------------------------

import { knownGames, steamGameUrl } from '../bridge/local.mjs'

test('games come only from your list or a plain number, and become a Steam address and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-games-'))
  const file = join(dir, 'games.json')
  writeFileSync(file, JSON.stringify({ Hades: 1145360, 'Portal 2': '620', evil: 'calc.exe', bad: '12 34', huge: '123456789012' }))
  assert.deepEqual(knownGames(file), { hades: '1145360', 'portal 2': '620' })
  assert.equal(steamGameUrl('Hades', file), 'steam://rungameid/1145360')
  assert.equal(steamGameUrl('  portal 2 ', file), 'steam://rungameid/620')
  assert.equal(steamGameUrl('730', file), 'steam://rungameid/730')
  for (const bad of ['evil', 'calc.exe', '730; calc', '..\\..\\x', '', 'unknown game', '12345678901']) {
    assert.equal(steamGameUrl(bad, file), null, bad)
  }
  assert.equal(steamGameUrl('hades', join(dir, 'missing.json')), null)
})

test('steam_launch and steam_open launch only steam:// addresses', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-games-'))
  const gamesFile = join(dir, 'games.json')
  writeFileSync(gamesFile, JSON.stringify({ hades: 1145360 }))
  const launched = []
  const client = await connected({ launch: async (t, o) => launched.push([t, o]), gamesFile })
  const ok = await client.callTool({ name: 'steam_launch', arguments: { game: 'Hades' } })
  assert.match(ok.content[0].text, /Starting Hades/)
  const unknown = await client.callTool({ name: 'steam_launch', arguments: { game: 'calc.exe' } })
  assert.equal(unknown.isError, true)
  assert.match(unknown.content[0].text, /hades/)
  await client.callTool({ name: 'steam_open', arguments: { mode: 'bigpicture' } })
  await client.callTool({ name: 'steam_open', arguments: {} })
  assert.deepEqual(launched, [
    ['steam://rungameid/1145360', undefined],
    ['steam://open/bigpicture', undefined],
    ['steam://open/main', undefined],
  ])
})

test('the Steam tools do not exist without writes mode', async () => {
  const names = await toolNames(localServer({ ...ctx(), allowWrites: false, platform: 'win32' }))
  assert.ok(!names.includes('steam_launch') && !names.includes('steam_open'))
})
