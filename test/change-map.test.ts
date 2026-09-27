import { describe, expect, it } from 'vitest'
import { associateSourceAndTests, buildChangeMap } from '~/server/utils/analysis/change-map'
import type { ChangedFile } from '~/types/github'

function file(path: string, additions = 1, deletions = 0): ChangedFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions,
    deletions,
    changes: additions + deletions,
    patch: `@@ -1,1 +1,${additions + 1} @@\n context\n${'+add\n'.repeat(additions)}`,
    sha: null,
  }
}

describe('buildChangeMap', () => {
  const map = buildChangeMap([
    file('src/user.ts', 10, 2),
    file('src/user.test.ts', 5, 0),
    file('package-lock.json', 200, 100),
    file('supabase/migrations/0002_x.sql', 3, 0),
    file('README.md', 4, 1),
  ])

  it('counts files by category', () => {
    expect(map.totalsByClass.production_source?.files).toBe(1)
    expect(map.totalsByClass.test?.files).toBe(1)
    expect(map.totalsByClass.lockfile?.files).toBe(1)
    expect(map.totalsByClass.migration?.files).toBe(1)
    expect(map.totalsByClass.documentation?.files).toBe(1)
  })

  it('aggregates additions/deletions per category', () => {
    expect(map.totalsByClass.production_source).toMatchObject({ additions: 10, deletions: 2 })
  })

  it('excludes lockfiles with a visible reason', () => {
    const lock = map.entries.find((e) => e.path === 'package-lock.json')
    expect(lock?.disposition).toBe('excluded')
    expect(lock?.dispositionReason).toContain('lockfile')
    expect(map.excludedCount).toBe(1)
  })

  it('lists source and test files separately', () => {
    expect(map.sourceFiles).toEqual(['src/user.ts'])
    expect(map.testFiles).toEqual(['src/user.test.ts'])
  })

  it('produces a candidate source-to-test association', () => {
    expect(map.candidateTestAssociations).toHaveLength(1)
    const assoc = map.candidateTestAssociations[0]
    expect(assoc.sourcePath).toBe('src/user.ts')
    expect(assoc.testPath).toBe('src/user.test.ts')
    // Coverage must never be asserted as proven.
    expect(assoc.isProofOfCoverage).toBe(false)
    expect(assoc.reason.toLowerCase()).toContain('not proof of coverage')
  })
})

describe('associateSourceAndTests', () => {
  it('matches same-directory foo.ts <-> foo.test.ts', () => {
    const assoc = associateSourceAndTests(['src/foo.ts'], ['src/foo.test.ts'])
    expect(assoc).toHaveLength(1)
    expect(assoc[0].reason).toContain('Same directory')
  })

  it('matches src/foo.ts <-> test/foo.test.ts across directories', () => {
    const assoc = associateSourceAndTests(['src/foo.ts'], ['test/foo.test.ts'])
    expect(assoc).toHaveLength(1)
    expect(assoc[0].reason).toContain('across directories')
  })

  it('does not match unrelated names', () => {
    const assoc = associateSourceAndTests(['src/foo.ts'], ['test/bar.test.ts'])
    expect(assoc).toHaveLength(0)
  })

  it('marks every association as not proof of coverage', () => {
    const assoc = associateSourceAndTests(['a.ts', 'b.ts'], ['a.test.ts', 'b.spec.ts'])
    expect(assoc).toHaveLength(2)
    for (const a of assoc) expect(a.isProofOfCoverage).toBe(false)
  })
})
