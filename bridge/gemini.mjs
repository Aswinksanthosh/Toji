/**
 * The Gemini brain.
 *
 * The bridge talks to its brain through one narrow interface: an async stream
 * of messages (a `system` init, `stream_event` text deltas, `tool_use` and
 * `tool_result` blocks, one `result` per turn) plus `interrupt()` and
 * `close()`. This module speaks that same interface using Google's Gemini API,
 * so the page, the display, the memory tools and the permission gate all work
 * unchanged. Choose it with JARVIS_BRAIN=gemini.
 *
 * Tools: every in-process MCP server the bridge builds (display, interface,
 * memory, camera, browser) is connected over an in-memory transport and handed
 * to Gemini as function declarations. Each call is checked with decideTool
 * first, exactly as the Claude path does, so read-only mode still means
 * read-only.
 *
 * Not here yet: the shell and file tools, and MCP servers from ~/.claude.json
 * or your claude.ai account. Those need their own work for Gemini.
 */

import { GoogleGenAI } from '@google/genai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { decideTool } from './policy.mjs'

/** An alias that tracks Google's current fast model. Override with JARVIS_GEMINI_MODEL. */
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'

/** Past this many recent turns, older ones are dropped, so cost cannot creep up. */
const MAX_TURNS_KEPT = 12
const MAX_TOOL_NAME = 64

const REFUSED =
  'Blocked: this action is not allowed in read-only mode. Tell the user it is ' +
  'unavailable until they enable write access on the machine.'

/** Gemini rejects some JSON Schema keywords the MCP SDK emits. */
export function cleanSchema(schema) {
  if (Array.isArray(schema)) return schema.map(cleanSchema)
  if (schema && typeof schema === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$schema' || k === 'additionalProperties') continue
      out[k] = cleanSchema(v)
    }
    return out
  }
  return schema
}

/** Gemini function names: letters, digits, underscore, dot, dash; max 64. */
const safeName = (s) => s.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, MAX_TOOL_NAME)

/** Connects each in-process server and returns what Gemini can call. */
export async function connectTools(mcpServers) {
  const clients = []
  const byName = new Map()
  const declarations = []
  const servers = []
  let skipped = 0

  for (const [key, server] of Object.entries(mcpServers ?? {})) {
    if (!server || server.type !== 'sdk' || !server.instance) {
      skipped++
      continue
    }
    try {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      await server.instance.connect(serverSide)
      const client = new Client({ name: 'jarvis-gemini', version: '1.0.0' })
      await client.connect(clientSide)
      clients.push(client)
      servers.push(key)
      const { tools } = await client.listTools()
      for (const t of tools) {
        let name = safeName(`${key}__${t.name}`)
        while (byName.has(name)) name = safeName(`${name}_`)
        byName.set(name, { client, tool: t.name, full: `mcp__${key}__${t.name}` })
        declarations.push({
          name,
          description: t.description ?? '',
          parametersJsonSchema: cleanSchema(t.inputSchema ?? { type: 'object', properties: {} }),
        })
      }
    } catch (err) {
      console.warn(`[jarvis] gemini: could not connect the ${key} tools:`, err?.message ?? err)
    }
  }
  return { clients, byName, declarations, servers, skipped }
}

/** A sentence safe to speak aloud for the failures people actually hit. */
function plainReason(text) {
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|\b40[13]\b/i.test(text)) {
    return 'The Gemini key was not accepted. Check GEMINI_API_KEY.'
  }
  if (/NOT_FOUND|is not found|\b404\b/i.test(text)) {
    return 'That Gemini model was not found. Run npm run gemini:models to see the available ones.'
  }
  if (/quota|RESOURCE_EXHAUSTED|\b429\b/i.test(text)) {
    return 'The Gemini free limit has been reached for now. Try again later.'
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|network/i.test(text)) {
    return 'I cannot reach Gemini. Check the internet connection.'
  }
  return undefined
}

/** The bridge sends the Claude SDK's message shape; a plain string is accepted too. */
export function userText(msg) {
  if (typeof msg === 'string') return msg
  const content = msg?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
  }
  return ''
}

/** Turns an MCP tool result into text for Gemini, plus any images to attach. */
export function flattenResult(result) {
  const text = []
  const images = []
  for (const block of result?.content ?? []) {
    if (block.type === 'text') text.push(block.text)
    else if (block.type === 'image' && block.data) {
      images.push({ inlineData: { mimeType: block.mimeType ?? 'image/png', data: block.data } })
    }
  }
  return { text: text.join('\n') || (result?.isError ? 'The tool failed.' : 'Done.'), images }
}

/**
 * Runs one tool call the model asked for, behind the permission gate.
 * Shared by every brain, so read-only mode means the same thing for all of them.
 */
export async function executeTool(tools, name, args, allowWrites) {
  const entry = tools.byName.get(name)
  const full = entry?.full ?? `mcp__unknown__${name}`
  if (!entry) return { full, output: 'That tool does not exist.', isError: true, images: [] }
  if (!decideTool(full, allowWrites)) return { full, output: REFUSED, isError: true, images: [] }
  try {
    const result = await entry.client.callTool({ name: entry.tool, arguments: args ?? {} })
    const flat = flattenResult(result)
    return { full, output: flat.text, isError: result?.isError === true, images: flat.images }
  } catch (err) {
    return { full, output: `The tool failed: ${err?.message ?? err}`, isError: true, images: [] }
  }
}

/**
 * Returns a function with the same shape as the Claude SDK's `query`.
 * `client` can be injected for tests.
 */
export function createGeminiQuery({ apiKey, model = GEMINI_DEFAULT_MODEL, allowWrites = false, client }) {
  // The library defaults to the stable v1 API, which does not serve the
  // "-latest" model aliases. v1beta does, and is where new models appear first.
  const ai =
    client ??
    new GoogleGenAI({
      apiKey,
      apiVersion: process.env.JARVIS_GEMINI_API_VERSION || 'v1beta',
    })
  const thinkingBudget = process.env.JARVIS_GEMINI_THINKING_BUDGET

  return function geminiQuery({ prompt, options = {} }) {
    const maxSteps = options.maxTurns ?? 24
    let closed = false
    let current = null // AbortController of the turn in flight
    let tools = null
    /** @type {Array<{role: string, parts: unknown[]}>} */
    const history = []
    const turnStarts = []

    /** Drops the oldest whole turns, so a tool call is never separated from its reply. */
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
      if (tools.skipped) {
        console.log(
          `[jarvis] gemini: ${tools.skipped} configured MCP server(s) are not available to Gemini yet`,
        )
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
        history.push({ role: 'user', parts: [{ text }] })
        let spoken = ''
        let failure = null

        try {
          for (let step = 0; step < maxSteps; step++) {
            const stream = await ai.models.generateContentStream({
              model,
              contents: history,
              config: {
                systemInstruction: options.systemPrompt,
                abortSignal: ac.signal,
                ...(tools.declarations.length
                  ? { tools: [{ functionDeclarations: tools.declarations }] }
                  : {}),
                ...(thinkingBudget !== undefined
                  ? { thinkingConfig: { thinkingBudget: Number(thinkingBudget) } }
                  : {}),
              },
            })

            const modelParts = []
            const calls = []
            for await (const chunk of stream) {
              if (ac.signal.aborted) throw new Error('aborted')
              for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                modelParts.push(part)
                if (part.functionCall) calls.push(part.functionCall)
                else if (part.text && !part.thought) {
                  spoken += part.text
                  yield {
                    type: 'stream_event',
                    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part.text } },
                  }
                }
              }
            }
            if (ac.signal.aborted) throw new Error('aborted')

            if (modelParts.length) history.push({ role: 'model', parts: modelParts })
            if (calls.length === 0) break

            const replies = []
            for (const [i, call] of calls.entries()) {
              const id = `g${Date.now().toString(36)}${step}${i}`
              const full = tools.byName.get(call.name)?.full ?? `mcp__unknown__${call.name}`
              yield {
                type: 'stream_event',
                event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name: full } },
              }
              const { output, isError, images } = await executeTool(tools, call.name, call.args, allowWrites)
              replies.push(...images)
              replies.unshift({
                functionResponse: {
                  name: call.name,
                  response: isError ? { error: output } : { output },
                },
              })
              yield {
                type: 'user',
                message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] },
              }
            }
            history.push({ role: 'user', parts: replies })
          }
        } catch (err) {
          failure = ac.signal.aborted ? 'aborted' : String(err?.message ?? err)
        }
        current = null
        if (failure !== null) {
          // Forget the failed turn entirely. Half a turn, a tool call with no
          // reply, would make every later request invalid.
          history.length = turnStarts.pop() ?? history.length
        }
        trim()

        if (failure === null) {
          yield { type: 'result', subtype: 'success', result: spoken, total_cost_usd: null }
        } else {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            errors: failure === 'aborted' ? [] : [failure],
            userMessage: failure === 'aborted' ? undefined : plainReason(failure),
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
