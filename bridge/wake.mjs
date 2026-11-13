/**
 * Wake-on-LAN: send a "magic packet" to a sleeping or off computer on the same
 * network. Only a device on that network can send it, so this runs on a laptop
 * that is awake, or on a small always-on device such as a router, a Raspberry Pi
 * or an old PC. The sleeping laptop cannot wake itself.
 *
 * Devices are named in ~/.jarvis/devices.json, like
 *   { "laptop-b": { "mac": "AA:BB:CC:DD:EE:FF", "broadcast": "10.0.0.255",
 *                  "agent": "http://100.101.102.103:8790" } }
 * ("agent" is the laptop's remote agent address, used by the phone remote buttons.)
 * and nothing outside that file is ever woken.
 */

import { createSocket } from 'node:dgram'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEVICES_FILE = join(homedir(), '.jarvis', 'devices.json')

/** "AA:BB:CC:DD:EE:FF", "aa-bb-..." or "aabbccddeeff" -> 6 bytes, or null. */
export function parseMac(text) {
  const hex = String(text ?? '').trim().replace(/[:-]/g, '')
  return /^[0-9a-fA-F]{12}$/.test(hex) ? Buffer.from(hex, 'hex') : null
}

/** 6 bytes of 0xFF, then the MAC address 16 times: 102 bytes. */
export function magicPacket(mac) {
  const bytes = Buffer.isBuffer(mac) ? mac : parseMac(mac)
  if (!bytes || bytes.length !== 6) throw new Error('That is not a valid MAC address.')
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)])
}

/** A plain IPv4 address, for the broadcast address. */
const isIPv4 = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((n) => Number(n) <= 255)

/** The devices you named, as { name: { mac, broadcast, agent } }. Bad entries are skipped. */
export function knownDevices(file = DEVICES_FILE) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const out = {}
    for (const [name, d] of Object.entries(raw)) {
      const agent = String(d?.agent ?? '').trim().replace(/\/$/, '')
      const goodAgent = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(agent) ? agent : ''
      const goodMac = Boolean(parseMac(d?.mac))
      if (!goodMac && !goodAgent) continue
      out[name.toLowerCase().trim()] = {
        mac: goodMac ? String(d.mac).trim() : '',
        broadcast: isIPv4(String(d?.broadcast ?? '')) ? d.broadcast : '255.255.255.255',
        agent: goodAgent,
      }
    }
    return out
  } catch {
    return {}
  }
}

function sendUdp(packet, address, port) {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    socket.once('error', (err) => {
      socket.close()
      reject(err)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(packet, port, address, (err) => {
        socket.close()
        err ? reject(err) : resolve()
      })
    })
  })
}

/** Sends the packet to ports 9 and 7, the two most common. */
export async function sendMagicPacket(mac, { broadcast = '255.255.255.255', send = sendUdp } = {}) {
  const packet = magicPacket(mac)
  await send(packet, broadcast, 9)
  await send(packet, broadcast, 7)
}
