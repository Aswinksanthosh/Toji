#!/usr/bin/env node
// One-time Google login for Calendar and Gmail (read only).
// Needs ~/.jarvis/google/client.json first. See the setup steps in README-google.md.

import { spawn } from 'node:child_process'
import { GOOGLE_DIR, SCOPES, startLogin } from '../bridge/google.mjs'

function open(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // The URL is printed below either way.
  }
}

try {
  const { url, done } = await startLogin()
  console.log('\nOpening your browser to sign in to Google.')
  console.log('If it does not open, copy this address into Chrome:\n')
  console.log(url + '\n')
  console.log('This asks for READ-ONLY access to:')
  for (const s of SCOPES) console.log('  ' + s.replace('https://www.googleapis.com/auth/', ''))
  open(url)
  await done
  console.log(`\nConnected. Saved to ${GOOGLE_DIR}. Restart Jarvis and ask about your calendar.`)
  process.exit(0)
} catch (err) {
  console.error('\n' + (err?.message ?? err))
  process.exit(1)
}
