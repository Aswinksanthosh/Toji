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
import { REMOTE_ACTIONS } from './remote-actions.mjs'

/** What an agent will do. Anything else is refused. */
export const AGENT_ACTIONS = new Set(REMOTE_ACTIONS)
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

/**
 * `run(action, { game, arg })` does the action and returns a short message (`game` and `arg`
 * are the same value: a game, app or button name). `info()` says which games and buttons
 * this laptop has, so the page can show them.
 */
export async function startAgent({ token, port = 8790, host = '0.0.0.0', run, info, allowPublic = false }) {
  const server = createServer(async (req, res) => {
    if (!allowPublic && !isPrivateAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'Private networks only.' })
    // The token is checked before anything else, including the body.
    if (!sameSecret(req.headers['x-agent-token'] ?? '', token)) return json(res, 401, { error: 'Not allowed.' })
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && path === '/agent/ping') return json(res, 200, { ok: true })
      if (req.method === 'GET' && path === '/agent/info') return json(res, 200, { ok: true, ...((await info?.()) ?? {}) })
      if (req.method === 'POST' && path === '/agent/do') {
        const { action, game, arg } = await readJson(req)
        if (!AGENT_ACTIONS.has(action)) return json(res, 400, { error: 'Unknown action.' })
        const given = typeof arg === 'string' ? arg : typeof game === 'string' ? game : undefined
        const name = given?.slice(0, 60)
        try {
          return json(res, 200, { ok: true, message: (await run(action, { game: name, arg: name })) ?? 'Done.' })
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
export const httpForward = (token) => async (device, action, arg) => {
  const res = await fetch(`${device.agent}/agent/do`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-token': token },
    body: JSON.stringify({ action, game: arg, arg }),
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

/** The games and buttons a laptop's agent reports, or null if it does not answer. */
export const httpInfo = (token) => async (device) => {
  try {
    const res = await fetch(`${device.agent}/agent/info`, { headers: { 'x-agent-token': token }, signal: AbortSignal.timeout(2500) })
    if (!res.ok) return null
    const body = await res.json()
    const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 60)).slice(0, 60) : [])
    const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n) : '')
    const steam = body.steam && typeof body.steam === 'object' ? { user: text(body.steam.user, 40), playing: text(body.steam.playing, 40) } : null
    return { games: names(body.games), buttons: names(body.buttons), model: text(body.model, 40), steam }
  } catch {
    return null
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
:root{--bg:#03070c;--card:#0a141c;--line:#14303d;--accent:#4fd0e6;--btn:#0b3446;--text:#c6f1ff}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,sans-serif}
header{padding:14px 16px;letter-spacing:.3em;font-size:.8rem;color:#4fd0e6;border-bottom:1px solid #0c2a38}
main{padding:14px;display:flex;flex-direction:column;gap:16px;max-width:560px;margin:auto}
.card{--accent:#4fd0e6;border:1px solid var(--line);border-left:4px solid var(--accent);background:linear-gradient(160deg,var(--card),#050a0f);border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:10px}
.card.rog{--accent:#ff2a3d;--card:#16090c;--line:#4a1019;--btn:#3a0d14;border-radius:0;clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px))}
.card.tuf{--accent:#ffb000;--card:#14100a;--line:#4d3a0b;--btn:#33260a}
.card.tuf::before{content:'';display:block;height:7px;margin:-12px -12px 0;background:repeating-linear-gradient(135deg,#ffb000 0 12px,#17130a 12px 24px)}
.top{display:flex;align-items:center;gap:8px;font-weight:700;font-size:1.05rem}
.badge{font-size:.7rem;letter-spacing:.2em;font-weight:800;padding:2px 8px;border:1px solid var(--accent);color:var(--accent)}
.state{margin-left:auto;font-weight:400;font-size:.85rem;color:#7fa1ad}
.model{margin-top:-6px;font-size:.8rem;color:#7fa1ad}
.dot{width:10px;height:10px;border-radius:50%;background:#3a4b55}
.on .dot{background:#38d27a;box-shadow:0 0 8px #38d27a}
.row{display:flex;gap:8px;flex-wrap:wrap}
button,select,input{font:inherit;color:inherit;border:1px solid var(--line);background:var(--btn);border-radius:8px;padding:12px 14px}
.rog button,.rog select{border-radius:0}
button:active{background:var(--accent);color:#000}
select{flex:1 1 100%;min-width:0}
button:disabled{opacity:.4}
.steam{background:linear-gradient(180deg,#1b2838,#141a22);border:1px solid #2a475e;border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:8px;color:#c7d5e0}
.rog .steam{border-radius:0}
.steam h3{margin:0;font-size:.72rem;letter-spacing:.25em;color:#66c0f4}
.who{font-weight:600;color:#fff}
.now{color:#a4d007;font-size:.85rem}
.unk{color:#8a9aa6;font-size:.85rem}
.steam button,.steam select{background:#2a475e;border-color:#3d6c8d;color:#c7d5e0}
.steam select{background:#101822}
.steam button.go{background:linear-gradient(#75b022,#588a1b);border-color:#75b022;color:#fff}
.steam button:active{background:#66c0f4;color:#000}
details.sec{border-top:1px solid var(--line);padding-top:6px}
summary{cursor:pointer;color:var(--accent);padding:6px 0;list-style:none;letter-spacing:.08em}
summary::-webkit-details-marker{display:none}
summary::before{content:'+ '}
details[open]>summary::before{content:'- '}
.msg{position:sticky;top:0;background:var(--bg);padding:6px 0;min-height:1.9em;color:#9be3a8;font-size:.9rem;z-index:1}
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
async function act(device,action,arg){
  say('Sending…')
  try{const j=await api('/api/do',{device,action,arg});say(j.message||'Done.')}
  catch(err){if(err.status===401){token='';show()}say(err.message,true)}
  setTimeout(refresh,4000)
}
function btn(label,fn,disabled,sure,cls){const b=el('button',cls||'',label);b.disabled=!!disabled;b.addEventListener('click',()=>{if(sure&&!confirm(sure))return;fn()});return b}
const opened=new Set(),picked={},seen={}
function section(key,title,kids){
  const d=el('details','sec');d.open=opened.has(key)
  d.addEventListener('toggle',()=>{if(d.open)opened.add(key);else opened.delete(key)})
  d.append(el('summary','',title));const r=el('div','row');r.append(...kids);d.append(r);return d
}
function themeOf(d){
  if(d.theme==='rog'||d.theme==='tuf')return d.theme
  const m=d.model||''
  return /ROG/i.test(m)?'rog':/TUF/i.test(m)?'tuf':''
}
function draw(data){
  const list=$('list');list.textContent=''
  for(const d of data.devices){
    if(d.model)seen[d.name]=d.model;else if(seen[d.name])d.model=seen[d.name]
    const n=d.name,c=!d.canControl,theme=themeOf(d)
    const go=(label,action,arg,sure,cls)=>btn(label,()=>act(n,action,arg),c,sure,cls)
    const card=el('div','card '+theme+(d.awake?' on':''))
    const top=el('div','top');top.append(el('span','dot'),el('span','',n))
    if(theme)top.append(el('span','badge',theme.toUpperCase()))
    top.append(el('span','state',d.awake?'awake':(d.canControl?'asleep or off':'')))
    card.append(top)
    if(d.model)card.append(el('div','model',d.model))
    const quick=el('div','row');quick.append(btn('Wake',()=>act(n,'wake'),!d.canWake),go('Lock','lock',undefined,'Lock '+n+'?'),go('Screen off','screen_off'))
    card.append(quick)
    const steam=el('div','steam');steam.append(el('h3','','STEAM'))
    if(d.steam&&d.steam.user)steam.append(el('div','who','Signed in as '+d.steam.user))
    else steam.append(el('div','unk',d.awake?'No Steam user found':'Laptop not answering'))
    if(d.steam&&d.steam.playing)steam.append(el('div','now','Now playing: '+d.steam.playing))
    const s1=el('div','row');s1.append(go('Steam','steam_open'),go('Big Picture','steam_bigpicture'))
    const games=d.games||data.games||[]
    const s2=el('div','row');const sel=el('select')
    for(const g of games){const o=el('option','',g);o.value=g;sel.append(o)}
    if(picked[n]&&games.includes(picked[n]))sel.value=picked[n]
    sel.addEventListener('change',()=>{picked[n]=sel.value})
    s2.append(sel,btn('Start game',()=>act(n,'steam_game',sel.value),c||!games.length,undefined,'go'),go('Close game','close_game',undefined,'Close the running game on '+n+'?'))
    steam.append(s1,s2);card.append(steam)
    card.append(
      section(n+'|media','Media',[go('Prev','media_prev'),go('Play / pause','media_playpause'),go('Next','media_next'),go('Vol -','volume_down'),go('Mute','mute'),go('Vol +','volume_up')]),
      section(n+'|apps','Apps',[go('Discord','app','discord'),go('Spotify','app','spotify'),go('Epic','app','epic')]))
    const coding=[go('Start Ollama','ollama_start'),go('Stop Ollama','ollama_stop','','Stop Ollama on '+n+'?'),go('Start Jarvis','jarvis_start'),go('Update Jarvis','git_pull')]
    for(const b of d.buttons||[])coding.push(go(b,'button',b,'Run "'+b+'" on '+n+'?'))
    card.append(section(n+'|code','Coding',coding),section(n+'|sys','System',[
      go('Status','status'),
      go('Game mode','game_mode',undefined,'Stop Jarvis and unload the local models on '+n+'?'),
      go('Restart','restart',undefined,'Restart '+n+'? It comes back by itself in about a minute.'),
      go('Sleep','sleep',undefined,'Sleep makes '+n+' unreachable from this phone until you press its power button. Sleep anyway?')]))
    list.append(card)
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
 * wake(device), forward(device, action, arg) and ping(device) do the real work. If `info(device)`
 * is given, it replaces ping and also gives each laptop's own games and buttons.
 */
export async function startHub({ password, port = 8791, host = '0.0.0.0', getDevices, getGames, wake, forward, ping, info, allowPublic = false, now = Date.now }) {
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
            Object.entries(devices).map(async ([name, d]) => {
              const base = { name, canWake: Boolean(d.mac), canControl: Boolean(d.agent), ...(d.theme ? { theme: d.theme } : {}) }
              if (!d.agent) return { ...base, awake: null }
              if (!info) return { ...base, awake: await ping(d) }
              const got = await info(d)
              if (!got) return { ...base, awake: false }
              return { ...base, awake: true, games: got.games ?? [], buttons: got.buttons ?? [], ...(got.model ? { model: got.model } : {}), ...(got.steam ? { steam: got.steam } : {}) }
            }),
          )
          return json(res, 200, { devices: list, games: getGames() })
        }

        const { device: name, action, game, arg } = await readJson(req)
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
          const given = typeof arg === 'string' ? arg : typeof game === 'string' ? game : undefined
          return json(res, 200, { message: await forward(device, action, given?.slice(0, 60)) })
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
