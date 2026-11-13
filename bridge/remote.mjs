/**
 * Phone remote buttons. No AI anywhere in this file: fixed buttons, fixed actions.
 *
 *   agent  runs on each laptop. Does a handful of allow-listed things (open Steam,
 *          start a game from your list, lock, sleep) when asked with a shared token.
 *   hub    serves the phone page. Wakes a device by sending Wake-on-LAN from where the
 *          hub runs, and passes the other buttons to that laptop's agent.
 *
 * Both only answer private networks (home Wi-Fi, Tailscale). The page needs a
 * password, and the hub talks to agents with a long shared token.
 */

import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createPhoneAuth, isPrivateAddress } from './phone.mjs'

/** What an agent will do. Anything else is refused. */
export const AGENT_ACTIONS = new Set(['steam_open', 'steam_bigpicture', 'steam_game', 'lock', 'sleep'])
export const HUB_ACTIONS = new Set(['wake', ...AGENT_ACTIONS])

const MAX_BODY = 1024
const digest = (s) => createHash('sha256').update(String(s)).digest()
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b))

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

const json = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(obj))
}

const listen = (server, port, host) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

// -- agent ------------------------------------------------------------------------

/** `run(action, { game })` does the action and returns a short message. */
export async function startAgent({ token, port = 8790, host = '0.0.0.0', run, allowPublic = false }) {
  const server = createServer(async (req, res) => {
    if (!allowPublic && !isPrivateAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'Private networks only.' })
    // The token is checked before anything else, including the body.
    if (!sameSecret(req.headers['x-agent-token'] ?? '', token)) return json(res, 401, { error: 'Not allowed.' })
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && path === '/agent/ping') return json(res, 200, { ok: true })
      if (req.method === 'POST' && path === '/agent/do') {
        const { action, game } = await readJson(req)
        if (!AGENT_ACTIONS.has(action)) return json(res, 400, { error: 'Unknown action.' })
        const name = typeof game === 'string' ? game.slice(0, 60) : undefined
        try {
          return json(res, 200, { ok: true, message: (await run(action, { game: name })) ?? 'Done.' })
        } catch (err) {
          return json(res, 502, { error: String(err?.message ?? err).slice(0, 160) })
        }
      }
      return json(res, 404, { error: 'Not found.' })
    } catch (err) {
      return json(res, err?.status ?? 500, { error: err?.status ? err.message : 'Something went wrong.' })
    }
  })
  await listen(server, port, host)
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }
}

/** Talks to a laptop's agent over HTTP. */
export const httpForward = (token) => async (device, action, game) => {
  const res = await fetch(`${device.agent}/agent/do`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': token },
    body: JSON.stringify({ action, game }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `The laptop answered ${res.status}.`)
  return body.message ?? 'Done.'
}

export const httpPing = (token) => async (device) => {
  try {
    const res = await fetch(`${device.agent}/agent/ping`, { headers: { 'x-agent-token': token }, signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

// -- hub --------------------------------------------------------------------------

function page(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark">
<title>Remote</title>
<style nonce="${nonce}">
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:#020a12;color:#bfefff;font:16px/1.4 system-ui,sans-serif}
header{padding:14px 16px;letter-spacing:.3em;font-size:.8rem;color:#4fd0e6;border-bottom:1px solid #0c2a38}
main{padding:14px;display:flex;flex-direction:column;gap:14px;max-width:560px;margin:auto}
.card{border:1px solid #0c2a38;background:#07161f;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px}
.top{display:flex;align-items:center;gap:8px;font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;background:#3a4b55}
.on .dot{background:#38d27a}
.row{display:flex;gap:8px;flex-wrap:wrap}
button,select,input{font:inherit;color:inherit;border:1px solid #1d5a70;background:#0b3446;border-radius:10px;padding:12px 14px}
select{background:#041420;flex:1;min-width:0}
button:disabled{opacity:.4}
.msg{min-height:1.4em;color:#9be3a8;font-size:.9rem}
.err{color:#ffb4a8}
#login{margin:20vh auto 0;width:min(360px,90vw);display:flex;flex-direction:column;gap:12px}
[hidden]{display:none!important}
</style></head><body>
<header>REMOTE</header>
<form id="login" autocomplete="off"><label for="pw">Password</label>
<input id="pw" type="password" autocomplete="current-password" required><button>Unlock</button><div id="lerr" class="err"></div></form>
<main id="app" hidden><div id="msg" class="msg"></div><div id="list"></div></main>
<script nonce="${nonce}">
const $=id=>document.getElementById(id)
let token='',timer=0
try{token=sessionStorage.getItem('t')||''}catch(e){}
async function api(path,body){
  const h={'content-type':'application/json'};if(token)h.authorization='Bearer '+token
  const r=await fetch(path,{method:'POST',headers:h,body:JSON.stringify(body||{})})
  const j=await r.json().catch(()=>({}))
  if(!r.ok){const e=new Error(j.error||'Something went wrong');e.status=r.status;throw e}
  return j
}
function say(t,bad){const m=$('msg');m.textContent=t;m.className='msg'+(bad?' err':'')}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
async function act(device,action,game){
  say('Sending…')
  try{const j=await api('/api/do',{device,action,game});say(j.message||'Done.')}
  catch(err){if(err.status===401){token='';show()}say(err.message,true)}
  setTimeout(refresh,4000)
}
function btn(label,fn,disabled,sure){const b=el('button','',label);b.disabled=!!disabled;b.addEventListener('click',()=>{if(sure&&!confirm(sure))return;fn()});return b}
function draw(data){
  const list=$('list');list.textContent=''
  for(const d of data.devices){
    const card=el('div','card'+(d.awake?' on':''))
    const top=el('div','top');top.append(el('span','dot'),el('span','',d.name),el('span','',d.awake?'awake':(d.canControl?'asleep or off':'')))
    const r1=el('div','row');r1.append(
      btn('Wake',()=>act(d.name,'wake'),!d.canWake),
      btn('Steam',()=>act(d.name,'steam_open'),!d.canControl),
      btn('Big Picture',()=>act(d.name,'steam_bigpicture'),!d.canControl))
    const r2=el('div','row');const sel=el('select');for(const g of data.games){const o=el('option','',g);o.value=g;sel.append(o)}
    r2.append(sel,btn('Start game',()=>act(d.name,'steam_game',sel.value),!d.canControl||!data.games.length))
    const r3=el('div','row');r3.append(
      btn('Lock',()=>act(d.name,'lock'),!d.canControl,'Lock '+d.name+'?'),
      btn('Sleep',()=>act(d.name,'sleep'),!d.canControl,'Put '+d.name+' to sleep?'))
    card.append(top,r1,r2,r3);list.append(card)
  }
}
async function refresh(){
  if(!token)return
  try{draw(await api('/api/devices'))}catch(err){if(err.status===401){token='';show()}}
}
function show(){$('login').hidden=!!token;$('app').hidden=!token;clearInterval(timer);if(token){refresh();timer=setInterval(refresh,10000)}}
$('login').addEventListener('submit',async e=>{
  e.preventDefault();$('lerr').textContent=''
  try{const j=await api('/login',{password:$('pw').value});token=j.token;try{sessionStorage.setItem('t',token)}catch(x){};$('pw').value='';show()}
  catch(err){$('lerr').textContent=err.message}
})
show()
</script></body></html>`
}

/**
 * getDevices() returns { name: { mac, broadcast, agent } }, getGames() returns game names.
 * wake(device), forward(device, action, game) and ping(device) do the real work.
 */
export async function startHub({ password, port = 8791, host = '0.0.0.0', getDevices, getGames, wake, forward, ping, allowPublic = false, now = Date.now }) {
  const auth = createPhoneAuth({ password, now })

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress
    if (!allowPublic && !isPrivateAddress(ip)) return json(res, 403, { error: 'Private networks only.' })
    try {
      const path = (req.url ?? '/').split('?')[0]

      if (req.method === 'GET' && path === '/') {
        const nonce = randomBytes(16).toString('base64')
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
          'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        })
        return res.end(page(nonce))
      }

      if (req.method === 'POST' && path === '/login') {
        const body = await readJson(req)
        const r = auth.login(ip, body.password)
        return r.token ? json(res, 200, { token: r.token }) : json(res, r.status, { error: r.error })
      }

      if (req.method === 'POST' && (path === '/api/devices' || path === '/api/do')) {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        const devices = getDevices()

        if (path === '/api/devices') {
          const list = await Promise.all(
            Object.entries(devices).map(async ([name, d]) => ({
              name,
              canWake: Boolean(d.mac),
              canControl: Boolean(d.agent),
              awake: d.agent ? await ping(d) : null,
            })),
          )
          return json(res, 200, { devices: list, games: getGames() })
        }

        const { device: name, action, game } = await readJson(req)
        const device = devices[String(name ?? '').toLowerCase()]
        if (!device) return json(res, 400, { error: 'Unknown device.' })
        if (!HUB_ACTIONS.has(action)) return json(res, 400, { error: 'Unknown action.' })
        try {
          if (action === 'wake') {
            if (!device.mac) return json(res, 400, { error: 'This device has no wake-up address.' })
            await wake(device)
            return json(res, 200, { message: 'Wake-up signal sent. Give it up to 30 seconds.' })
          }
          if (!device.agent) return json(res, 400, { error: 'This device has no agent address.' })
          return json(res, 200, { message: await forward(device, action, typeof game === 'string' ? game : undefined) })
        } catch (err) {
          return json(res, 502, { error: String(err?.message ?? err).slice(0, 160) })
        }
      }

      return json(res, 404, { error: 'Not found.' })
    } catch (err) {
      return json(res, err?.status ?? 500, { error: err?.status ? err.message : 'Something went wrong.' })
    }
  })
  await listen(server, port, host)
  return { server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }
}
