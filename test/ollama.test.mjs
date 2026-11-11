// The local brain, driven by a fake Ollama.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOllamaQuery, ollamaReason, thinkFilter } from '../bridge/ollama.mjs'
import { memoryServer, readNotes } from '../bridge/memory.mjs'

const asked = (text) => ({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
const one = (text) => (async function* () { yield asked(text) })()

/** Each scripted step is a list of streamed chunks, as Ollama would send them. */
function fakeFetch(script) {
  const requests = []
  const fn = async (url, init) => {
    requests.push(JSON.parse(init.body))
    const step = script.shift()
    if (step instanceof Response) return step
    return {
      ok: true,
      body: (async function* () {
        for (const chunk of step) yield JSON.stringify(chunk) + '\n'
      })(),
    }
  }
  fn.requests = requests
  return fn
}

async function collect(stream, results = 1) {
  const out = []
  for await (const m of stream) {
    out.push(m)
    if (m.type === 'result' && --results === 0) break
  }
  return out
}

test('a plain answer streams and ends in success', async () => {
  const fetchFn = fakeFetch([[{ message: { content: 'Hello, ' } }, { message: { content: 'sir.' }, done: true }]])
  const msgs = await collect(createOllamaQuery({ fetchFn })({ prompt: one('hi'), options: { systemPrompt: 'be brief' } }))
  assert.deepEqual(msgs.filter((m) => m.type === 'stream_event').map((m) => m.event.delta.text), ['Hello, ', 'sir.'])
  assert.equal(msgs.at(-1).result, 'Hello, sir.')
  assert.equal(fetchFn.requests[0].messages[0].content, 'be brief')
  assert.equal(fetchFn.requests[0].stream, true)
})

test('reasoning inside <think> tags is never spoken, even when a tag is split across chunks', () => {
  const f = thinkFilter()
  const out = ['Hi <th', 'ink>secret plan</thi', 'nk> there'].map(f).join('')
  assert.equal(out, 'Hi  there')
  const g = thinkFilter()
  assert.equal(['A < B', ' and C'].map(g).join(''), 'A < B and C')
})

test('a tool call runs the real memory tool and the model sees the result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-oll-'))
  const fetchFn = fakeFetch([
    [{ message: { tool_calls: [{ function: { name: 'jarvis_memory__remember', arguments: { note: 'Likes tea' } } }] } }],
    [{ message: { content: 'Noted.' }, done: true }],
  ])
  const q = createOllamaQuery({ fetchFn })({
    prompt: one('remember I like tea'),
    options: { mcpServers: { jarvis_memory: memoryServer(dir) } },
  })
  const msgs = await collect(q)
  assert.deepEqual(readNotes(dir), ['Likes tea'])
  assert.equal(msgs.at(-1).result, 'Noted.')
  const second = fetchFn.requests[1].messages
  assert.equal(second.at(-1).role, 'tool')
  assert.equal(second.at(-1).content, 'Remembered.')
})

test('tool arguments that arrive as a string are parsed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-oll-'))
  const fetchFn = fakeFetch([
    [{ message: { tool_calls: [{ function: { name: 'jarvis_memory__remember', arguments: '{"note":"Prefers short"}' } }] } }],
    [{ message: { content: 'Ok.' } }],
  ])
  await collect(createOllamaQuery({ fetchFn })({ prompt: one('x'), options: { mcpServers: { jarvis_memory: memoryServer(dir) } } }))
  assert.deepEqual(readNotes(dir), ['Prefers short'])
})

test('when Ollama is not running the turn fails with a plain, speakable reason', async () => {
  const fetchFn = async () => { throw new TypeError('fetch failed') }
  const msgs = await collect(createOllamaQuery({ fetchFn })({ prompt: one('hi'), options: {} }))
  assert.equal(msgs.at(-1).subtype, 'error_during_execution')
  assert.match(msgs.at(-1).userMessage, /Ollama/)
})

test('a missing model is explained', async () => {
  const fetchFn = fakeFetch([new Response('model "qwen3:4b" not found, try pulling it first', { status: 404 })])
  const msgs = await collect(createOllamaQuery({ fetchFn })({ prompt: one('hi'), options: {} }))
  assert.match(msgs.at(-1).userMessage, /not installed/)
  assert.match(ollamaReason('connect ECONNREFUSED 127.0.0.1:11434'), /running/)
})

test('a failed turn is forgotten so the next one still works', async () => {
  const fetchFn = fakeFetch([new Response('boom', { status: 500 }), [{ message: { content: 'Back.' } }]])
  const prompt = (async function* () { yield asked('one'); yield asked('two') })()
  const msgs = await collect(createOllamaQuery({ fetchFn })({ prompt, options: {} }), 2)
  assert.equal(msgs.filter((m) => m.type === 'result').at(-1).subtype, 'success')
  assert.equal(fetchFn.requests[1].messages.filter((m) => m.role === 'user').length, 1)
})

test('interrupt aborts the turn in flight', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const fetchFn = async (url, init) => ({
    ok: true,
    body: (async function* () {
      yield JSON.stringify({ message: { content: 'partial' } }) + '\n'
      await gate
      yield JSON.stringify({ message: { content: ' more' } }) + '\n'
    })(),
  })
  const q = createOllamaQuery({ fetchFn })({ prompt: one('long'), options: {} })
  const seen = []
  for await (const m of q) {
    seen.push(m)
    if (m.type === 'stream_event') { await q.interrupt(); release() }
    if (m.type === 'result') break
  }
  assert.equal(seen.at(-1).subtype, 'error_during_execution')
  assert.deepEqual(seen.at(-1).errors, [])
})

test('thinking is switched off by default, and retried without the setting for models that reject it', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    if (body.think === false && calls.length === 1) return new Response('"model" does not support thinking', { status: 400 })
    return { ok: true, body: (async function* () { yield JSON.stringify({ message: { content: 'Hi.' } }) + '\n' })() }
  }
  const msgs = await collect(createOllamaQuery({ fetchFn })({ prompt: one('hi'), options: {} }))
  assert.equal(calls[0].think, false)
  assert.equal(calls[1].think, undefined)
  assert.equal(msgs.at(-1).result, 'Hi.')
})

test('JARVIS_OLLAMA_THINK=1 leaves thinking on', async () => {
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return { ok: true, body: (async function* () { yield JSON.stringify({ message: { content: 'Hi.' } }) + '\n' })() }
  }
  await collect(createOllamaQuery({ fetchFn, think: true })({ prompt: one('hi'), options: {} }))
  assert.equal(calls[0].think, undefined)
})
