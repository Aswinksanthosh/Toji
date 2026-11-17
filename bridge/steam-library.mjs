/**
 * Every installed Steam game, found from Steam's own files (steamapps/appmanifest_*.acf in each
 * Steam library folder), so the drop-down lists them all without editing games.json.
 * games.json still works: its entries are added, and win on a name clash. Read-only.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { knownGames } from './local.mjs'

/** Steam's text format: "key" "value" and "key" { ... }. Objects have no prototype. */
export function parseVdf(text) {
  const token = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g
  const stack = [Object.create(null)]
  let key = null
  let m
  while ((m = token.exec(String(text ?? '')))) {
    if (m[2] === '{') {
      const o = Object.create(null)
      if (key !== null) {
        stack.at(-1)[key] = o
        key = null
      }
      stack.push(o)
    } else if (m[2] === '}') {
      if (stack.length > 1) stack.pop()
      key = null
    } else if (m[1] !== undefined) {
      const s = m[1].replace(/\\(.)/g, '$1')
      if (key === null) key = s
      else {
        stack.at(-1)[key] = s
        key = null
      }
    }
  }
  return stack[0]
}

const NOT_GAMES = new Set(['228980', '1070560', '1391110', '1493710', '1628350', '1826330'])
const NOT_GAME_NAME = /^(steamworks common|steam linux runtime|proton\b|steam voice|steamvr performance)/i

export function libraryFolders(steamPath, readText = (f) => readFileSync(f, 'utf8')) {
  const folders = [steamPath]
  try {
    const vdf = parseVdf(readText(join(steamPath, 'steamapps', 'libraryfolders.vdf')))
    for (const v of Object.values(vdf.libraryfolders ?? vdf.LibraryFolders ?? {})) {
      const p = typeof v === 'string' ? v : v?.path
      if (typeof p === 'string' && p && !folders.some((f) => f.toLowerCase() === p.toLowerCase())) folders.push(p)
    }
  } catch {
    // Only Steam's own folder.
  }
  return folders
}

/** { "game name in lower case": "appid" } for every installed game. */
export function scanSteamGames(steamPath, { readText = (f) => readFileSync(f, 'utf8'), readdir = readdirSync } = {}) {
  const out = {}
  for (const lib of libraryFolders(steamPath, readText)) {
    let files = []
    try {
      files = readdir(join(lib, 'steamapps'))
    } catch {
      continue
    }
    for (const f of files) {
      const m = /^appmanifest_(\d{1,10})\.acf$/.exec(f)
      if (!m) continue
      try {
        const app = parseVdf(readText(join(lib, 'steamapps', f))).AppState
        // eslint-disable-next-line no-control-regex -- control characters are removed on purpose
        const name = typeof app?.name === 'string' ? app.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60).toLowerCase() : ''
        const appid = String(app?.appid ?? m[1])
        if (name && /^\d{1,10}$/.test(appid) && !NOT_GAMES.has(appid) && !NOT_GAME_NAME.test(name)) out[name] = appid
      } catch {
        // A damaged manifest: skip that game.
      }
    }
  }
  return out
}

function findSteamPath() {
  const guesses = []
  try {
    const out = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    const p = /SteamPath\s+REG_\w+\s+(.+)/i.exec(out)?.[1]?.trim()
    if (p) guesses.push(p)
  } catch {
    // Not in the registry.
  }
  guesses.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam')
  return guesses.find((p) => existsSync(join(p, 'steam.exe'))) ?? ''
}

let cache = { at: 0, value: {} }
/** The installed games plus games.json, cached for a minute. `scan` is injectable for tests. */
export function allGames({ scan = () => { const p = findSteamPath(); return p ? scanSteamGames(p) : {} }, extra = knownGames, now = Date.now } = {}) {
  if (now() - cache.at < 60_000) return cache.value
  let scanned = {}
  try {
    scanned = scan()
  } catch {
    // No Steam: only games.json.
  }
  const value = Object.fromEntries(Object.entries({ ...scanned, ...extra() }).sort(([a], [b]) => a.localeCompare(b)))
  cache = { at: now(), value }
  return value
}

export const steamGameUrlFor = (game) => {
  const wanted = String(game ?? '').toLowerCase().trim()
  const id = /^\d{1,10}$/.test(wanted) ? wanted : allGames()[wanted]
  return id ? `steam://rungameid/${id}` : null
}
