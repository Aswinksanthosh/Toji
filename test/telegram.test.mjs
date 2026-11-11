// The Telegram bot and the text session behind it, against fakes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, startTelegram } from '../bridge/telegram.mjs'
import { createTextSession } from '../bridge/session.mjs'

/** A fake brain: answers "echo: <question>", or fails when asked to. */
function fakeBrain() {
  return ({ prompt }) => {
    const stream = (async function* () {
      yield { type: 'system', subtype: 'init', mcp_servers: [] }
      for await (const msg of prompt) {
        const q = msg.message.content
        if (q === 'fail') yield { type: 'result', subtype: 'error_during_execution', errors: ['x'], userMessage: 'The model is not running.' }
        else {
          yield { type: 'stream_event', event: { delta: { text: 'echo: ' } } }
          yield { type: 'stream_event', event: { delta: { text: q } } }
          yield { type: 'result', subtype: 'success', result: `echo: ${q}` }
        }
      }
    })()
    stream.close = () => {}
    return stream
  }
}

/** A fake Telegram: hands out the scripted updates once, then waits. */
function fakeTelegram(updates) {
  const sent = []
  let served = false
  const fetchFn = async (url, init) => {
    const method = url.split('/').pop()
    const body = JSON.parse(init.body)
    if (method === 'getUpdates') {
      if (!served) {
        served = true
        return { json: async () => ({ ok: true, result: updates }) }
      }
      await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    if (method === 'sendMessage') sent.push(body)
    return { json: async () => ({ ok: true, result: {} }) }
  }
  return { fetchFn, sent }
}

const msg = (id, text, extra = {}) => ({
  update_id: Math.floor(Math.random() * 1e6),
  message: { text, from: { id }, chat: { id, type: 'private' }, ...extra },
})

async function run(updates, allowed, ask) {
  const tg = fakeTelegram(updates)
  const bot = startTelegram({ token: 'T', allowed: new Set(allowed), ask, fetchFn: tg.fetchFn, log: () => {}, retryMs: 5 })
  await new Promise((r) => setTimeout(r, 60))
  bot.stop()
  await bot.done
  return tg.sent
}

test('an allowed user gets an answer from the brain', async () => {
  const session = createTextSession(fakeBrain(), {})
  const sent = await run([msg(42, 'hello')], ['42'], (who, text) => session.ask(text))
  session.close()
  assert.deepEqual(sent.map((s) => s.text), ['echo: hello'])
  assert.equal(sent[0].chat_id, 42)
})

test('a stranger is ignored, and cannot reach the brain', async () => {
  let asked = 0
  const sent = await run([msg(7, 'what is on my calendar?')], ['42'], async () => (asked++, 'secret'))
  assert.equal(asked, 0)
  assert.deepEqual(sent, [])
})

test('a stranger can ask for their own ID, and only that', async () => {
  const sent = await run([msg(7, '/start')], ['42'], async () => 'x')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /ID is 7/)
  assert.doesNotMatch(sent[0].text, /42/)
})

test('group chats are ignored even from an allowed user', async () => {
  let asked = 0
  const update = msg(42, 'hi')
  update.message.chat.type = 'group'
  await run([update], ['42'], async () => (asked++, 'x'))
  assert.equal(asked, 0)
})

test('a failing brain gives a short apology, not a crash, and the bot keeps going', async () => {
  const session = createTextSession(fakeBrain(), {})
  const sent = await run([msg(42, 'fail'), msg(42, 'again')], ['42'], (who, text) => session.ask(text))
  session.close()
  assert.match(sent[0].text, /did not work: The model is not running/)
  assert.equal(sent[1].text, 'echo: again')
})

test('the session answers questions in order, one after another', async () => {
  const session = createTextSession(fakeBrain(), {})
  assert.equal(await session.ask('one'), 'echo: one')
  assert.equal(await session.ask('two'), 'echo: two')
  session.close()
  await assert.rejects(() => session.ask('three'), /ended/)
})

test('long answers are split under Telegram\'s limit without losing text', () => {
  const text = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')
  const parts = chunkText(text, 1000)
  assert.ok(parts.length > 1)
  assert.ok(parts.every((p) => p.length <= 1000))
  assert.equal(parts.join(' '), text)
  assert.deepEqual(chunkText('short'), ['short'])
})

import { withFallback } from '../bridge/session.mjs'

test('when Gemini is out of free requests the phone answers with the local model and says so', async () => {
  const ask = withFallback(
    async () => { throw new Error('The Gemini free limit has been reached for now. Try again later.') },
    async (who, text) => `local: ${text}`,
  )
  assert.match(await ask('x', 'hi'), /^local: hi\n\n\(Answered by the local model/)
  const busy = withFallback(async () => { throw new Error('Gemini is busy right now. Try again in a minute.') }, async () => 'local')
  assert.match(await busy('x', 'hi'), /^local/)
})

test('other failures are not hidden by the fallback, and a broken fallback shows the original problem', async () => {
  let fellBack = 0
  const other = withFallback(async () => { throw new Error('The model is not running.') }, async () => (fellBack++, 'x'))
  await assert.rejects(() => other('x', 'hi'), /not running/)
  assert.equal(fellBack, 0)
  const both = withFallback(async () => { throw new Error('The Gemini free limit has been reached') }, async () => { throw new Error('I cannot reach Ollama.') })
  await assert.rejects(() => both('x', 'hi'), /free limit/)
  assert.equal(await withFallback(async () => 'fine', async () => 'unused')('x', 'hi'), 'fine')
})
