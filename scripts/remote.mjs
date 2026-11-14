#!/usr/bin/env node
// Phone remote buttons. No AI. Run on each laptop (agent + hub) and/or on an always-on device (hub).
//   JARVIS_AGENT_TOKEN      (24+ chars) lets this machine act as an agent, and the hub talk to agents
//   JARVIS_REMOTE_PASSWORD  (12+ chars) serves the phone page (the hub)
// Devices come from ~/.jarvis/devices.json, games from ~/.jarvis/games.json.
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { httpForward, httpInfo, httpPing, startAgent, startHub } from '../bridge/remote.mjs'
import { createRemoteActions } from '../bridge/remote-actions.mjs'
import { knownDevices, sendMagicPacket } from '../bridge/wake.mjs'

const password = process.env.JARVIS_REMOTE_PASSWORD ?? ''
const token = process.env.JARVIS_AGENT_TOKEN ?? ''
const agentPort = Number(process.env.JARVIS_AGENT_PORT ?? 8790)
const hubPort = Number(process.env.JARVIS_REMOTE_PORT ?? 8791)

if (!password && !token) {
  console.error('Set JARVIS_REMOTE_PASSWORD (the phone page) and/or JARVIS_AGENT_TOKEN (this laptop acts on requests). Run Setup-Remote.cmd.')
  process.exit(1)
}
if (password && password.length < 12) {
  console.error('JARVIS_REMOTE_PASSWORD must be at least 12 characters.')
  process.exit(1)
}
if (token && token.length < 24) {
  console.error('JARVIS_AGENT_TOKEN must be at least 24 characters.')
  process.exit(1)
}

const addresses = (port) =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`)
    .join('  or  ')

if (token) {
  // Only a laptop does the things, so only then load the code that can.
  const { knownGames, runDesktop, runLaunch, steamGameUrl } = await import('../bridge/local.mjs')
  const actions = createRemoteActions({
    root: join(dirname(fileURLToPath(import.meta.url)), '..'),
    launch: (target) => runLaunch(target),
    desktop: (action) => runDesktop(action),
    games: () => Object.keys(knownGames()),
    gameUrl: (name) => steamGameUrl(name),
  })
  await startAgent({ token, port: agentPort, run: (action, { arg }) => actions.run(action, arg), info: actions.info })
  console.log(`[remote] agent ready on port ${agentPort}: this laptop can open Steam, start games, media keys, apps, restart, lock and more.`)
}

if (password) {
  const { knownGames } = await import('../bridge/local.mjs').catch(() => ({ knownGames: () => ({}) }))
  await startHub({
    password,
    port: hubPort,
    getDevices: () => knownDevices(),
    getGames: () => Object.keys(knownGames()),
    wake: (device) => sendMagicPacket(device.mac, { broadcast: device.broadcast }),
    forward: token ? httpForward(token) : async () => { throw new Error('No agent token is set on this hub.') },
    ping: token ? httpPing(token) : async () => false,
    info: token ? httpInfo(token) : undefined,
  })
  console.log(`[remote] phone page on, password protected. On your phone open: ${addresses(hubPort) || `port ${hubPort}`}`)
}
