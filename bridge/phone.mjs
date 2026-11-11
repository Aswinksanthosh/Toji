/**
 * A small password-protected page you can open from a phone on the same Wi-Fi.
 *
 * It is its own little server, on its own port, so the main Jarvis connection
 * stays reachable from this laptop only. This one serves a page and two
 * endpoints, and nothing else:
 *
 *   GET  /       the page
 *   POST /login  { password }  ->  { token }
 *   POST /ask    { text }      ->  { answer }       (needs the token)
 *
 * Safety: a password (compared in constant time), a lockout after repeated
 * wrong guesses, tokens that expire, and a refusal of any client that is not on
 * a private network. Requests carry the token in a header, never a cookie, so
 * other websites cannot make your browser send one. Answers are always shown as
 * plain text. Traffic on home Wi-Fi is not encrypted, so use a password you
 * use nowhere else and do not use this on a network you do not trust.
 */

import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_LIFETIME_MS = 12 * 60 * 60 * 1000
const MAX_TOKENS = 20
const MAX_BODY = 4096
const MAX_QUESTION = 1000
const MAX_FAILS = 5
const FAIL_WINDOW_MS = 10 * 60 * 1000
const LOCKOUT_MS = 5 * 60 * 1000

/** Home and private networks only (plus Tailscale's 100.64.0.0/10). */
export function isPrivateAddress(addr) {
  let a = String(addr ?? '').toLowerCase()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  if (a === '::1') return true
  if (/^fe[89ab][0-9a-f]:/.test(a)) return true
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a)
  if (!m) return false
  const x = Number(m[1])
  const y = Number(m[2])
  return (
    x === 10 ||
    x === 127 ||
    (x === 192 && y === 168) ||
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 169 && y === 254) ||
    (x === 100 && y >= 64 && y <= 127)
  )
}

const digest = (s) => createHash('sha256').update(String(s)).digest()
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b))

export function createPhoneAuth({ password, now = Date.now }) {
  const tokens = new Map() // token -> expires
  const fails = new Map() // ip -> { count, first, lockedUntil }

  return {
    /** Returns { token } or { error, status }. */
    login(ip, given) {
      const t = now()
      const f = fails.get(ip)
      if (f?.lockedUntil > t) return { error: 'Too many wrong tries. Wait a few minutes.', status: 429 }
      if (!sameSecret(given ?? '', password)) {
        const rec = f && t - f.first < FAIL_WINDOW_MS ? f : { count: 0, first: t, lockedUntil: 0 }
        rec.count++
        if (rec.count >= MAX_FAILS) rec.lockedUntil = t + LOCKOUT_MS
        fails.set(ip, rec)
        return { error: 'Wrong password.', status: 401 }
      }
      fails.delete(ip)
      for (const [k, exp] of tokens) if (exp <= t) tokens.delete(k)
      while (tokens.size >= MAX_TOKENS) tokens.delete(tokens.keys().next().value)
      const token = randomBytes(24).toString('base64url')
      tokens.set(token, t + TOKEN_LIFETIME_MS)
      return { token }
    },
    valid(token) {
      const exp = tokens.get(String(token ?? ''))
      if (!exp) return false
      if (exp <= now()) {
        tokens.delete(token)
        return false
      }
      return true
    },
  }
}

function page(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark">
<title>Jarvis</title>
<style nonce="${nonce}">
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:#020a12;color:#bfefff;font:16px/1.45 system-ui,sans-serif;display:flex;flex-direction:column}
header{padding:14px 16px;letter-spacing:.3em;font-size:.8rem;color:#4fd0e6;border-bottom:1px solid #0c2a38}
main{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:88%;padding:10px 13px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.me{align-self:flex-end;background:#0b3446}
.bot{align-self:flex-start;background:#07161f;border:1px solid #0c2a38}
.err{color:#ffb4a8}
form{display:flex;gap:8px;padding:12px;border-top:1px solid #0c2a38;background:#020a12}
input,textarea{flex:1;min-width:0;padding:12px;border-radius:10px;border:1px solid #1d5a70;background:#041420;color:inherit;font:inherit}
button{padding:0 18px;border-radius:10px;border:1px solid #1d5a70;background:#0b3446;color:#bfefff;font:inherit}
button:disabled{opacity:.5}
#login{margin:auto;width:min(360px,90vw);display:flex;flex-direction:column;gap:12px;padding:16px}
#login button{padding:12px}
#chat{display:contents}
[hidden]{display:none!important}
</style></head><body>
<header>J.A.R.V.I.S.</header>
<form id="login" autocomplete="off"><label for="pw">Password</label>
<input id="pw" type="password" autocomplete="current-password" required>
<button>Unlock</button><div id="lerr" class="err"></div></form>
<div id="chat" hidden>
<main id="log"></main>
<form id="ask"><input id="q" maxlength="${MAX_QUESTION}" placeholder="Ask Jarvis…" autocomplete="off" required><button id="go">Send</button></form>
</div>
<script nonce="${nonce}">
const $=id=>document.getElementById(id)
let token=''
try{token=sessionStorage.getItem('t')||''}catch(e){}
function show(){$('login').hidden=!!token;$('chat').hidden=!token}
async function api(path,body){
  const h={'content-type':'application/json'}
  if(token)h.authorization='Bearer '+token
  const r=await fetch(path,{method:'POST',headers:h,body:JSON.stringify(body)})
  const j=await r.json().catch(()=>({}))
  if(!r.ok){const e=new Error(j.error||'Something went wrong');e.status=r.status;throw e}
  return j
}
function bubble(text,cls){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;$('log').append(d);d.scrollIntoView({block:'end'});return d}
$('login').addEventListener('submit',async e=>{
  e.preventDefault();$('lerr').textContent=''
  try{const j=await api('/login',{password:$('pw').value});token=j.token;try{sessionStorage.setItem('t',token)}catch(x){};$('pw').value='';show();$('q').focus()}
  catch(err){$('lerr').textContent=err.message}
})
$('ask').addEventListener('submit',async e=>{
  e.preventDefault();const text=$('q').value.trim();if(!text)return
  $('q').value='';$('go').disabled=true
  bubble(text,'me');const wait=bubble('…','bot')
  try{const j=await api('/ask',{text});wait.textContent=j.answer||'(no answer)'}
  catch(err){
    if(err.status===401){token='';try{sessionStorage.removeItem('t')}catch(x){};show()}
    wait.textContent=err.message;wait.classList.add('err')
  }
  $('go').disabled=false;$('q').focus()
})
show()
</script></body></html>`
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Too large.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(Object.assign(new Error('Bad request.'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Starts the phone page. `ask(text)` returns the answer as a string.
 * Resolves to { server, port, close }.
 */
export async function startPhoneServer({
  password,
  port = 8788,
  host = '0.0.0.0',
  ask,
  allowPublic = false,
  now = Date.now,
}) {
  const auth = createPhoneAuth({ password, now })
  let busy = false

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    })
    res.end(body)
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' })

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress
    if (!allowPublic && !isPrivateAddress(ip)) return json(res, 403, { error: 'Home network only.' })

    try {
      const path = (req.url ?? '/').split('?')[0]

      if (req.method === 'GET' && path === '/') {
        const nonce = randomBytes(16).toString('base64')
        return send(res, 200, page(nonce), {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          'x-frame-options': 'DENY',
        })
      }

      if (req.method === 'POST' && path === '/login') {
        const body = await readJson(req)
        const r = auth.login(ip, body.password)
        return r.token ? json(res, 200, { token: r.token }) : json(res, r.status, { error: r.error })
      }

      if (req.method === 'POST' && path === '/ask') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        const body = await readJson(req)
        const text = String(body.text ?? '').trim().slice(0, MAX_QUESTION)
        if (!text) return json(res, 400, { error: 'Type a question first.' })
        if (busy) return json(res, 409, { error: 'Still working on the last question.' })
        busy = true
        try {
          return json(res, 200, { answer: await ask(text) })
        } catch (err) {
          return json(res, 502, { error: String(err?.message ?? err).slice(0, 200) })
        } finally {
          busy = false
        }
      }

      return json(res, 404, { error: 'Not found.' })
    } catch (err) {
      return json(res, err?.status ?? 500, { error: err?.status ? err.message : 'Something went wrong.' })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }
}
