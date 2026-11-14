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
import { page } from './remote-page.mjs'

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

function readBytes(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > max) {
        reject(Object.assign(new Error('That picture is too large.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** What kind of picture these bytes really are, from the first bytes, whatever the sender claims. */
export function sniffImage(b) {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}
const GAME_NAME = /^[a-z0-9 _.+-]{1,60}$/
const cleanGame = (v) => {
  const name = typeof v === 'string' ? v.toLowerCase().trim() : ''
  return GAME_NAME.test(name) && !name.includes('..') ? name : ''
}
const MAX_PICTURE = 1.5 * 1024 * 1024

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
export async function startAgent({ token, port = 8790, host = '0.0.0.0', run, info, avatar, gameArt, allowPublic = false }) {
  const server = createServer(async (req, res) => {
    if (!allowPublic && !isPrivateAddress(req.socket.remoteAddress)) return json(res, 403, { error: 'Private networks only.' })
    // The token is checked before anything else, including the body.
    if (!sameSecret(req.headers['x-agent-token'] ?? '', token)) return json(res, 401, { error: 'Not allowed.' })
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method === 'GET' && path === '/agent/ping') return json(res, 200, { ok: true })
      if (req.method === 'GET' && path === '/agent/info') return json(res, 200, { ok: true, ...((await info?.()) ?? {}) })
      if (req.method === 'GET' && path === '/agent/avatar') {
        const pic = await avatar?.()
        if (!pic) return json(res, 404, { error: 'No picture.' })
        res.writeHead(200, { 'content-type': pic.type, 'content-length': pic.bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(pic.bytes)
      }
      if (req.method === 'GET' && path === '/agent/gameart') {
        const pic = await gameArt?.(new URL(req.url, 'http://agent').searchParams.get('name'))
        if (!pic) return json(res, 404, { error: 'No picture.' })
        res.writeHead(200, { 'content-type': pic.type, 'content-length': pic.bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(pic.bytes)
      }
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
    // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
    const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n) : '')
    const steam = body.steam && typeof body.steam === 'object' ? { user: text(body.steam.user, 40), playing: text(body.steam.playing, 40), avatar: body.steam.avatar === true } : null
    const mode = ['saver', 'balanced', 'gaming'].includes(body.mode) ? body.mode : ''
    const cap = body.cap && typeof body.cap === 'object' ? { on: body.cap.on === true, target: Math.min(Math.max(Number(body.cap.target) || 70, 60), 85) } : null
    return { games: names(body.games), buttons: names(body.buttons), apps: names(body.apps), gameArt: names(body.gameArt), version: typeof body.version === 'string' && /^[0-9a-f]{4,12}$/.test(body.version) ? body.version : '', stale: body.stale === true, model: text(body.model, 40), steam, mode, cap, governor: body.governor === true }
  } catch {
    return null
  }
}

/** The profile picture a laptop's agent offers, or null. Only small png, jpeg or webp images are accepted. */
export const httpAvatar = (token) => async (device) => {
  try {
    const res = await fetch(`${device.agent}/agent/avatar`, { headers: { 'x-agent-token': token }, signal: AbortSignal.timeout(4000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length <= 1024 * 1024 ? { type, bytes } : null
  } catch {
    return null
  }
}

/** The picture of one game on a laptop, or null. Only small png, jpeg or webp images are accepted. */
export const httpGameArt = (token) => async (device, game) => {
  try {
    const res = await fetch(`${device.agent}/agent/gameart?name=${encodeURIComponent(String(game).slice(0, 60))}`, { headers: { 'x-agent-token': token }, signal: AbortSignal.timeout(4000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length <= 1.5 * 1024 * 1024 ? { type, bytes } : null
  } catch {
    return null
  }
}

// -- hub --------------------------------------------------------------------------

/**
 * getDevices() returns { name: { mac, broadcast, agent } }, getGames() returns game names.
 * wake(device), forward(device, action, arg) and ping(device) do the real work. If `info(device)`
 * is given, it replaces ping and also gives each laptop's own games and buttons.
 * getArt(theme) gives { type, bytes } for an optional background picture, or null.
 * getAvatar(device) gives the Steam profile picture of that laptop's agent, or null.
 * getGameArt(device, game) gives the picture of one of that laptop's games, or null.
 * artStore { list(), get(name), put(name, type, bytes) } keeps pictures chosen on the phone, here on the hub.
 */
export async function startHub({ password, port = 8791, host = '0.0.0.0', getDevices, getGames, wake, forward, ping, info, getArt, getAvatar, getGameArt, artStore, allowPublic = false, now = Date.now }) {
  const auth = createPhoneAuth({ password, now })
  const seenGames = new Set()

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
          'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        })
        return res.end(page(nonce))
      }

      if (req.method === 'POST' && path === '/login') {
        const body = await readJson(req)
        const r = auth.login(ip, body.password)
        return r.token ? json(res, 200, { token: r.token }) : json(res, r.status, { error: r.error })
      }

      if (req.method === 'POST' && path === '/api/art') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        const { theme } = await readJson(req)
        const art = theme === 'rog' || theme === 'tuf' ? await getArt?.(theme) : null
        if (!art) {
          res.writeHead(204, { 'cache-control': 'no-store' })
          return res.end()
        }
        res.writeHead(200, { 'content-type': art.type, 'content-length': art.bytes.length, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' })
        return res.end(art.bytes)
      }

      if (req.method === 'POST' && path === '/api/avatar') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        const { device: name } = await readJson(req)
        const device = getDevices()[String(name ?? '').toLowerCase()]
        const pic = device?.agent ? await getAvatar?.(device) : null
        if (!pic) {
          res.writeHead(204, { 'cache-control': 'no-store' })
          return res.end()
        }
        res.writeHead(200, { 'content-type': pic.type, 'content-length': pic.bytes.length, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' })
        return res.end(pic.bytes)
      }

      if (req.method === 'POST' && path === '/api/gameart') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        const { device: name, game } = await readJson(req)
        const key = cleanGame(game)
        // A picture chosen on the phone (kept here) wins over one a laptop has on its own disk.
        let pic = key ? (artStore?.get(key) ?? null) : null
        const device = getDevices()[String(name ?? '').toLowerCase()]
        if (!pic && key && device?.agent) pic = await getGameArt?.(device, key)
        if (!pic) {
          res.writeHead(204, { 'cache-control': 'no-store' })
          return res.end()
        }
        res.writeHead(200, { 'content-type': pic.type, 'content-length': pic.bytes.length, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' })
        return res.end(pic.bytes)
      }

      if (req.method === 'POST' && path === '/api/gameart/upload') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!auth.valid(bearer)) return json(res, 401, { error: 'Please unlock again.' })
        if (!artStore) return json(res, 501, { error: 'This hub cannot keep pictures.' })
        const key = cleanGame(new URL(req.url, 'http://hub').searchParams.get('game'))
        if (!key || ![...seenGames, ...getGames().map((g) => String(g).toLowerCase())].includes(key)) return json(res, 400, { error: 'Unknown game.' })
        const bytes = await readBytes(req, MAX_PICTURE)
        const type = sniffImage(bytes)
        if (!type) return json(res, 415, { error: 'That is not a png, jpeg or webp picture.' })
        artStore.put(key, type, bytes)
        return json(res, 200, { message: `Picture saved for ${key}.` })
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
              return {
                ...base,
                awake: true,
                games: got.games ?? [],
                buttons: got.buttons ?? [],
                ...(got.apps?.length ? { apps: got.apps } : {}),
                ...(got.gameArt?.length ? { gameArt: got.gameArt } : {}),
                ...(got.version ? { version: got.version } : {}),
                ...(got.stale ? { stale: true } : {}),
                ...(got.model ? { model: got.model } : {}),
                ...(got.steam ? { steam: got.steam } : {}),
                ...(got.mode ? { mode: got.mode } : {}),
                ...(got.cap ? { cap: got.cap } : {}),
                governor: got.governor === true,
              }
            }),
          )
          for (const g of getGames()) seenGames.add(String(g).toLowerCase())
          for (const d of list) for (const g of d.games ?? []) seenGames.add(String(g).toLowerCase())
          return json(res, 200, { devices: list, games: getGames(), art: artStore ? artStore.list() : [] })
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
