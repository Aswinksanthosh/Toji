// The Wi-Fi phone page: who gets in, what it will and won't do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPhoneAuth, isPrivateAddress, startPhoneServer } from '../bridge/phone.mjs'

const PASSWORD = 'correct horse battery'

async function boot(ask = async (t) => `echo: ${t}`) {
  const s = await startPhoneServer({ password: PASSWORD, port: 0, host: '127.0.0.1', ask })
  const url = `http://127.0.0.1:${s.port}`
  const post = (path, body, headers = {}) =>
    fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const login = async () => (await (await post('/login', { password: PASSWORD })).json()).token
  return { ...s, url, post, login }
}

test('only private networks are allowed in', () => {
  for (const ok of ['192.168.1.20', '10.0.0.5', '172.16.4.1', '172.31.255.1', '127.0.0.1', '::1', '::ffff:192.168.0.9', 'fe80::1', 'fd12::1', '100.101.102.103']) {
    assert.equal(isPrivateAddress(ok), true, ok)
  }
  for (const bad of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '100.63.0.1', '2001:db8::1', '', undefined, 'not an ip']) {
    assert.equal(isPrivateAddress(bad), false, String(bad))
  }
})

test('the page is served with a strict policy, a fresh nonce, no inline styles and no HTML injection', async (t) => {
  const s = await boot()
  t.after(() => s.close())
  const a = await fetch(s.url + '/')
  const b = await fetch(s.url + '/')
  const html = await a.text()
  const csp = a.headers.get('content-security-policy')
  const nonce = /nonce-([^']+)'/.exec(csp)[1]
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.ok(html.includes(`nonce="${nonce}"`))
  assert.notEqual(nonce, /nonce-([^']+)'/.exec(b.headers.get('content-security-policy'))[1])
  assert.equal(a.headers.get('access-control-allow-origin'), null)
  assert.equal(a.headers.get('cache-control'), 'no-store')
  assert.doesNotMatch(html, /style="/)
  assert.doesNotMatch(html, /innerHTML|eval\(|document\.write/)
})

test('login: wrong password refused, right password gives a token that works', async (t) => {
  const s = await boot()
  t.after(() => s.close())
  assert.equal((await s.post('/login', { password: 'nope' })).status, 401)
  assert.equal((await s.post('/login', {})).status, 401)
  const token = await s.login()
  assert.ok(token && token.length > 20)
  const r = await s.post('/ask', { text: 'hello' }, { authorization: `Bearer ${token}` })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { answer: 'echo: hello' })
})

test('asking without a token, or with a made-up one, is refused and never reaches the brain', async (t) => {
  let asked = 0
  const s = await boot(async () => (asked++, 'secret'))
  t.after(() => s.close())
  assert.equal((await s.post('/ask', { text: 'hi' })).status, 401)
  assert.equal((await s.post('/ask', { text: 'hi' }, { authorization: 'Bearer abc' })).status, 401)
  assert.equal((await s.post('/ask', { text: 'hi' }, { authorization: 'Basic abc' })).status, 401)
  assert.equal(asked, 0)
})

test('five wrong passwords lock the door, even for the right password, until the wait is over', () => {
  let t = 1_000_000
  const auth = createPhoneAuth({ password: PASSWORD, now: () => t })
  for (let i = 0; i < 5; i++) assert.equal(auth.login('1.2.3.4', 'wrong').status, 401)
  assert.equal(auth.login('1.2.3.4', PASSWORD).status, 429)
  assert.ok(auth.login('5.6.7.8', PASSWORD).token, 'another device is not locked out')
  t += 6 * 60_000
  assert.ok(auth.login('1.2.3.4', PASSWORD).token)
})

test('tokens expire after twelve hours', () => {
  let t = 0
  const auth = createPhoneAuth({ password: PASSWORD, now: () => t })
  const { token } = auth.login('ip', PASSWORD)
  assert.equal(auth.valid(token), true)
  t += 13 * 3600_000
  assert.equal(auth.valid(token), false)
})

test('empty questions, oversized bodies and a second question while busy are handled', async (t) => {
  let release
  const gate = new Promise((r) => (release = r))
  const s = await boot(async () => (await gate, 'done'))
  t.after(() => s.close())
  const h = { authorization: `Bearer ${await s.login()}` }
  assert.equal((await s.post('/ask', { text: '   ' }, h)).status, 400)
  assert.equal((await s.post('/ask', { text: 'x'.repeat(10_000) }, h).catch(() => ({ status: 413 }))).status, 413)
  const first = s.post('/ask', { text: 'one' }, h)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal((await s.post('/ask', { text: 'two' }, h)).status, 409)
  release()
  assert.equal((await first).status, 200)
})

test('a failing brain returns a short error, not a crash', async (t) => {
  const s = await boot(async () => { throw new Error('The model is not running.') })
  t.after(() => s.close())
  const r = await s.post('/ask', { text: 'hi' }, { authorization: `Bearer ${await s.login()}` })
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /not running/)
})

test('unknown paths and cross-origin preflights get nothing useful', async (t) => {
  const s = await boot()
  t.after(() => s.close())
  assert.equal((await fetch(s.url + '/file?path=/etc/passwd')).status, 404)
  const pre = await fetch(s.url + '/ask', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } })
  assert.equal(pre.status, 404)
  assert.equal(pre.headers.get('access-control-allow-origin'), null)
})
