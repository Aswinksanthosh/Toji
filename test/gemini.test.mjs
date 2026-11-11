// The Gemini brain, driven by a fake Gemini so no key or network is needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { createGeminiQuery } from '../bridge/gemini.mjs'
import { memoryServer, readNotes } from '../bridge/memory.mjs'

/** A fake client whose replies are scripted, one entry per model call. */
function fakeClient(script) {
  const calls = []
  return {
    calls,
    models: {
      generateContentStream: async (params) => {
        calls.push(JSON.parse(JSON.stringify(params.contents)))
        const step = script.shift()
        return (async function* () {
          if (step instanceof Error) throw step
          for (const parts of step) yield { candidates: [{ content: { parts } }] }
        })()
      },
    },
  }
}

async function collect(stream, count) {
  const out = []
  for await (const m of stream) {
    out.push(m)
    if (m.type === 'result' && --count === 0) break
  }
  return out
}

/** The shape the bridge really sends, not a bare string. */
const asked = (text) => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
})

function oneQuestion(text) {
  return (async function* () {
    yield asked(text)
  })()
}

test('a plain answer streams as text deltas and ends in a success result', async () => {
  const client = fakeClient([[[{ text: 'Hello, ' }], [{ text: 'sir.' }]]])
  const q = createGeminiQuery({ client })({ prompt: oneQuestion('hi'), options: {} })
  const msgs = await collect(q, 1)
  const deltas = msgs
    .filter((m) => m.type === 'stream_event')
    .map((m) => m.event.delta.text)
  assert.deepEqual(deltas, ['Hello, ', 'sir.'])
  const result = msgs.at(-1)
  assert.equal(result.subtype, 'success')
  assert.equal(result.result, 'Hello, sir.')
})

test('a tool call runs the real memory tool, then Gemini answers from the result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-gem-'))
  const client = fakeClient([
    [[{ functionCall: { name: 'jarvis_memory__remember', args: { note: 'Likes blue' } } }]],
    [[{ text: 'Noted.' }]],
  ])
  const q = createGeminiQuery({ client })({
    prompt: oneQuestion('remember I like blue'),
    options: { mcpServers: { jarvis_memory: memoryServer(dir) } },
  })
  const msgs = await collect(q, 1)

  assert.deepEqual(readNotes(dir), ['Likes blue'])
  const start = msgs.find((m) => m.event?.type === 'content_block_start')
  assert.equal(start.event.content_block.name, 'mcp__jarvis_memory__remember')
  const done = msgs.find((m) => m.type === 'user')
  assert.equal(done.message.content[0].is_error, false)
  assert.equal(msgs.at(-1).result, 'Noted.')

  // The second model call saw the tool's reply.
  const second = client.calls[1]
  assert.equal(second.at(-1).parts[0].functionResponse.response.output, 'Remembered.')
})

test('read-only mode refuses an effectful tool and tells Gemini so', async () => {
  let ran = false
  const other = createSdkMcpServer({
    name: 'other',
    tools: [
      tool('delete_everything', 'Dangerous', {}, async () => {
        ran = true
        return { content: [{ type: 'text', text: 'gone' }] }
      }),
    ],
  })
  const client = fakeClient([
    [[{ functionCall: { name: 'other__delete_everything', args: {} } }]],
    [[{ text: 'I cannot do that.' }]],
  ])
  const q = createGeminiQuery({ client, allowWrites: false })({
    prompt: oneQuestion('delete it'),
    options: { mcpServers: { other } },
  })
  const msgs = await collect(q, 1)
  assert.equal(ran, false)
  assert.equal(msgs.find((m) => m.type === 'user').message.content[0].is_error, true)
})

test('an unknown tool name is reported, not crashed on', async () => {
  const client = fakeClient([
    [[{ functionCall: { name: 'nope__nothing', args: {} } }]],
    [[{ text: 'Sorry.' }]],
  ])
  const q = createGeminiQuery({ client })({ prompt: oneQuestion('x'), options: {} })
  const msgs = await collect(q, 1)
  assert.equal(msgs.at(-1).subtype, 'success')
})

test('an API failure ends the turn with an error result and the next turn still works', async () => {
  const client = fakeClient([new Error('quota exceeded'), [[{ text: 'Back.' }]]])
  const prompt = (async function* () {
    yield asked('first')
    yield asked('second')
  })()
  const q = createGeminiQuery({ client })({ prompt, options: {} })
  const msgs = await collect(q, 2)
  const results = msgs.filter((m) => m.type === 'result')
  assert.equal(results[0].subtype, 'error_during_execution')
  assert.match(results[0].errors[0], /quota/)
  assert.match(results[0].userMessage, /free limit/)
  assert.equal(results[1].subtype, 'success')
  // The failed question was forgotten, so it is not sent again.
  assert.equal(client.calls[1].length, 1)
})

test('interrupt stops a turn in flight and reports it as an error result', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const client = {
    models: {
      generateContentStream: async () =>
        (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'partial' }] } }] }
          await gate
          yield { candidates: [{ content: { parts: [{ text: ' more' }] } }] }
        })(),
    },
  }
  const q = createGeminiQuery({ client })({ prompt: oneQuestion('long'), options: {} })
  const seen = []
  const reading = (async () => {
    for await (const m of q) {
      seen.push(m)
      if (m.type === 'stream_event') {
        await q.interrupt()
        release()
      }
      if (m.type === 'result') break
    }
  })()
  await reading
  assert.equal(seen.at(-1).subtype, 'error_during_execution')
  assert.deepEqual(seen.at(-1).errors, [])
})

test('old turns are trimmed so the history stays bounded', async () => {
  const script = Array.from({ length: 20 }, (_, i) => [[{ text: `a${i}` }]])
  const client = fakeClient(script)
  const prompt = (async function* () {
    for (let i = 0; i < 20; i++) yield asked(`q${i}`)
  })()
  const q = createGeminiQuery({ client })({ prompt, options: {} })
  await collect(q, 20)
  const last = client.calls.at(-1)
  assert.ok(last.length <= 12 * 2 + 1, `history was ${last.length} entries`)
  assert.equal(last[0].role, 'user')
})
