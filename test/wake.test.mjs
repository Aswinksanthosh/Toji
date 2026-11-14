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
    'laptop-b': { mac: 'AA:BB:CC:DD:EE:FF', broadcast: '10.0.0.255', agent: '' },
    'laptop-c': { mac: 'aa-bb-cc-dd-ee-00', broadcast: '255.255.255.255', agent: '' },
  })
  assert.deepEqual(knownDevices(join(dir, 'missing.json')), {})
})

test('a device can have an agent address, an agent address alone is enough, and a bad address is dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-dev-'))
  const file = join(dir, 'devices.json')
  writeFileSync(file, JSON.stringify({
    a: { mac: 'AA:BB:CC:DD:EE:FF', agent: 'http://100.1.2.3:8790/' },
    b: { agent: 'https://box.example.ts.net:8790' },
    c: { mac: 'AA:BB:CC:DD:EE:00', agent: 'javascript:alert(1)' },
    d: { agent: 'http://x y' },
  }))
  const d = knownDevices(file)
  assert.equal(d.a.agent, 'http://100.1.2.3:8790')
  assert.deepEqual(d.b, { mac: '', broadcast: '255.255.255.255', agent: 'https://box.example.ts.net:8790' })
  assert.equal(d.c.agent, '')
  assert.equal(d.d, undefined)
})

test('a device can carry an optional theme, only rog or tuf', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const f = join(mkdtempSync(join(tmpdir(), 'dev-')), 'devices.json')
  writeFileSync(f, JSON.stringify({ a: { agent: 'http://100.1.1.1:8790', theme: 'TUF' }, b: { agent: 'http://100.1.1.2:8790', theme: 'neon' }, c: { agent: 'http://100.1.1.3:8790' } }))
  const d = knownDevices(f)
  assert.equal(d.a.theme, 'tuf')
  assert.equal('theme' in d.b, false)
  assert.equal('theme' in d.c, false)
})
