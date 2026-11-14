// The project is cloned on Windows laptops: every path in it must be a valid Windows path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('no file in the project has a path that Windows cannot create', (t) => {
  let files
  try {
    files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    t.skip('git is not available here')
    return
  }
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  const bad = files.filter((f) => f.split('/').some((part) => /[:*?"<>|\\]/.test(part) || /[. ]$/.test(part) || reserved.test(part)))
  assert.deepEqual(bad, [])
})
