import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maybeStartSteam } from '../bridge/steam-start.mjs'

function lab(env, { stamp = null, now = 1_700_000_000_000, uptimeS = 120 } = {}) {
  const launched = []
  const waits = []
  let saved = stamp
  const run = () =>
    maybeStartSteam({
      launch: async (t) => launched.push(t),
      env,
      now: () => now,
      uptimeFn: () => uptimeS,
      readStamp: () => {
        if (saved === null) throw new Error('none')
        return saved
      },
      writeStamp: (t) => (saved = t),
      sleep: async (ms) => waits.push(ms),
      log: () => {},
    })
  return { run, launched, waits, saved: () => saved }
}

test('it does nothing unless it is turned on', async () => {
  const l = lab({})
  assert.equal(await l.run(), 'off')
  assert.deepEqual(l.launched, [])
})

test('turned on: waits, then opens Big Picture once for this boot', async () => {
  const l = lab({ JARVIS_STEAM_AT_START: '1' })
  assert.equal(await l.run(), 'started')
  assert.deepEqual(l.launched, ['steam://open/bigpicture'])
  assert.deepEqual(l.waits, [0])
  assert.equal(await l.run(), 'already', 'the remote restarting in the same boot does not open it again')
  assert.equal(l.launched.length, 1)
})

test('a new boot opens it again', async () => {
  const first = lab({ JARVIS_STEAM_AT_START: '1' }, { now: 1_700_000_000_000, uptimeS: 90 })
  await first.run()
  const later = lab({ JARVIS_STEAM_AT_START: '1' }, { stamp: first.saved(), now: 1_700_000_000_000 + 3 * 3600 * 1000, uptimeS: 90 })
  assert.equal(await later.run(), 'started')
})

test('the wait can be set, within sensible limits', async () => {
  for (const [given, expected] of [['60', 60000], ['0', 0], ['3', 3000], ['9999', 300000], ['nope', 0], ['', 0]]) {
    const l = lab({ JARVIS_STEAM_AT_START: 'yes', JARVIS_STEAM_DELAY: given })
    await l.run()
    assert.deepEqual(l.waits, [expected], given)
  }
})

test('a first launch that fails is tried once more, and a second failure is reported, not thrown', async () => {
  let tries = 0
  const waits = []
  const ok = await maybeStartSteam({ launch: async () => { if (++tries === 1) throw new Error('not ready') }, env: { JARVIS_STEAM_AT_START: '1' }, readStamp: () => { throw new Error('x') }, writeStamp() {}, sleep: async (ms) => waits.push(ms), log: () => {} })
  assert.equal(ok, 'started')
  assert.deepEqual(waits, [0, 15000])
})

test('a launch that always fails is reported, not thrown', async () => {
  const l = await maybeStartSteam({ launch: async () => { throw new Error('no steam') }, env: { JARVIS_STEAM_AT_START: '1' }, readStamp: () => { throw new Error('x') }, writeStamp() {}, sleep: async () => {}, log: () => {} })
  assert.equal(l, 'failed')
})
