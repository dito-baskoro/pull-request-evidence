import { describe, expect, it } from 'vitest'
import { buildEvidenceRegistry, formatEvidenceKey } from '~/server/utils/analysis/evidence-registry'
import { sha256Hex } from '~/server/utils/hash'
import type { ChangedFile } from '~/types/github'

const OWNER = 'octo'
const REPO = 'demo'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

function changedFile(path: string, patch: string): ChangedFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 0,
    deletions: 0,
    changes: 0,
    patch,
    sha: null,
  }
}

const PATCH_A = [
  '@@ -1,3 +1,5 @@',
  ' context',
  '+added one',
  '+added two',
  ' still context',
  '+added four',
].join('\n')

const PATCH_B = [
  '@@ -1,1 +1,2 @@',
  ' context',
  '+lonely add',
].join('\n')

function build() {
  return buildEvidenceRegistry({
    owner: OWNER,
    repo: REPO,
    headSha: HEAD_SHA,
    files: [
      { file: changedFile('src/a.ts', PATCH_A), patchArtifact: { id: 'artifact-a' } },
      { file: changedFile('src/b.ts', PATCH_B), patchArtifact: { id: 'artifact-b' } },
    ],
  })
}

describe('formatEvidenceKey', () => {
  it('zero-pads to E-NNNNN', () => {
    expect(formatEvidenceKey(1)).toBe('E-00001')
    expect(formatEvidenceKey(124)).toBe('E-00124')
    expect(formatEvidenceKey(99999)).toBe('E-99999')
  })
})

describe('buildEvidenceRegistry', () => {
  it('registers one span per contiguous added run', () => {
    const registry = build()
    // PATCH_A: run [added one, added two] then run [added four] => 2 spans.
    // PATCH_B: [lonely add] => 1 span. Total 3.
    expect(registry.all()).toHaveLength(3)
  })

  it('assigns stable, unique, sequential E-NNNNN keys', () => {
    const registry = build()
    const keys = registry.all().map((e) => e.evidenceKey)
    expect(keys).toEqual(['E-00001', 'E-00002', 'E-00003'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('produces identical keys and permalinks across builds (stability)', () => {
    const a = build().all()
    const b = build().all()
    expect(a.map((e) => e.evidenceKey)).toEqual(b.map((e) => e.evidenceKey))
    expect(a.map((e) => e.permalink)).toEqual(b.map((e) => e.permalink))
  })

  it('binds every span to the immutable head SHA', () => {
    const registry = build()
    for (const e of registry.all()) {
      expect(e.commitSha).toBe(HEAD_SHA)
      expect(e.side).toBe('head')
    }
  })

  it('builds a permalink at the head SHA with correct line ranges', () => {
    const registry = build()
    const first = registry.lookup('E-00001')!
    // Added run [added one, added two] -> head lines 2-3 of src/a.ts.
    expect(first.filePath).toBe('src/a.ts')
    expect(first.startLine).toBe(2)
    expect(first.endLine).toBe(3)
    expect(first.permalink).toBe(
      `https://github.com/${OWNER}/${REPO}/blob/${HEAD_SHA}/src/a.ts#L2-L3`,
    )
    // Single-line run collapses the fragment.
    const second = registry.lookup('E-00002')!
    expect(second.startLine).toBe(5)
    expect(second.endLine).toBe(5)
    expect(second.permalink!.endsWith('/src/a.ts#L5')).toBe(true)
  })

  it('records an excerpt and its hash', () => {
    const registry = build()
    const first = registry.lookup('E-00001')!
    expect(first.excerpt).toBe('added one\nadded two')
    expect(first.excerptHash).toBe(sha256Hex('added one\nadded two'))
  })

  it('exposes a citable manifest and lookup', () => {
    const registry = build()
    const manifest = registry.manifest()
    expect(manifest.map((m) => m.evidenceKey)).toEqual(['E-00001', 'E-00002', 'E-00003'])
    expect(registry.has('E-00002')).toBe(true)
    expect(registry.lookup('E-99999')).toBeNull()
  })
})
