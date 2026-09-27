// Shared analysis domain types (plan sections 7, 9, 10).
// These cover the deterministic evidence model and analysis-run lifecycle that
// FEAT-002 (deterministic pipeline) and FEAT-003 (AI + validation) build on.

/** Lifecycle of an analysis run (plan section 7). */
export type AnalysisRunStatus =
  | 'queued'
  | 'ingesting'
  | 'deterministic'
  | 'ai'
  | 'validating'
  | 'complete'
  | 'failed'

/** Whether the analyzed context fully covered the PR (plan section 8). */
export type CoverageStatus = 'complete' | 'partial' | 'rejected'

/** Kinds of normalized artifact persisted for a run (plan section 7). */
export type ArtifactKind = 'pr_body' | 'issue' | 'commit' | 'file' | 'patch' | 'check'

/** Deterministic file classification (plan section 9). */
export type FileClass =
  | 'production_source'
  | 'test'
  | 'migration'
  | 'configuration'
  | 'dependency_manifest'
  | 'lockfile'
  | 'documentation'
  | 'generated'
  | 'binary_unsupported'

/** An analysis run bound to an immutable PR head SHA. */
export interface AnalysisRun {
  id: string
  pullRequestId: string
  requestedBy: string
  status: AnalysisRunStatus
  workflowVersion: string
  modelId: string
  coverageStatus: CoverageStatus | null
  coverageNotes: Record<string, unknown> | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCost: number | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
}

/** A normalized PR-level source artifact (plan section 7). */
export interface Artifact {
  id: string
  analysisRunId: string
  kind: ArtifactKind
  externalId: string | null
  commitSha: string | null
  filePath: string | null
  content: string | null
  contentHash: string | null
  metadata: Record<string, unknown> | null
}

/** Which file image a span refers to. */
export type EvidenceSide = 'base' | 'head' | 'metadata'

/**
 * An opaque, immutable evidence span. The evidence registry assigns each span a
 * stable `evidenceKey` (for example `E-00124`) BEFORE any model call so the AI
 * can cite only registered IDs and cannot invent file paths or line numbers
 * (plan sections 9 and 15).
 */
export interface EvidenceSpan {
  id: string
  artifactId: string
  /** Stable within an analysis run, e.g. `E-00001`. */
  evidenceKey: string
  sourceType: string
  commitSha: string
  filePath: string | null
  side: EvidenceSide
  startLine: number | null
  endLine: number | null
  excerpt: string
  excerptHash: string
  /** GitHub permalink constructed from the immutable commit SHA. */
  permalink: string | null
}

/** A single classified change entry produced by the deterministic change map. */
export interface ChangeMapEntry {
  path: string
  previousPath: string | null
  fileClass: FileClass
  status: string
  additions: number
  deletions: number
  /** Explicit disposition, e.g. why a file was excluded from context. */
  disposition: 'included' | 'excluded' | 'summarized'
  dispositionReason: string | null
}

/** Aggregate deterministic change map for a run (plan sections 4 and 9). */
export interface ChangeMap {
  entries: ChangeMapEntry[]
  totalsByClass: Partial<Record<FileClass, { files: number; additions: number; deletions: number }>>
  excludedCount: number
}
