// The phone remote buttons: no AI, fixed actions, and who may press them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_ACTIONS, startAgent, startHub } from '../bridge/remote.mjs'

const TOKEN = 'agent-token-that-is-long-enough-123'
const PASSWORD = 'a-long-remote-passphrase'

async function agent(run = async (a, p) => `did ${a} ${p.game ?? ''}`.trim()) {
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run })
  const url = `http://127.0.0.1:${s.port}`
  const call = (path, body, token = TOKEN) =>
    fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { 'x-agent-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { ...s, url, call }
}

test('the agent refuses without the token, and does not read the request before checking it', async (t) => {
  let ran = 0
  const a = await agent(async () => (ran++, 'x'))
  t.after(() => a.close())
  assert.equal((await a.call('/agent/ping', null, '')).status, 401)
  assert.equal((await a.call('/agent/ping', null, 'wrong')).status, 401)
  assert.equal((await a.call('/agent/do', { action: 'lock' }, 'wrong')).status, 401)
  assert.equal(ran, 0)
  assert.equal((await a.call('/agent/ping')).status, 200)
})

test('the agent runs only its allow-listed actions', async (t) => {
  const seen = []
  const a = await agent(async (action, p) => (seen.push([action, p.game]), 'ok'))
  t.after(() => a.close())
  for (const action of AGENT_ACTIONS) assert.equal((await a.call('/agent/do', { action, game: 'hades' })).status, 200, action)
  for (const bad of ['wake', 'shell', 'delete_files', '', 'steam_game; calc']) {
    assert.equal((await a.call('/agent/do', { action: bad })).status, 400, bad)
  }
  assert.equal(seen.length, AGENT_ACTIONS.size)
  assert.deepEqual(seen.find(([a]) => a === 'steam_game'), ['steam_game', 'hades'])
})

test('the agent reports its games and buttons, and passes the name as game and arg', async (t) => {
  const seen = []
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async (a, p) => (seen.push([a, p]), 'ok'), info: () => ({ games: ['pubg'], buttons: ['tests'] }) })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const headers = { 'content-type': 'application/json', 'x-agent-token': TOKEN }
  assert.equal((await fetch(url + '/agent/info')).status, 401)
  assert.deepEqual(await (await fetch(url + '/agent/info', { headers })).json(), { ok: true, games: ['pubg'], buttons: ['tests'] })
  await fetch(url + '/agent/do', { method: 'POST', headers, body: JSON.stringify({ action: 'button', arg: 'tests' }) })
  await fetch(url + '/agent/do', { method: 'POST', headers, body: JSON.stringify({ action: 'steam_game', game: 'pubg' }) })
  assert.deepEqual(seen, [['button', { game: 'tests', arg: 'tests' }], ['steam_game', { game: 'pubg', arg: 'pubg' }]])
})

test('a failing action gives a short error, and an oversized body is refused', async (t) => {
  const a = await agent(async () => { throw new Error('That game is not in games.json on this laptop.') })
  t.after(() => a.close())
  const r = await a.call('/agent/do', { action: 'steam_game', game: 'x' })
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /not in games.json/)
  const big = await a.call('/agent/do', { action: 'lock', game: 'x'.repeat(5000) }).catch(() => ({ status: 413 }))
  assert.equal(big.status, 413)
})

const DEVICES = {
  'laptop-a': { mac: 'AA:BB:CC:DD:EE:01', broadcast: '10.0.0.255', agent: 'http://100.1.1.1:8790' },
  'laptop-b': { mac: 'AA:BB:CC:DD:EE:02', broadcast: '10.0.0.255', agent: 'http://100.1.1.2:8790' },
  'wake-only': { mac: 'AA:BB:CC:DD:EE:03', broadcast: '10.0.0.255', agent: '' },
  'agent-only': { mac: '', broadcast: '255.255.255.255', agent: 'http://100.1.1.4:8790' },
}

async function hub() {
  const log = { wake: [], forward: [] }
  const s = await startHub({
    password: PASSWORD,
    port: 0,
    host: '127.0.0.1',
    getDevices: () => DEVICES,
    getGames: () => ['hades', 'portal 2'],
    wake: async (d) => log.wake.push(d.mac),
    forward: async (d, action, game) => (log.forward.push([d.agent, action, game]), `sent ${action}`),
    ping: async (d) => d.agent.endsWith('1:8790'),
  })
  const url = `http://127.0.0.1:${s.port}`
  const post = (path, body, token) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) })
  const token = async () => (await (await post('/login', { password: PASSWORD })).json()).token
  return { ...s, url, post, token, log }
}

test('the hub needs a password, and lists devices with awake status and the games', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  assert.equal((await h.post('/api/devices')).status, 401)
  assert.equal((await h.post('/login', { password: 'nope' })).status, 401)
  const r = await h.post('/api/devices', {}, await h.token())
  const body = await r.json()
  assert.deepEqual(body.games, ['hades', 'portal 2'])
  const byName = Object.fromEntries(body.devices.map((d) => [d.name, d]))
  assert.deepEqual(byName['laptop-a'], { name: 'laptop-a', canWake: true, canControl: true, awake: true })
  assert.equal(byName['laptop-b'].awake, false)
  assert.deepEqual(byName['wake-only'], { name: 'wake-only', canWake: true, canControl: false, awake: null })
  assert.equal(byName['agent-only'].canWake, false)
})

test('wake sends the wake-up signal from the hub; the other buttons go to that laptop\'s agent', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const token = await h.token()
  assert.match((await (await h.post('/api/do', { device: 'laptop-b', action: 'wake' }, token)).json()).message, /Wake-up signal sent/)
  await h.post('/api/do', { device: 'laptop-a', action: 'steam_game', game: 'hades' }, token)
  await h.post('/api/do', { device: 'laptop-b', action: 'sleep' }, token)
  assert.deepEqual(h.log.wake, ['AA:BB:CC:DD:EE:02'])
  assert.deepEqual(h.log.forward, [['http://100.1.1.1:8790', 'steam_game', 'hades'], ['http://100.1.1.2:8790', 'sleep', undefined]])
})

test('unknown devices and actions, and missing wake or agent addresses, are refused before anything is sent', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const token = await h.token()
  const status = async (body) => (await h.post('/api/do', body, token)).status
  assert.equal(await status({ device: 'nope', action: 'wake' }), 400)
  assert.equal(await status({ device: 'AA:BB:CC:DD:EE:01', action: 'wake' }), 400)
  assert.equal(await status({ device: 'laptop-a', action: 'shell' }), 400)
  assert.equal(await status({ device: 'agent-only', action: 'wake' }), 400)
  assert.equal(await status({ device: 'wake-only', action: 'lock' }), 400)
  assert.deepEqual(h.log, { wake: [], forward: [] })
  assert.equal((await h.post('/api/do', { device: 'laptop-a', action: 'lock' })).status, 401)
})

test('the hub page is served with a strict policy and builds its buttons without innerHTML or inline styles', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const r = await fetch(h.url + '/')
  const html = await r.text()
  const csp = r.headers.get('content-security-policy')
  assert.match(csp, /default-src 'none'/)
  assert.ok(html.includes(`nonce="${/nonce-([^']+)'/.exec(csp)[1]}"`))
  assert.doesNotMatch(html, /innerHTML|eval\(|style="/)
  assert.equal(r.headers.get('access-control-allow-origin'), null)
})

test('five wrong passwords lock the hub out', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  for (let i = 0; i < 5; i++) await h.post('/login', { password: 'wrong' })
  assert.equal((await h.post('/login', { password: PASSWORD })).status, 429)
})

test('with info, the hub shows each laptop\'s own games and buttons, and awake means it answered', async (t) => {
  const s = await startHub({
    password: PASSWORD,
    port: 0,
    host: '127.0.0.1',
    getDevices: () => DEVICES,
    getGames: () => ['hub-game'],
    wake: async () => {},
    forward: async () => 'ok',
    ping: async () => false,
    info: async (d) => (d.agent.endsWith('1:8790') ? { games: ['hades'], buttons: ['tests'] } : null),
  })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const login = await (await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  const body = await (await fetch(url + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: '{}' })).json()
  const byName = Object.fromEntries(body.devices.map((d) => [d.name, d]))
  assert.deepEqual(byName['laptop-a'], { name: 'laptop-a', canWake: true, canControl: true, awake: true, games: ['hades'], buttons: ['tests'] })
  assert.deepEqual(byName['laptop-b'], { name: 'laptop-b', canWake: true, canControl: true, awake: false })
  assert.deepEqual(byName['wake-only'], { name: 'wake-only', canWake: true, canControl: false, awake: null })
})

test('the hub passes the name as an argument and trims it', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const token = await h.token()
  await h.post('/api/do', { device: 'laptop-a', action: 'button', arg: 'x'.repeat(200) }, token)
  await h.post('/api/do', { device: 'laptop-a', action: 'app', arg: 'discord' }, token)
  assert.equal(h.log.forward[0][2].length, 60)
  assert.deepEqual(h.log.forward[1], ['http://100.1.1.1:8790', 'app', 'discord'])
})

test('the hub passes the laptop model, the Steam user and a theme override to the page', async (t) => {
  const s = await startHub({
    password: PASSWORD, port: 0, host: '127.0.0.1',
    getDevices: () => ({ a: { mac: '', agent: 'http://100.1.1.1:8790', theme: 'tuf' }, b: { mac: '', agent: 'http://100.1.1.2:8790' } }),
    getGames: () => [], wake: async () => {}, forward: async () => 'ok', ping: async () => true,
    info: async (d) => ({ games: [], buttons: [], model: d.agent.endsWith('1:8790') ? '' : 'ROG Strix', steam: d.agent.endsWith('1:8790') ? null : { user: 'Someone', playing: '' } }),
  })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const login = await (await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  const body = await (await fetch(url + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: '{}' })).json()
  const byName = Object.fromEntries(body.devices.map((d) => [d.name, d]))
  assert.equal(byName.a.theme, 'tuf')
  assert.equal(byName.a.model, undefined)
  assert.equal(byName.b.model, 'ROG Strix')
  assert.deepEqual(byName.b.steam, { user: 'Someone', playing: '' })
})
