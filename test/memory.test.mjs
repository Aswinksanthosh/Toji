// Persistent memory: notes in a capped file, every exchange in a searchable log.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CORE_MAX_CHARS,
  addNote,
  logTurn,
  memoryPrompt,
  readNotes,
  removeNote,
  searchLog,
} from '../bridge/memory.mjs'
import { decideTool } from '../bridge/policy.mjs'

const fresh = () => mkdtempSync(join(tmpdir(), 'jarvis-mem-'))

test('remember saves a note and it survives a reload', () => {
  const dir = fresh()
  assert.equal(addNote(dir, 'My name is Sam').ok, true)
  assert.deepEqual(readNotes(dir), ['My name is Sam'])
})

test('a duplicate note is not stored twice', () => {
  const dir = fresh()
  addNote(dir, 'I like short answers')
  addNote(dir, 'i like short answers')
  assert.equal(readNotes(dir).length, 1)
})

test('empty notes are refused', () => {
  assert.equal(addNote(fresh(), '   ').ok, false)
})

test('the core file is capped, so it cannot grow the prompt forever', () => {
  const dir = fresh()
  const long = 'x'.repeat(390)
  let refused = false
  for (let i = 0; i < Math.ceil(CORE_MAX_CHARS / 390) + 3; i++) {
    if (!addNote(dir, `${i} ${long}`).ok) refused = true
  }
  assert.equal(refused, true)
  assert.ok(readNotes(dir).join('\n').length <= CORE_MAX_CHARS)
})

test('forget removes exactly one note, and refuses an ambiguous match', () => {
  const dir = fresh()
  addNote(dir, 'My favourite colour is blue')
  addNote(dir, 'My favourite food is rice')
  assert.equal(removeNote(dir, 'favourite').ok, false)
  assert.equal(readNotes(dir).length, 2)
  assert.equal(removeNote(dir, 'colour').ok, true)
  assert.deepEqual(readNotes(dir), ['My favourite food is rice'])
  assert.equal(removeNote(dir, 'nothing like this').ok, false)
})

test('recall finds past exchanges, newest first, and needs every word', () => {
  const dir = fresh()
  logTurn(dir, 'user', 'Plan my trip to Kochi next week')
  logTurn(dir, 'jarvis', 'Kochi trip noted.')
  logTurn(dir, 'user', 'What is the weather')
  const hits = searchLog(dir, 'kochi trip')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].role, 'jarvis')
  assert.equal(searchLog(dir, 'kochi weather').length, 0)
})

test('recall on an empty log returns nothing rather than failing', () => {
  assert.deepEqual(searchLog(fresh(), 'anything'), [])
})

test('the prompt carries the saved notes', () => {
  const dir = fresh()
  assert.match(memoryPrompt(dir), /none yet/)
  addNote(dir, 'Keep answers short')
  assert.match(memoryPrompt(dir), /- Keep answers short/)
})

test('memory tools are allowed without writes mode, and only for this server', () => {
  assert.equal(decideTool('mcp__jarvis_memory__remember', false), true)
  assert.equal(decideTool('mcp__jarvis_memory__forget', false), true)
  assert.equal(decideTool('mcp__someone_else__remember', false), false)
})
