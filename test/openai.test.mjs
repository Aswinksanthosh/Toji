// The OpenAI-compatible brain, driven by a fake model server (server-sent events).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenAIQuery, openaiReason } from '../bridge/openai.mjs'
import { memoryServer, readNotes } from '../bridge/memory.mjs'

const asked = (text) => ({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
const one = (text) => (async function* () { yield asked(text) })()
const sse = (...events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)

/** Each scripted step is a list of SSE lines. Records every request. */
function fakeServer(script) {
  const requests = []
  const fn = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    const step = script.shift()
    if (step instanceof Response) return step
    return { ok: true, body: (async function* () { for (const line of step) yield line })() }
  }
  fn.requests = requests
  return fn
}
const text = (t) => ({ choices: [{ delta: { content: t } }] })

async function collect(stream, results = 1) {
  const out = []
  for await (const m of stream) {
    out.push(m)
    if (m.type === 'result' && --results === 0) break
  }
  return out
}

test('a plain answer streams, and the request is shaped for an OpenAI-compatible server', async () => {
  const fetchFn = fakeServer([sse(text('Hello, '), text('sir.'), '[DONE]')])
  const q = createOpenAIQuery({ model: 'm', url: 'http://x/v1/', apiKey: 'k', fetchFn })({ prompt: one('hi'), options: { systemPrompt: 'be brief' } })
  const msgs = await collect(q)
  assert.equal(msgs.filter((m) => m.type === 'stream_event').map((m) => m.event.delta.text).join(''), 'Hello, sir.')
  assert.equal(msgs.at(-1).result, 'Hello, sir.')
  const r = fetchFn.requests[0]
  assert.equal(r.url, 'http://x/v1/chat/completions')
  assert.equal(r.headers.authorization, 'Bearer k')
  assert.equal(r.body.stream, true)
  assert.equal(r.body.model, 'm')
  assert.match(r.body.messages[0].content, /^be brief/)
})

test('a tool call split across stream chunks is assembled, run, and answered with the matching id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-oai-'))
  const call = (i, extra) => ({ choices: [{ delta: { tool_calls: [{ index: i, ...extra }] } }] })
  const fetchFn = fakeServer([
    sse(
      call(0, { id: 'call_1', type: 'function', function: { name: 'jarvis_memory__remember', arguments: '' } }),
      call(0, { function: { arguments: '{"note":"Likes ' } }),
      call(0, { function: { arguments: 'tea"}' } }),
      '[DONE]',
    ),
    sse(text('Noted.'), '[DONE]'),
  ])
  const q = createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('remember I like tea'), options: { mcpServers: { jarvis_memory: memoryServer(dir) } } })
  const msgs = await collect(q)
  assert.deepEqual(readNotes(dir), ['Likes tea'])
  assert.equal(msgs.at(-1).result, 'Noted.')
  const second = fetchFn.requests[1].body.messages
  const assistant = second.find((m) => m.role === 'assistant')
  assert.equal(assistant.tool_calls[0].id, 'call_1')
  assert.equal(second.at(-1).role, 'tool')
  assert.equal(second.at(-1).tool_call_id, 'call_1')
  assert.match(second.at(-1).content, /^Remembered\./)
})

test('reasoning in think tags never reaches the screen or the speaker', async () => {
  const fetchFn = fakeServer([sse(text('<think>secret plan'), text('</think>The answer.'), '[DONE]')])
  const msgs = await collect(createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('hi'), options: {} }))
  assert.equal(msgs.at(-1).result, 'The answer.')
})

test('a server that sends the whole stream in one lump still works', async () => {
  const fetchFn = fakeServer([[sse(text('One '), text('lump.'), '[DONE]').join('')]])
  const msgs = await collect(createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('hi'), options: {} }))
  assert.equal(msgs.at(-1).result, 'One lump.')
})

test('failures are explained in plain, speakable sentences', async () => {
  assert.match(openaiReason('fetch failed'), /cannot reach/)
  assert.match(openaiReason('Model server 401: invalid api key'), /key/)
  assert.match(openaiReason('Model server 404: model not found'), /not available/)
  assert.match(openaiReason('Model server 429: rate limit'), /busy/)
  const fetchFn = fakeServer([new Response('bad key', { status: 401 })])
  const msgs = await collect(createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('hi'), options: {} }))
  assert.equal(msgs.at(-1).subtype, 'error_during_execution')
  assert.match(msgs.at(-1).userMessage, /did not accept the key/)
})

test('a failed turn is forgotten so the next one still works', async () => {
  const fetchFn = fakeServer([new Response('boom', { status: 500 }), sse(text('Back.'), '[DONE]')])
  const prompt = (async function* () { yield asked('one'); yield asked('two') })()
  const msgs = await collect(createOpenAIQuery({ model: 'm', fetchFn })({ prompt, options: {} }), 2)
  assert.equal(msgs.filter((m) => m.type === 'result').at(-1).subtype, 'success')
  assert.equal(fetchFn.requests[1].body.messages.filter((m) => m.role === 'user').length, 1)
})

test('interrupt aborts a turn in flight', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const fetchFn = async () => ({
    ok: true,
    body: (async function* () {
      yield sse(text('partial'))[0]
      await gate
      yield sse(text(' more'))[0]
    })(),
  })
  const q = createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('long'), options: {} })
  setTimeout(async () => { await q.interrupt(); release() }, 50)
  const seen = []
  for await (const m of q) { seen.push(m); if (m.type === 'result') break }
  assert.equal(seen.at(-1).subtype, 'error_during_execution')
  assert.deepEqual(seen.at(-1).errors, [])
})

test('Qwen models get the no-think switch on the last message; other models do not', async () => {
  const run = async (model) => {
    const fetchFn = fakeServer([sse(text('ok'), '[DONE]')])
    await collect(createOpenAIQuery({ model, fetchFn })({ prompt: one('hi'), options: { systemPrompt: 'sys' } }))
    return fetchFn.requests[0].body.messages
  }
  const qwen = await run('qwen3.5-9b')
  assert.match(qwen.at(-1).content, /\/no_think$/)
  const other = await run('llama-3.1-8b')
  assert.equal(other.at(-1).content, 'hi')
})

test('the display-panel tools are hidden from this brain unless asked for', async () => {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const { z } = await import('zod')
  const make = (name) => createSdkMcpServer({ name, tools: [tool('thing', 'x', { a: z.string().optional() }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))] })
  const fetchFn = fakeServer([sse(text('ok'), '[DONE]')])
  await collect(createOpenAIQuery({ model: 'm', fetchFn })({ prompt: one('hi'), options: { mcpServers: { jarvis: make('jarvis'), jarvis_memory: make('jarvis_memory') } } }))
  assert.deepEqual(fetchFn.requests[0].body.tools.map((t) => t.function.name), ['jarvis_memory__thing'])
})
