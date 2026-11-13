// Wake-on-LAN: the packet itself, the device list, and the tool that sends it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knownDevices, magicPacket, parseMac, sendMagicPacket } from '../bridge/wake.mjs'

test('MAC addresses are accepted in the usual spellings and nothing else', () => {
  for (const ok of ['AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'aabbccddeeff', ' 00:1a:2B:3c:4D:5e ']) {
    assert.equal(parseMac(ok)?.length, 6, ok)
  }
  for (const bad of ['', 'AA:BB:CC:DD:EE', 'AA:BB:CC:DD:EE:FF:00', 'GG:BB:CC:DD:EE:FF', '10.0.0.5', undefined, null, 'calc.exe']) {
    assert.equal(parseMac(bad), null, String(bad))
  }
})

test('the magic packet is six 0xFF bytes then the MAC sixteen times, 102 bytes in all', () => {
  const p = magicPacket('01:02:03:04:05:06')
  assert.equal(p.length, 102)
  assert.deepEqual([...p.subarray(0, 6)], [255, 255, 255, 255, 255, 255])
  for (let i = 0; i < 16; i++) assert.deepEqual([...p.subarray(6 + i * 6, 12 + i * 6)], [1, 2, 3, 4, 5, 6])
  assert.throws(() => magicPacket('not a mac'), /valid MAC/)
})

test('sending uses the broadcast address on ports 9 and 7', async () => {
  const sent = []
  await sendMagicPacket('01:02:03:04:05:06', { broadcast: '10.0.0.255', send: async (packet, address, port) => sent.push([packet.length, address, port]) })
  assert.deepEqual(sent, [[102, '10.0.0.255', 9], [102, '10.0.0.255', 7]])
})

test('the device list keeps good entries, fixes a bad broadcast address, and skips bad MACs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-dev-'))
  const file = join(dir, 'devices.json')
  writeFileSync(file, JSON.stringify({
    'Laptop-B': { mac: 'AA:BB:CC:DD:EE:FF', broadcast: '10.0.0.255' },
    'laptop-c': { mac: 'aa-bb-cc-dd-ee-00', broadcast: 'evil.example.com' },
    broken: { mac: 'nope' },
    empty: {},
  }))
  assert.deepEqual(knownDevices(file), {
    'laptop-b': { mac: 'AA:BB:CC:DD:EE:FF', broadcast: '10.0.0.255' },
    'laptop-c': { mac: 'aa-bb-cc-dd-ee-00', broadcast: '255.255.255.255' },
  })
  assert.deepEqual(knownDevices(join(dir, 'missing.json')), {})
})
