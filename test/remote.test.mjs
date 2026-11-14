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
  assert.deepEqual(byName['laptop-a'], { name: 'laptop-a', canWake: true, canControl: true, awake: true, games: ['hades'], buttons: ['tests'], governor: false })
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

test('background pictures: only after unlocking, only for rog or tuf, and the policy allows nothing beyond blob: images', async (t) => {
  const asked = []
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const s = await startHub({
    password: PASSWORD, port: 0, host: '127.0.0.1',
    getDevices: () => DEVICES, getGames: () => [], wake: async () => {}, forward: async () => 'ok', ping: async () => true,
    getArt: async (theme) => (asked.push(theme), theme === 'rog' ? { type: 'image/png', bytes: png } : null),
  })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const post = (body, token) => fetch(url + '/api/art', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const login = await (await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  assert.equal((await post({ theme: 'rog' })).status, 401)
  assert.deepEqual(asked, [])
  const ok = await post({ theme: 'rog' }, login.token)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png)
  assert.equal((await post({ theme: 'tuf' }, login.token)).status, 204)
  for (const bad of ['../../etc/passwd', 'rog/../x', '', 5, null, { a: 1 }]) assert.equal((await post({ theme: bad }, login.token)).status, 204, String(bad))
  assert.deepEqual(asked, ['rog', 'tuf'])
  const csp = (await fetch(url + '/')).headers.get('content-security-policy')
  assert.match(csp, /img-src blob:;/)
  assert.doesNotMatch(csp, /img-src[^;]*(https?:|data:|\*|'self')/)
})

test('the page has the switch bar, both characters and moving backgrounds, and respects reduced motion', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const html = await (await fetch(h.url + '/')).text()
  for (const part of ['class="art rog"', 'class="art tuf"', 'id="tabs"', 'class="fx rog"', 'class="fx tuf"', 'prefers-reduced-motion']) assert.ok(html.includes(part), part)
  assert.doesNotMatch(html, /innerHTML|eval\(|style="|<img|http:\/\/|https:\/\//)
})

test('the Steam profile picture goes through the hub only after unlocking, only for a laptop with an agent, and only as an image', async (t) => {
  const asked = []
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const s = await startHub({
    password: PASSWORD, port: 0, host: '127.0.0.1',
    getDevices: () => DEVICES, getGames: () => [], wake: async () => {}, forward: async () => 'ok', ping: async () => true,
    getAvatar: async (d) => (asked.push(d.agent), d.agent.endsWith('1:8790') ? { type: 'image/png', bytes: png } : null),
  })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const post = (body, token) => fetch(url + '/api/avatar', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const login = await (await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  assert.equal((await post({ device: 'laptop-a' })).status, 401)
  assert.deepEqual(asked, [])
  const ok = await post({ device: 'LAPTOP-A' }, login.token)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), png)
  assert.equal((await post({ device: 'laptop-b' }, login.token)).status, 204)
  assert.equal((await post({ device: 'wake-only' }, login.token)).status, 204)
  assert.equal((await post({ device: 'nobody' }, login.token)).status, 204)
  assert.equal((await post({}, login.token)).status, 204)
  assert.deepEqual(asked, ['http://100.1.1.1:8790', 'http://100.1.1.2:8790'])
})

test('the agent serves the Steam picture only with the token, and the hub side accepts only small png, jpeg or webp', async (t) => {
  const { httpAvatar } = await import('../bridge/remote.mjs')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  let pic = { type: 'image/png', bytes: png }
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async () => 'ok', avatar: async () => pic })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  assert.equal((await fetch(url + '/agent/avatar')).status, 401)
  assert.equal((await fetch(url + '/agent/avatar', { headers: { 'x-agent-token': TOKEN } })).status, 200)
  const get = httpAvatar(TOKEN)
  assert.deepEqual((await get({ agent: url })).bytes, png)
  pic = { type: 'image/svg+xml', bytes: Buffer.from('<svg onload=alert(1)>') }
  assert.equal(await get({ agent: url }), null)
  pic = { type: 'text/html', bytes: Buffer.from('<script>') }
  assert.equal(await get({ agent: url }), null)
  pic = { type: 'image/png', bytes: Buffer.alloc(2 * 1024 * 1024) }
  assert.equal(await get({ agent: url }), null)
  pic = null
  assert.equal(await get({ agent: url }), null)
  assert.equal(await httpAvatar('wrong-token-wrong-token-1234')({ agent: url }), null)
})

test('mode, cap and governor reach the page, and odd values from an agent are cleaned', async (t) => {
  const { httpInfo } = await import('../bridge/remote.mjs')
  const body = { ok: true, games: ['pubg'], buttons: [], model: 'ROG', steam: { user: 'A', playing: '', avatar: true }, mode: 'gaming', cap: { on: true, target: 999 }, governor: true }
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async () => 'ok', info: () => body })
  t.after(() => s.close())
  const got = await httpInfo(TOKEN)({ agent: `http://127.0.0.1:${s.port}` })
  assert.equal(got.mode, 'gaming')
  assert.deepEqual(got.cap, { on: true, target: 85 })
  assert.equal(got.governor, true)
  assert.equal(got.steam.avatar, true)
  Object.assign(body, { mode: 'turbo; calc', cap: 'x', governor: 'yes', steam: { user: 'B', avatar: 'true' } })
  const odd = await httpInfo(TOKEN)({ agent: `http://127.0.0.1:${s.port}` })
  assert.equal(odd.mode, '')
  assert.equal(odd.cap, null)
  assert.equal(odd.governor, false)
  assert.equal(odd.steam.avatar, false)
})

test('the agent serves a game picture only with the token, and the hub asks for it only after unlocking', async (t) => {
  const { httpGameArt } = await import('../bridge/remote.mjs')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const asked = []
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async () => 'ok', gameArt: async (name) => (asked.push(name), name === 'pubg' ? { type: 'image/png', bytes: png } : null) })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  assert.equal((await fetch(url + '/agent/gameart?name=pubg')).status, 401)
  assert.deepEqual(asked, [])
  const get = httpGameArt(TOKEN)
  assert.deepEqual((await get({ agent: url }, 'pubg')).bytes, png)
  assert.equal(await get({ agent: url }, 'cod'), null)
  assert.equal(await get({ agent: url }, '../../etc/passwd'), null)
  assert.deepEqual(asked, ['pubg', 'cod', '../../etc/passwd'])
  assert.equal(await httpGameArt('wrong-token-wrong-token-1234')({ agent: url }, 'pubg'), null)

  const hubAsked = []
  const h = await startHub({
    password: PASSWORD, port: 0, host: '127.0.0.1',
    getDevices: () => DEVICES, getGames: () => [], wake: async () => {}, forward: async () => 'ok', ping: async () => true,
    getGameArt: async (d, game) => (hubAsked.push([d.agent, game]), game === 'pubg' ? { type: 'image/png', bytes: png } : null),
  })
  t.after(() => h.close())
  const hurl = `http://127.0.0.1:${h.port}`
  const post = (body, token) => fetch(hurl + '/api/gameart', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const login = await (await fetch(hurl + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  assert.equal((await post({ device: 'laptop-a', game: 'pubg' })).status, 401)
  assert.deepEqual(hubAsked, [])
  const ok = await post({ device: 'laptop-a', game: 'pubg' }, login.token)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.equal((await post({ device: 'laptop-a', game: 'cod' }, login.token)).status, 204)
  assert.equal((await post({ device: 'wake-only', game: 'pubg' }, login.token)).status, 204)
  assert.equal((await post({ device: 'nobody', game: 'pubg' }, login.token)).status, 204)
  assert.equal((await post({ device: 'laptop-a', game: 5 }, login.token)).status, 204)
  assert.equal((await post({ device: 'laptop-a' }, login.token)).status, 204)
  assert.deepEqual(hubAsked.map((x) => x[1]), ['pubg', 'cod'])
})

test('the list of games that have a picture reaches the page cleaned up', async (t) => {
  const { httpInfo } = await import('../bridge/remote.mjs')
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async () => 'ok', info: () => ({ games: ['pubg'], gameArt: ['pubg', 5, 'x'.repeat(100)] }) })
  t.after(() => s.close())
  const got = await httpInfo(TOKEN)({ agent: `http://127.0.0.1:${s.port}` })
  assert.deepEqual(got.gameArt, ['pubg', 'x'.repeat(60)])
})

test('only a plain short commit id from an agent reaches the page as the version', async (t) => {
  const { httpInfo } = await import('../bridge/remote.mjs')
  const body = { ok: true, games: [], version: 'a1b2c3d' }
  const s = await startAgent({ token: TOKEN, port: 0, host: '127.0.0.1', run: async () => 'ok', info: () => body })
  t.after(() => s.close())
  const get = () => httpInfo(TOKEN)({ agent: `http://127.0.0.1:${s.port}` })
  assert.equal((await get()).version, 'a1b2c3d')
  body.version = '<script>alert(1)</script>'
  assert.equal((await get()).version, '')
  body.version = 5
  assert.equal((await get()).version, '')
})

function memoryStore() {
  const files = new Map()
  return {
    files,
    list: () => [...files.keys()],
    get: (name) => files.get(name) ?? null,
    put: (name, type, bytes) => files.set(name, { type, bytes }),
  }
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40)])

async function artHub(t, extra = {}) {
  const store = memoryStore()
  const asked = []
  const s = await startHub({
    password: PASSWORD, port: 0, host: '127.0.0.1',
    getDevices: () => DEVICES, getGames: () => ['pubg', 'Cod'], wake: async () => {}, forward: async () => 'ok', ping: async () => true,
    info: async (d) => (d.agent.endsWith('1:8790') ? { games: ['hades', 'portal 2'], buttons: [] } : null),
    getGameArt: async (d, g) => (asked.push([d.agent, g]), g === 'hades' ? { type: 'image/png', bytes: PNG } : null),
    artStore: store, ...extra,
  })
  t.after(() => s.close())
  const url = `http://127.0.0.1:${s.port}`
  const login = await (await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json()
  const upload = (game, body, token = login.token, type = 'image/jpeg') => fetch(`${url}/api/gameart/upload?game=${encodeURIComponent(game)}`, { method: 'POST', headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body })
  const art = (body) => fetch(url + '/api/gameart', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: JSON.stringify(body) })
  const devices = async () => (await fetch(url + '/api/devices', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: '{}' })).json()
  return { store, asked, url, login, upload, art, devices }
}

test('a picture chosen on the phone is saved on the hub, only after unlocking, only as a real picture, only for a known game, and only if small', async (t) => {
  const h = await artHub(t)
  assert.equal((await h.upload('pubg', PNG, '')).status, 401)
  assert.equal(h.store.files.size, 0)
  const ok = await h.upload('PUBG', PNG)
  assert.equal(ok.status, 200)
  assert.deepEqual(h.store.get('pubg'), { type: 'image/png', bytes: PNG })
  assert.equal((await h.upload('cod', JPG)).status, 200)
  assert.equal(h.store.get('cod').type, 'image/jpeg')
  assert.equal((await h.upload('cod', WEBP, undefined, 'text/html')).status, 200)
  assert.equal(h.store.get('cod').type, 'image/webp')
  // a laptop's own games are known once the page has listed them
  assert.equal((await h.upload('hades', PNG)).status, 400)
  await h.devices()
  assert.equal((await h.upload('hades', PNG)).status, 200)
  assert.equal((await h.upload('portal 2', PNG)).status, 200)
  const before = h.store.files.size
  for (const bad of ['nope', '../secret', 'pubg/../x', '', 'x'.repeat(80), 'a\u0000b']) assert.equal((await h.upload(bad, PNG)).status, 400, bad)
  assert.equal((await h.upload('pubg', Buffer.from('<svg onload=alert(1)>'))).status, 415)
  assert.equal((await h.upload('pubg', Buffer.from('<html><script>'), undefined, 'image/png')).status, 415)
  assert.equal((await h.upload('pubg', Buffer.alloc(0))).status, 415)
  const big = await h.upload('pubg', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])).catch(() => ({ status: 413 }))
  assert.equal(big.status, 413)
  assert.equal(h.store.files.size, before)
  assert.deepEqual(h.store.get('pubg'), { type: 'image/png', bytes: PNG })
})

test('pictures kept on the hub are served first and listed; a laptop\'s own picture is only the fallback', async (t) => {
  const h = await artHub(t)
  await h.upload('pubg', JPG)
  const mine = await h.art({ device: 'laptop-a', game: 'PUBG' })
  assert.equal(mine.status, 200)
  assert.equal(mine.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(h.asked, [])
  const own = await h.art({ device: 'laptop-a', game: 'hades' })
  assert.equal(own.status, 200)
  assert.deepEqual(h.asked, [['http://100.1.1.1:8790', 'hades']])
  assert.equal((await h.art({ device: 'laptop-a', game: 'nothing' })).status, 204)
  assert.equal((await h.art({ device: 'laptop-a', game: '../../etc/passwd' })).status, 204)
  assert.equal(h.asked.length, 2)
  assert.deepEqual((await h.devices()).art, ['pubg'])
})

test('a hub without a picture store says so instead of failing', async (t) => {
  const h = await artHub(t, { artStore: undefined })
  assert.equal((await h.upload('pubg', PNG)).status, 501)
  assert.deepEqual((await h.devices()).art, [])
})

test('the page has a file picker and tapping the banner opens it', async (t) => {
  const h = await hub()
  t.after(() => h.close())
  const html = await (await fetch(h.url + '/')).text()
  for (const part of ['id="pick"', 'accept="image/*"', '/api/gameart/upload', 'createImageBitmap', 'Change picture']) assert.ok(html.includes(part), part)
  assert.doesNotMatch(html, /innerHTML|eval\(|style="|onclick=|onchange=/)
})
