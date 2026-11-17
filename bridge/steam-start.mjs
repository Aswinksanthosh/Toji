/**
 * Opens Steam Big Picture by itself when the laptop starts, once per boot. The remote starts at sign-in (also in Xbox
 * full-screen mode), waits a few seconds for Windows and Steam to settle, and then does what the Big Picture button does.
 *
 *   JARVIS_STEAM_AT_START=1      turn it on (a Windows user variable, like the other JARVIS_ settings)
 *   JARVIS_STEAM_DELAY=0         seconds to wait first (0 to 300, default 0: as soon as the remote starts)
 *
 * Restarting only the remote (the Restart remote button, an update) does not open it again: the boot it was opened in is remembered.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { homedir, uptime } from 'node:os'
import { dirname, join } from 'node:path'

export const STAMP_FILE = join(homedir(), '.jarvis', 'steam-start.stamp')

export async function maybeStartSteam({
  launch,
  env = process.env,
  now = Date.now,
  uptimeFn = uptime,
  readStamp = () => readFileSync(STAMP_FILE, 'utf8'),
  writeStamp = (text) => {
    mkdirSync(dirname(STAMP_FILE), { recursive: true })
    writeFileSync(STAMP_FILE, text)
  },
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  if (!/^(1|true|yes|on)$/i.test(String(env.JARVIS_STEAM_AT_START ?? ''))) return 'off'
  // The minute this boot started: the same all through one boot, different after a restart of the laptop.
  const boot = String(Math.round((now() - uptimeFn() * 1000) / 60_000))
  let last = ''
  try {
    last = readStamp().trim()
  } catch {
    // First time.
  }
  if (Math.abs(Number(last) - Number(boot)) <= 2) return 'already'
  const given = Number(env.JARVIS_STEAM_DELAY)
  const delay = Number.isFinite(given) && String(env.JARVIS_STEAM_DELAY ?? '').trim() !== '' ? Math.min(Math.max(given, 0), 300) : 0
  writeStamp(boot)
  await sleep(delay * 1000)
  // The first try can come before Windows or Steam is ready: one more try, 15 seconds later, if it fails.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await launch('steam://open/bigpicture')
      log(`[remote] opened Steam Big Picture (${delay} s wait${attempt > 1 ? ', second try' : ''}).`)
      return 'started'
    } catch (err) {
      log(`[remote] could not open Steam Big Picture (try ${attempt}): ${err.message}`)
      if (attempt === 1) await sleep(15_000)
    }
  }
  return 'failed'
}
