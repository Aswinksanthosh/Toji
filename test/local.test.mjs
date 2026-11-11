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
  assert.deepEqual(await toolNames(localServer({ ...c, allowWrites: true, platform: 'win32' })), ['ask_gemini', 'list_folder', 'make_folder', 'press_keys', 'read_file', 'write_file'])
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
