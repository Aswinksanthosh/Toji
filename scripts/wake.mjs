#!/usr/bin/env node
// Wake a computer on this network. Run it on an awake laptop or an always-on device.
//   node scripts/wake.mjs laptop-b          (a name from ~/.jarvis/devices.json)
//   node scripts/wake.mjs AA:BB:CC:DD:EE:FF [broadcast-address]
import { knownDevices, parseMac, sendMagicPacket } from '../bridge/wake.mjs'

const [target, broadcast] = process.argv.slice(2)
if (!target) {
  console.error('Usage: node scripts/wake.mjs <device-name | MAC> [broadcast-address]')
  process.exit(1)
}
const device = knownDevices()[target.toLowerCase()] ?? (parseMac(target) ? { mac: target, broadcast: broadcast ?? '255.255.255.255' } : null)
if (!device) {
  console.error(`"${target}" is not in devices.json and is not a MAC address.`)
  process.exit(1)
}
await sendMagicPacket(device.mac, { broadcast: device.broadcast })
console.log(`Sent a wake-up signal to ${device.mac} via ${device.broadcast}. It can take 10 to 30 seconds to start.`)
