/**
 * A brain for any "OpenAI-compatible" model server: LM Studio, llama.cpp's
 * server, vLLM, Odysseus, a hosted API, or anything else that serves
 * POST /v1/chat/completions. Choose it with JARVIS_BRAIN=openai.
 *
 * Same interface as the other brains (a stream of messages plus interrupt() and
 * close()), so the page, the tools and the permission gate are shared.
 *
 *   JARVIS_OPENAI_URL    base address, default http://127.0.0.1:1234/v1 (LM Studio)
 *   JARVIS_OPENAI_MODEL  the model name the server expects
 *   JARVIS_OPENAI_KEY    optional bearer key
 */

import { connectTools, executeTool, userText } from './gemini.mjs'
import { thinkFilter } from './ollama.mjs'

export const OPENAI_DEFAULT_URL = 'http://127.0.0.1:1234/v1'

const MAX_TURNS_KEPT = 8

/** A sentence safe to speak aloud for the failures people actually hit. */
export function openaiReason(text) {
  const t = String(text ?? '')
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(t)) return 'I cannot reach the model server. Check that it is running.'
  if (/\b40[13]\b|unauthori[sz]ed|invalid api key|incorrect api key/i.test(t)) return 'The model server did not accept the key.'
  if (/\b404\b|model.*(not found|does not exist)|not_found/i.test(t)) return 'That model is not available on the server.'
  if (/\b429\b|rate limit|quota/i.test(t)) return 'The model server is busy or out of requests. Try again in a minute.'
  return undefined
}

/** Reads a streamed response as server-sent events, yielding each JSON payload. */
async function* sseEvents(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  const take = function* (final) {
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1 || (final && buffer.length)) {
      const line = (nl === -1 ? buffer : buffer.slice(0, nl)).trim()
      buffer = nl === -1 ? '' : buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      if (data) yield JSON.parse(data)
    }
  }
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    yield* take(false)
  }
  yield* take(true)
}

export function createOpenAIQuery({
  model,
  url = OPENAI_DEFAULT_URL,
  apiKey = '',
  allowWrites = false,
  fetchFn = globalThis.fetch,
}) {
  return function openaiQuery({ prompt, options = {} }) {
    const maxSteps = options.maxTurns ?? 12
    let closed = false
    let current = null
    let tools = null
    const history = []
    const turnStarts = []

    // Qwen-style models obey a soft switch in the last message, which keeps a voice
    // assistant from reasoning for minutes. Other models ignore it.
    const softOff = /qwen3/i.test(model) && process.env.JARVIS_OPENAI_THINK !== '1'
    const systemText = (options.systemPrompt ?? '') + (softOff ? '\n/no_think' : '')
    const withSwitch = (msgs) =>
      softOff && msgs.length > 1 && typeof msgs.at(-1).content === 'string'
        ? [...msgs.slice(0, -1), { ...msgs.at(-1), content: `${msgs.at(-1).content}\n/no_think` }]
        : msgs

    const trim = () => {
      while (turnStarts.length > MAX_TURNS_KEPT) {
        const cut = turnStarts[1] ?? history.length
        history.splice(0, cut)
        turnStarts.shift()
        for (let i = 0; i < turnStarts.length; i++) turnStarts[i] -= cut
      }
    }

    async function* run() {
      tools = await connectTools(options.mcpServers)
      // Small local models do badly with a long tool list and reach for the display
      // panels with made-up addresses. Hidden unless asked for.
      const showDisplay = process.env.JARVIS_OLLAMA_DISPLAY === '1'
      const toolList = tools.declarations
        .filter((d) => showDisplay || !d.name.startsWith('jarvis__'))
        .map((d) => ({
          type: 'function',
          function: { name: d.name, description: d.description, parameters: d.parametersJsonSchema },
        }))
      yield {
        type: 'system',
        subtype: 'init',
        mcp_servers: tools.servers.map((name) => ({ name, status: 'connected' })),
      }

      for await (const incoming of prompt) {
        if (closed) break
        const text = userText(incoming)
        if (!text) continue
        const ac = new AbortController()
        current = ac
        turnStarts.push(history.length)
        history.push({ role: 'user', content: text })
        let spoken = ''
        let failure = null

        try {
          for (let step = 0; step < maxSteps; step++) {
            const res = await fetchFn(`${url.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              signal: ac.signal,
              headers: {
                'content-type': 'application/json',
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({
                model,
                stream: true,
                messages: withSwitch([{ role: 'system', content: systemText }, ...history]),
                ...(toolList.length ? { tools: toolList } : {}),
              }),
            })
            if (!res.ok) throw new Error(`Model server ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)

            const filter = thinkFilter()
            let stepText = ''
            const calls = new Map() // index -> { id, name, args }
            const speak = function* (delta) {
              if (!delta) return
              stepText += delta
              spoken += delta
              yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } } }
            }

            for await (const part of sseEvents(res.body)) {
              if (ac.signal.aborted) throw new Error('aborted')
              if (part.error) throw new Error(String(part.error.message ?? part.error))
              const delta = part.choices?.[0]?.delta ?? {}
              yield* speak(filter.push(delta.content ?? ''))
              for (const tc of delta.tool_calls ?? []) {
                const i = tc.index ?? 0
                const entry = calls.get(i) ?? { id: '', name: '', args: '' }
                if (tc.id) entry.id = tc.id
                if (tc.function?.name && !entry.name) entry.name = tc.function.name
                if (tc.function?.arguments) entry.args += tc.function.arguments
                calls.set(i, entry)
              }
            }
            yield* speak(filter.end())
            if (ac.signal.aborted) throw new Error('aborted')

            const made = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}${step}${i}` }))
            history.push({
              role: 'assistant',
              content: stepText || null,
              ...(made.length
                ? { tool_calls: made.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) }
                : {}),
            })
            if (made.length === 0) break

            for (const call of made) {
              let args = {}
              try {
                args = call.args ? JSON.parse(call.args) : {}
              } catch {
                args = {}
              }
              const full = tools.byName.get(call.name)?.full ?? `mcp__unknown__${call.name}`
              yield { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: call.id, name: full } } }
              const { output, isError } = await executeTool(tools, call.name, args, allowWrites)
              yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: call.id, is_error: isError }] } }
              history.push({ role: 'tool', tool_call_id: call.id, content: isError ? `Error: ${output}` : output })
            }
          }
        } catch (err) {
          failure = ac.signal.aborted ? 'aborted' : String(err?.message ?? err)
        }
        current = null
        if (failure !== null) history.length = turnStarts.pop() ?? history.length
        trim()

        if (failure === null) {
          yield { type: 'result', subtype: 'success', result: spoken, total_cost_usd: null }
        } else {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            errors: failure === 'aborted' ? [] : [failure],
            userMessage: failure === 'aborted' ? undefined : openaiReason(failure),
          }
        }
      }
      for (const c of tools.clients) await c.close().catch(() => {})
    }

    const stream = run()
    stream.interrupt = async () => {
      current?.abort()
    }
    stream.close = () => {
      closed = true
      current?.abort()
    }
    return stream
  }
}
