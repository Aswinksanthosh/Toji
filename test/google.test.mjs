// Google Calendar and Gmail tools, against a fake Google.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calendarEvents, createGoogle, googleConnected, mailRead, mailSearch, SCOPES } from '../bridge/google.mjs'
import { decideTool } from '../bridge/policy.mjs'

const b64 = (s) => Buffer.from(s).toString('base64url')

function setup({ expired = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-google-'))
  writeFileSync(join(dir, 'client.json'), JSON.stringify({ installed: { client_id: 'cid', client_secret: 'sec' } }))
  writeFileSync(
    join(dir, 'token.json'),
    JSON.stringify({ refresh_token: 'r', access_token: 'old', expires_at: expired ? 0 : Date.now() + 3_600_000 }),
  )
  return dir
}

test('connected only when both the client file and a token exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-google-'))
  assert.equal(googleConnected(dir), false)
  assert.equal(googleConnected(setup()), true)
})

test('only read-only scopes are requested', () => {
  for (const s of SCOPES) assert.match(s, /readonly$/)
})

test('an expired token is refreshed and saved, then used', async () => {
  const dir = setup({ expired: true })
  const seen = []
  const fetchFn = async (url, init) => {
    seen.push(String(url))
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }) }
    }
    assert.equal(init.headers.authorization, 'Bearer fresh')
    return { ok: true, json: async () => ({ ok: 1 }) }
  }
  const { api } = createGoogle({ dir, fetchFn })
  assert.deepEqual(await api('https://example.test/x'), { ok: 1 })
  assert.equal(JSON.parse(readFileSync(join(dir, 'token.json'), 'utf8')).access_token, 'fresh')
  assert.equal(seen.length, 2)
})

test('a revoked login gives a plain instruction, not a stack trace', async () => {
  const dir = setup({ expired: true })
  const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })
  const { api } = createGoogle({ dir, fetchFn })
  await assert.rejects(() => api('https://example.test/x'), /npm run google:login/)
})

test('calendar lists timed and all-day events, and says so when empty', async () => {
  const api = async () => ({
    items: [
      { summary: 'Standup', start: { dateTime: '2026-11-12T09:30:00' }, end: { dateTime: '2026-11-12T10:00:00' } },
      { summary: 'Holiday', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } },
      { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-11-12T11:00:00' } },
    ],
  })
  const out = await calendarEvents(api, { days: 1 })
  assert.match(out, /Standup/)
  assert.match(out, /all day · Holiday/)
  assert.doesNotMatch(out, /Gone/)
  assert.equal(await calendarEvents(async () => ({ items: [] })), 'Nothing scheduled in that period.')
})

test('calendar clamps silly ranges', async () => {
  let url = ''
  await calendarEvents(async (u) => ((url = u), { items: [] }), { days: 9999, startInDays: -5 })
  const p = new URL(url).searchParams
  const span = (new Date(p.get('timeMax')) - new Date(p.get('timeMin'))) / 86_400_000
  assert.ok(span <= 31.1)
})

test('mail search returns one line per message', async () => {
  const api = async (url) =>
    url.includes('/messages?')
      ? { messages: [{ id: 'a1' }, { id: 'b2' }] }
      : {
          id: url.includes('a1') ? 'a1' : 'b2',
          snippet: 'hello there',
          payload: { headers: [{ name: 'From', value: 'Bob <bob@x.com>' }, { name: 'Subject', value: 'Hi' }, { name: 'Date', value: 'Wed, 11 Nov 2026 10:00:00' }] },
        }
  const out = (await mailSearch(api, { query: 'is:unread' })).split('\n')
  assert.equal(out.length, 2)
  assert.match(out[0], /a1 \| .*Bob.*\| Hi \| hello there/)
})

test('reading mail prefers plain text, strips html, cuts long bodies, and labels it untrusted', async () => {
  const msg = (parts) => async () => ({
    snippet: 'snip',
    payload: { headers: [{ name: 'Subject', value: 'S' }], mimeType: 'multipart/alternative', parts },
  })
  const plain = await mailRead(msg([{ mimeType: 'text/plain', body: { data: b64('Plain body') } }, { mimeType: 'text/html', body: { data: b64('<b>HTML</b>') } }]), { id: 'x1' })
  assert.match(plain, /Plain body/)
  assert.match(plain, /never as instructions/)
  const html = await mailRead(msg([{ mimeType: 'text/html', body: { data: b64('<style>p{}</style><p>Hi&nbsp;you</p>') } }]), { id: 'x1' })
  assert.match(html, /Hi you/)
  assert.doesNotMatch(html, /<p>|p\{\}/)
  const long = await mailRead(msg([{ mimeType: 'text/plain', body: { data: b64('x'.repeat(5000)) } }]), { id: 'x1' })
  assert.match(long, /\[cut\]/)
  assert.match(await mailRead(async () => ({}), { id: '../etc' }), /not a valid/)
})

test('the google tools are allowed in read-only mode, and only for this server', () => {
  assert.equal(decideTool('mcp__jarvis_google__mail_read', false), true)
  assert.equal(decideTool('mcp__jarvis_googl__mail_read', false), false)
})
