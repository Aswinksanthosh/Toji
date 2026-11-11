#!/usr/bin/env node
// Lists the Gemini models your key can use for chat, so you can pick one with
// JARVIS_GEMINI_MODEL. Changes nothing. Needs GEMINI_API_KEY in this window.

import { GoogleGenAI } from '@google/genai'

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
if (!key) {
  console.error('Set GEMINI_API_KEY first. Create a free key at https://aistudio.google.com')
  process.exit(1)
}

const ai = new GoogleGenAI({
  apiKey: key,
  apiVersion: process.env.JARVIS_GEMINI_API_VERSION || 'v1beta',
})

try {
  const pager = await ai.models.list({ config: { pageSize: 100 } })
  const names = []
  for await (const m of pager) {
    if ((m.supportedActions ?? []).includes('generateContent')) {
      names.push(m.name?.replace(/^models\//, ''))
    }
  }
  names.sort()
  console.log(`Models you can use (${names.length}). Pick one, then run:\n`)
  console.log('  $env:JARVIS_GEMINI_MODEL="<name>"; npm start\n')
  for (const n of names) console.log('  ' + n)
} catch (err) {
  console.error('Could not list models:', err?.message ?? err)
  process.exit(1)
}
