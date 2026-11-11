/**
 * A text-only conversation with a brain, one question at a time.
 *
 * The page talks to a brain over a socket and shows panels. A text channel (the
 * Telegram bot) has no screen, so it just needs: send a question, get one
 * answer back as a string. This wraps any brain with the standard interface
 * (the Gemini and Ollama ones) in exactly that.
 */

export function createTextSession(runQuery, options) {
  const inbox = []
  const waiting = []
  let wake = null
  let closed = false

  async function* prompt() {
    while (!closed) {
      if (!inbox.length) await new Promise((resolve) => (wake = resolve))
      if (closed) return
      const text = inbox.shift()
      if (text === undefined) continue
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    }
  }

  const session = runQuery({ prompt: prompt(), options })
  let streamed = ''

  ;(async () => {
    try {
      for await (const m of session) {
        const delta = m.type === 'stream_event' ? m.event?.delta?.text : undefined
        if (delta) streamed += delta
        if (m.type !== 'result') continue
        const turn = waiting.shift()
        const text = (m.result || streamed || '').trim()
        streamed = ''
        if (m.subtype === 'success') turn?.resolve(text)
        else turn?.reject(new Error(m.userMessage ?? 'That did not work. Please try again.'))
      }
    } catch (err) {
      while (waiting.length) waiting.shift().reject(err)
    } finally {
      closed = true
      while (waiting.length) waiting.shift().reject(new Error('The session ended.'))
    }
  })()

  return {
    /** One question at a time: callers must wait for the answer before asking again. */
    ask(text) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new Error('The session ended.'))
        waiting.push({ resolve, reject })
        inbox.push(text)
        const w = wake
        wake = null
        w?.()
      })
    },
    close() {
      closed = true
      wake?.()
      session.close?.()
    },
  }
}

/** Gemini says it is out of free requests, or too busy. */
const OUT_OF_QUOTA = /free limit|busy right now/i

/**
 * Tries `primary`; if it fails because Gemini is out of free requests or too
 * busy, answers with `fallback` instead and says so. Any other failure, and a
 * failing fallback, report the original problem.
 */
export function withFallback(primary, fallback, note = '\n\n(Answered by the local model: Gemini is out of free requests right now.)') {
  return async (who, text) => {
    try {
      return await primary(who, text)
    } catch (err) {
      if (!OUT_OF_QUOTA.test(String(err?.message ?? err))) throw err
      try {
        return (await fallback(who, text)) + note
      } catch {
        throw err
      }
    }
  }
}
