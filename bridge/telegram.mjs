/**
 * Prompt Jarvis from your phone through a private Telegram bot.
 *
 * Nothing is exposed: this program calls out to Telegram and asks "any new
 * messages?", so no port on your laptop is opened. Only the Telegram account
 * IDs you list are answered. Everyone else is ignored, except that anyone can
 * ask the bot for their own ID, which is how you find yours.
 *
 * Telegram bot chats are not end-to-end encrypted, so treat what you send as
 * visible to Telegram. The laptop must be on with Jarvis running.
 */

const MAX_MESSAGE = 4000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Splits on line or word boundaries so no message exceeds Telegram's limit. */
export function chunkText(text, max = MAX_MESSAGE) {
  const out = []
  let rest = String(text ?? '').trim()
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max)
    if (cut < max / 2) cut = max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

export function startTelegram({
  token,
  allowed,
  ask,
  fetchFn = globalThis.fetch,
  log = console.log,
  pollSeconds = 30,
  retryMs = 5000,
}) {
  const controller = new AbortController()
  let offset = 0

  async function api(method, body) {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.ok) throw new Error(json.description ?? 'Telegram error')
    return json.result
  }

  const send = async (chat, text) => {
    for (const part of chunkText(text) || []) await api('sendMessage', { chat_id: chat, text: part })
  }

  async function handle(update) {
    const m = update.message
    if (!m?.text || m.chat?.type !== 'private') return
    const id = String(m.from?.id ?? '')
    const chat = m.chat.id

    if (!allowed.has(id)) {
      if (/^\/(start|id)\b/.test(m.text)) {
        await send(chat, `This is a private bot. Your Telegram ID is ${id}. The owner can add it to JARVIS_TELEGRAM_ALLOWED to let you in.`)
      }
      return
    }
    if (/^\/start\b/.test(m.text)) return send(chat, 'Jarvis here. Ask me anything.')

    const typing = () => api('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {})
    void typing()
    const timer = setInterval(typing, 4000)
    try {
      const answer = await ask(id, m.text)
      await send(chat, answer || 'I have nothing to say to that.')
    } catch (err) {
      await send(chat, `Sorry, that did not work: ${String(err?.message ?? err).slice(0, 200)}`)
    } finally {
      clearInterval(timer)
    }
  }

  const done = (async () => {
    while (!controller.signal.aborted) {
      try {
        const updates = await api('getUpdates', { offset, timeout: pollSeconds, allowed_updates: ['message'] })
        for (const update of updates) {
          offset = update.update_id + 1
          await handle(update).catch((err) => log('[jarvis] telegram: could not answer:', err?.message ?? err))
        }
      } catch (err) {
        if (controller.signal.aborted) break
        log('[jarvis] telegram: connection problem, retrying:', err?.message ?? err)
        await sleep(retryMs)
      }
    }
  })()

  return { stop: () => controller.abort(), done }
}
