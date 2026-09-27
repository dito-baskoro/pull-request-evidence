// Deterministic change map (plan sections 4 and 9; Milestone 4).
//
// Builds a change map from changed-file metadata + classifications: counts by
// category, additions/deletions, source vs test lists, and CANDIDATE
// source<->test associations. A candidate association is a heuristic hint only
// and is NEVER proof of coverage; this is encoded in the type/field names and
// must be honored by any user-facing text.
//
// Pure function, no I/O; independent of AI and persistence.

import type { ChangedFile } from '~/types/github'
import type { ChangeMap, ChangeMapEntry, FileClass } from '~/types/analysis'
import { classifyFile } from './classify-file'

/**
 * A heuristic pairing of a source file to a likely test file. This is a
 * CANDIDATE only: a match here does not prove the source is tested or covered.
 * The field naming (`candidate`, `isProofOfCoverage: false`) is deliberate so
 * downstream code and UI cannot accidentally present it as proven coverage.
 */
export interface CandidateTestAssociation {
  sourcePath: string
  testPath: string
  /** Explainable reason the heuristic paired these files. */
  reason: string
  /** Always false: a heuristic pairing never proves coverage (plan section 9). */
  readonly isProofOfCoverage: false
}

export interface DeterministicChangeMap extends ChangeMap {
  sourceFiles: string[]
  testFiles: string[]
  candidateTestAssociations: CandidateTestAssociation[]
}

/** Classes that are excluded from the model context by default. */
const EXCLUDED_BY_DEFAULT: ReadonlySet<FileClass> = new Set<FileClass>([
  'lockfile',
  'generated',
  'binary_unsupported',
])

/** Classes that are summarized rather than sent verbatim. */
const SUMMARIZED_BY_DEFAULT: ReadonlySet<FileClass> = new Set<FileClass>([
  'dependency_manifest',
])

export function buildChangeMap(files: ChangedFile[]): DeterministicChangeMap {
  const entries: ChangeMapEntry[] = []
  const totalsByClass: DeterministicChangeMap['totalsByClass'] = {}
  const sourceFiles: string[] = []
  const testFiles: string[] = []
  let excludedCount = 0

  for (const file of files) {
    const { category, reason } = classifyFile(file.path)

    let disposition: ChangeMapEntry['disposition'] = 'included'
    let dispositionReason: string | null = null
    if (EXCLUDED_BY_DEFAULT.has(category)) {
      disposition = 'excluded'
      dispositionReason = reason
      excludedCount += 1
    }
    else if (SUMMARIZED_BY_DEFAULT.has(category)) {
      disposition = 'summarized'
      dispositionReason = reason
    }

    entries.push({
      path: file.path,
      previousPath: file.previousPath,
      fileClass: category,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      disposition,
      dispositionReason,
    })

    const bucket = totalsByClass[category] ?? { files: 0, additions: 0, deletions: 0 }
    bucket.files += 1
    bucket.additions += file.additions
    bucket.deletions += file.deletions
    totalsByClass[category] = bucket

    if (category === 'production_source') sourceFiles.push(file.path)
    if (category === 'test') testFiles.push(file.path)
  }

  const candidateTestAssociations = associateSourceAndTests(sourceFiles, testFiles)

  return {
    entries,
    totalsByClass,
    excludedCount,
    sourceFiles,
    testFiles,
    candidateTestAssociations,
  }
}

/**
 * Pair source files with likely test files using explainable heuristics:
 *   - `foo.ts`      <-> `foo.test.ts` / `foo.spec.ts` (same directory)
 *   - `src/foo.ts`  <-> `test/foo.test.ts` (shared base name across dirs)
 *   - `foo.ts`      <-> `__tests__/foo.test.ts`
 *
 * Every returned association is a CANDIDATE (isProofOfCoverage: false).
 */
export function associateSourceAndTests(
  sourceFiles: string[],
  testFiles: string[],
): CandidateTestAssociation[] {
  const associations: CandidateTestAssociation[] = []
  const seen = new Set<string>()

  for (const source of sourceFiles) {
    const sourceStem = stemOf(source)
    const sourceDir = dirOf(source)

    for (const test of testFiles) {
      const testStem = testStemOf(test)
      if (testStem !== sourceStem) continue

      const key = `${source}\u0000${test}`
      if (seen.has(key)) continue

      let reason: string
      if (dirOf(test) === sourceDir) {
        reason = `Same directory and base name (${sourceStem}); candidate only, not proof of coverage`
      }
      else {
        reason = `Shared base name (${sourceStem}) across directories; candidate only, not proof of coverage`
      }

      seen.add(key)
      associations.push({
        sourcePath: source,
        testPath: test,
        reason,
        isProofOfCoverage: false,
      })
    }
  }

  return associations
}

/** Base name without directory or final extension. */
function stemOf(path: string): string {
  const base = baseName(path)
  const dot = base.indexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

/**
 * Base name of a test file with the `.test`/`.spec` marker and extension
 * stripped, so `foo.test.ts` -> `foo` and `foo.spec.tsx` -> `foo`.
 */
function testStemOf(path: string): string {
  const base = baseName(path)
  const stripped = base.replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '')
  if (stripped !== base) return stripped
  // Fall back to the plain stem (e.g. a file in a __tests__ dir named foo.ts).
  const dot = base.indexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

function baseName(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = clean.lastIndexOf('/')
  return slash === -1 ? clean : clean.slice(slash + 1)
}

function dirOf(path: string): string {
  const clean = path.replace(/\\/g, '/')
  const slash = clean.lastIndexOf('/')
  return slash === -1 ? '' : clean.slice(0, slash)
}
