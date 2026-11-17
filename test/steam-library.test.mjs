import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allGames, parseVdf, scanSteamGames } from '../bridge/steam-library.mjs'

const acf = (id, name) => `"AppState" { "appid" "${id}" "name" "${name}" }`

test('every installed game in every Steam library is found, tools are not', () => {
  const root = mkdtempSync(join(tmpdir(), 'steamlib-'))
  const steam = join(root, 'Steam')
  const lib2 = join(root, 'Lib2')
  for (const d of [join(steam, 'steamapps'), join(lib2, 'steamapps')]) mkdirSync(d, { recursive: true })
  const esc = (p) => p.replace(/\\/g, '\\\\')
  writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${esc(steam)}" } "1" { "path" "${esc(lib2)}" } }`)
  writeFileSync(join(steam, 'steamapps', 'appmanifest_578080.acf'), acf(578080, 'PUBG: BATTLEGROUNDS'))
  writeFileSync(join(steam, 'steamapps', 'appmanifest_228980.acf'), acf(228980, 'Steamworks Common Redistributables'))
  writeFileSync(join(lib2, 'steamapps', 'appmanifest_1145360.acf'), acf(1145360, 'Hades'))
  assert.deepEqual(scanSteamGames(steam), { 'pubg: battlegrounds': '578080', hades: '1145360' })
})

test('games.json still adds and overrides; the list is sorted and cached', () => {
  let scans = 0
  const opts = { scan: () => (scans++, { zeta: '1', hades: '2' }), extra: () => ({ hades: '99', alpha: '3' }), now: () => 1e12 }
  const first = allGames(opts)
  assert.deepEqual(Object.entries(first), [['alpha', '3'], ['hades', '99'], ['zeta', '1']])
  allGames(opts)
  assert.equal(scans, 1)
  assert.equal(parseVdf('"__proto__" { "x" "1" }').x, undefined)
})
