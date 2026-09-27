// Evidence registry (plan sections 9 and 15; Milestone 3/4).
//
// BEFORE any model call, every permissible source span is registered with an
// opaque, stable ID formatted `E-NNNNN` (zero-padded). The AI may cite only
// these IDs, which prevents it from inventing file paths and line numbers. The
// server (not the model) constructs the GitHub permalink from the immutable
// commit SHA, so a citation always resolves to the exact observed source.
//
// This module is deterministic and provider-independent. It takes already
// persisted artifacts + parsed patches and produces registered spans plus a
// serializable manifest for the model to cite, and a lookup(id) accessor.

import type { Artifact, EvidenceSide, EvidenceSpan } from '~/types/analysis'
import type { ChangedFile } from '~/types/github'
import { addedHeadRuns } from '../patches/map-lines'
import { parsePatch } from '../patches/parse-patch'
import { buildPermalink } from '../github/permalink'
import { sha256Hex } from '../hash'

/** A registered span before it receives a database row id. */
export interface RegisteredEvidence {
  evidenceKey: string
  artifactId: string
  sourceType: string
  commitSha: string
  filePath: string | null
  side: EvidenceSide
  startLine: number | null
  endLine: number | null
  excerpt: string
  excerptHash: string
  permalink: string | null
}

/** A single manifest entry the model is allowed to cite. */
export interface EvidenceManifestEntry {
  evidenceKey: string
  filePath: string | null
  side: EvidenceSide
  startLine: number | null
  endLine: number | null
  excerpt: string
}

export interface RegistrationInput {
  owner: string
  repo: string
  /** Immutable head commit SHA the run is bound to. */
  headSha: string
  /**
   * Changed files whose patches will be turned into head-side evidence spans.
   * Each must have a corresponding persisted `patch` artifact so the span can
   * point at its artifact id.
   */
  files: Array<{ file: ChangedFile; patchArtifact: Pick<Artifact, 'id'> }>
}

const KEY_PREFIX = 'E-'
const KEY_PAD = 5

/** Format a 1-based sequence number as a zero-padded opaque key (E-00001). */
export function formatEvidenceKey(seq: number): string {
  return `${KEY_PREFIX}${String(seq).padStart(KEY_PAD, '0')}`
}

/**
 * A registry over a set of registered spans. Provides stable lookup by key and
 * a citable manifest. Registration order determines the E-NNNNN sequence, so
 * the same inputs always produce the same keys (stability).
 */
export class EvidenceRegistry {
  private readonly byKey = new Map<string, RegisteredEvidence>()
  private seq = 0

  /**
   * Register a head-side span for a contiguous run of added lines. Returns the
   * assigned evidence key. The permalink is built by the server from the
   * immutable SHA, never a branch.
   */
  registerHeadSpan(params: {
    artifactId: string
    owner: string
    repo: string
    commitSha: string
    filePath: string
    startLine: number
    endLine: number
    excerpt: string
    sourceType?: string
  }): string {
    this.seq += 1
    const evidenceKey = formatEvidenceKey(this.seq)
    const permalink = buildPermalink(
      params.owner,
      params.repo,
      params.commitSha,
      params.filePath,
      params.startLine,
      params.endLine,
    )
    const entry: RegisteredEvidence = {
      evidenceKey,
      artifactId: params.artifactId,
      sourceType: params.sourceType ?? 'patch',
      commitSha: params.commitSha,
      filePath: params.filePath,
      side: 'head',
      startLine: params.startLine,
      endLine: params.endLine,
      excerpt: params.excerpt,
      excerptHash: sha256Hex(params.excerpt),
      permalink,
    }
    this.byKey.set(evidenceKey, entry)
    return evidenceKey
  }

  /** Look up a registered span by its opaque key. */
  lookup(evidenceKey: string): RegisteredEvidence | null {
    return this.byKey.get(evidenceKey) ?? null
  }

  /** True when a key exists in this registry. */
  has(evidenceKey: string): boolean {
    return this.byKey.has(evidenceKey)
  }

  /** All registered spans in registration (key) order. */
  all(): RegisteredEvidence[] {
    return [...this.byKey.values()]
  }

  /** A serializable manifest of citable IDs for the model. */
  manifest(): EvidenceManifestEntry[] {
    return this.all().map((e) => ({
      evidenceKey: e.evidenceKey,
      filePath: e.filePath,
      side: e.side,
      startLine: e.startLine,
      endLine: e.endLine,
      excerpt: e.excerpt,
    }))
  }

  /** Rows ready to persist as evidence_spans (minus db-generated id). */
  toEvidenceSpanRows(): Array<Omit<EvidenceSpan, 'id'>> {
    return this.all().map((e) => ({
      artifactId: e.artifactId,
      evidenceKey: e.evidenceKey,
      sourceType: e.sourceType,
      commitSha: e.commitSha,
      filePath: e.filePath,
      side: e.side,
      startLine: e.startLine,
      endLine: e.endLine,
      excerpt: e.excerpt,
      excerptHash: e.excerptHash,
      permalink: e.permalink,
    }))
  }
}

/**
 * Build an evidence registry from changed files by registering one head-side
 * span per contiguous run of added lines. Deterministic: iterating files in the
 * given order and added-runs in file order yields stable E-NNNNN keys.
 */
export function buildEvidenceRegistry(input: RegistrationInput): EvidenceRegistry {
  const registry = new EvidenceRegistry()

  for (const { file, patchArtifact } of input.files) {
    if (!file.patch) continue
    const parsed = parsePatch(file.patch)
    const runs = addedHeadRuns(parsed)
    for (const run of runs) {
      const excerpt = run.lines.map((l) => l.content).join('\n')
      registry.registerHeadSpan({
        artifactId: patchArtifact.id,
        owner: input.owner,
        repo: input.repo,
        commitSha: input.headSha,
        filePath: file.path,
        startLine: run.startLine,
        endLine: run.endLine,
        excerpt,
      })
    }
  }

  return registry
}
