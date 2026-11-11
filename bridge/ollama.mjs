/**
 * The local brain: a model running on this machine through Ollama.
 *
 * Same interface as the Gemini and Claude brains, so the page, the memory
 * tools, the files and the permission gate work unchanged. Nothing leaves your
 * laptop. Choose it with JARVIS_BRAIN=ollama.
 *
 * Small models are weaker at using tools than the big cloud ones, so keep the
 * tool list short (JARVIS_DISABLE=interface,camera,browser) and the model
 * sensible for your graphics card.
 */

import { connectTools, executeTool, userText } from './gemini.mjs'

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434'
/** About 2.5 GB. Fits a laptop graphics card with room to spare. */
export const OLLAMA_DEFAULT_MODEL = 'qwen3:4b'

const MAX_TURNS_KEPT = 8

/** A sentence safe to speak aloud for the failures people actually hit. */
export function ollamaReason(text) {
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(text)) {
    return 'I cannot reach Ollama. Check that it is running.'
  }
  if (/not found|pull/i.test(text)) {
    return 'That model is not installed. Run ollama pull with the model name.'
  }
  return undefined
}

/** Streaming remover for complete <think>...</think> blocks. */
function tagFilter() {
  let inThink = false
  let held = ''
  return (chunk) => {
    let text = held + chunk
    held = ''
    let out = ''
    for (;;) {
      if (inThink) {
        const end = text.indexOf('</think>')
        if (end === -1) {
          // Keep a possible partial closing tag for the next chunk.
          held = text.slice(Math.max(0, text.length - 7))
          return out
        }
        text = text.slice(end + 8)
        inThink = false
      } else {
        const start = text.indexOf('<think>')
        if (start === -1) {
          // A trailing "<thi" might be the start of a tag; hold it back.
          const lt = text.lastIndexOf('<')
          if (lt !== -1 && '<think>'.startsWith(text.slice(lt)) && text.length - lt < 7) {
            held = text.slice(lt)
            return out + text.slice(0, lt)
          }
          return out + text
        }
        out += text.slice(0, start)
        text = text.slice(start + 7)
        inThink = true
      }
    }
  }
}

/** How much text is held back while deciding whether it is reasoning. */
const HOLD_CHARS = 4000

/**
 * Keeps a model's reasoning off the screen and out of the speaker.
 *
 * Some models write reasoning and then a closing </think> with NO opening tag,
 * because the template already opened it. So the start of an answer cannot be
 * trusted until either a </think> arrives (everything before it is reasoning
 * and is dropped) or enough text has passed without one (it was just an answer).
 * Jarvis answers are short, so holding the first few thousand characters costs
 * very little. Call push() per chunk and end() when the stream finishes.
 */
export function thinkFilter({ holdChars = HOLD_CHARS } = {}) {
  const tag = tagFilter()
  let buf = ''
  let deciding = true
  return {
    push(chunk) {
      if (!deciding) return tag(chunk)
      buf += chunk
      const close = buf.indexOf('</think>')
      if (close !== -1) {
        // A normal <think>...</think> pair keeps the words around it. A closing
        // tag on its own means everything before it was reasoning.
        const open = buf.indexOf('<think>')
        const out = open !== -1 && open < close ? tag(buf) : tag(buf.slice(close + 8))
        buf = ''
        deciding = false
        return out
      }
      // An opened block that has not closed yet: keep holding, however long.
      if (buf.includes('<think>')) return ''
      if (buf.length >= holdChars) {
        const out = tag(buf)
        buf = ''
        deciding = false
        return out
      }
      return ''
    },
    end() {
      if (!deciding) return ''
      deciding = false
      if (buf.includes('<think>')) return ''
      const out = tag(buf)
      buf = ''
      return out
    },
  }
}

/** Reads a streamed response as one JSON object per line. */
async function* ndjson(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) yield JSON.parse(line)
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer)
}

export function createOllamaQuery({
  model = OLLAMA_DEFAULT_MODEL,
  url = OLLAMA_DEFAULT_URL,
  allowWrites = false,
  fetchFn = globalThis.fetch,
  // Thinking models write hundreds of lines of reasoning before answering, which
  // a voice assistant cannot afford. Off unless JARVIS_OLLAMA_THINK=1.
  think = process.env.JARVIS_OLLAMA_THINK === '1',
}) {
  return function ollamaQuery({ prompt, options = {} }) {
    const maxSteps = options.maxTurns ?? 12
    let closed = false
    let current = null
    let tools = null
    const history = []
    const turnStarts = []

    const trim = () => {
      while (turnStarts.length > MAX_TURNS_KEPT) {
        const cut = turnStarts[1] ?? history.length
        history.splice(0, cut)
        turnStarts.shift()
        for (let i = 0; i < turnStarts.length; i++) turnStarts[i] -= cut
      }
    }

    // Qwen3 models obey a soft switch in the prompt even when the setting is ignored.
    const systemText =
      (options.systemPrompt ?? '') + (!think && /qwen3/i.test(model) ? '\n/no_think' : '')

    async function* run() {
      tools = await connectTools(options.mcpServers)
      const toolList = tools.declarations.map((d) => ({
        type: 'function',
        function: { name: d.name, description: d.description, parameters: d.parametersJsonSchema },
      }))
      if (tools.skipped) {
        console.log(`[jarvis] ollama: ${tools.skipped} configured MCP server(s) are not available yet`)
      }
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
            const request = (withThink) =>
              fetchFn(`${url}/api/chat`, {
                method: 'POST',
                signal: ac.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  model,
                  stream: true,
                  messages: [{ role: 'system', content: systemText }, ...history],
                  ...(toolList.length ? { tools: toolList } : {}),
                  ...(withThink ? { think: false } : {}),
                }),
              })
            let res = await request(!think)
            let failedText = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200)
            // Models that cannot think reject the setting; ask again without it.
            if (!res.ok && res.status === 400 && /think/i.test(failedText)) {
              res = await request(false)
              failedText = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200)
            }
            if (!res.ok) throw new Error(`Ollama ${res.status}: ${failedText}`)

            const filter = thinkFilter()
            let stepText = ''
            const calls = []
            for await (const part of ndjson(res.body)) {
              if (ac.signal.aborted) throw new Error('aborted')
              if (part.error) throw new Error(String(part.error))
              const delta = filter.push(part.message?.content ?? '')
              if (delta) {
                stepText += delta
                spoken += delta
                yield {
                  type: 'stream_event',
                  event: { type: 'content_block_delta', delta: { type: 'text_delta', text: delta } },
                }
              }
              for (const c of part.message?.tool_calls ?? []) calls.push(c.function ?? c)
            }
            const tail = filter.end()
            if (tail) {
              stepText += tail
              spoken += tail
              yield {
                type: 'stream_event',
                event: { type: 'content_block_delta', delta: { type: 'text_delta', text: tail } },
              }
            }
            if (ac.signal.aborted) throw new Error('aborted')

            history.push({
              role: 'assistant',
              content: stepText,
              ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments ?? {} } })) } : {}),
            })
            if (calls.length === 0) break

            for (const [i, call] of calls.entries()) {
              const id = `o${Date.now().toString(36)}${step}${i}`
              let args = call.arguments ?? {}
              if (typeof args === 'string') {
                try {
                  args = JSON.parse(args)
                } catch {
                  args = {}
                }
              }
              const full = tools.byName.get(call.name)?.full ?? `mcp__unknown__${call.name}`
              yield {
                type: 'stream_event',
                event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name: full } },
              }
              const { output, isError } = await executeTool(tools, call.name, args, allowWrites)
              yield {
                type: 'user',
                message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
              }
              history.push({ role: 'tool', tool_name: call.name, content: isError ? `Error: ${output}` : output })
            }
          }
        } catch (err) {
          failure = ac.signal.aborted ? 'aborted' : String(err?.message ?? err)
        }
        current = null
        if (failure !== null) history.length = turnStarts.pop() ?? history.length
        trim()

        if (failure === null) {
          yield { type: 'result', subtype: 'success', result: spoken, total_cost_usd: 0 }
        } else {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            errors: failure === 'aborted' ? [] : [failure],
            userMessage: failure === 'aborted' ? undefined : ollamaReason(failure),
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
