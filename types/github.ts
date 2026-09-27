// Shared GitHub domain types (plan sections 7 and 8).
// These describe the read-only data the app ingests from the GitHub REST API.
// They are intentionally provider-shaped but decoupled from Octokit response
// types so the rest of the codebase does not depend on the client library.

/** A connected GitHub App installation owned by a user. */
export interface GithubInstallation {
  id: string
  userId: string
  githubInstallationId: number
  accountLogin: string
  accountType: 'User' | 'Organization' | string
  createdAt: string
}

/** A repository reachable through an installation. */
export interface Repository {
  id: string
  installationId: string
  githubRepositoryId: number
  owner: string
  name: string
  defaultBranch: string
  isPrivate: boolean
  createdAt: string
}

export type PullRequestState = 'open' | 'closed' | 'merged' | string

/**
 * Immutable-at-a-SHA view of a pull request. `headSha` binds an analysis run to
 * a specific commit so a new push produces a new analysis target rather than
 * silently replacing prior evidence.
 */
export interface PrMetadata {
  id: string
  repositoryId: string
  githubNumber: number
  title: string
  body: string | null
  authorLogin: string | null
  baseSha: string
  headSha: string
  state: PullRequestState
  sourceUpdatedAt: string | null
}

export type ChangeStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'

/** A single changed file entry from the PR files listing. */
export interface ChangedFile {
  path: string
  previousPath: string | null
  status: ChangeStatus
  additions: number
  deletions: number
  changes: number
  /** Unified-diff patch text. Absent for binary or oversized files. */
  patch: string | null
  /** Blob SHA at the head commit, when available. */
  sha: string | null
}

/**
 * One hunk parsed from a unified diff. Line numbers are 1-based and refer to
 * the pre-image (base) and post-image (head) files respectively.
 */
export interface PatchHunk {
  /** Starting line number in the base file. */
  baseStart: number
  /** Number of base lines covered by this hunk. */
  baseLines: number
  /** Starting line number in the head file. */
  headStart: number
  /** Number of head lines covered by this hunk. */
  headLines: number
  /** Optional section heading captured by the diff (text after the @@). */
  section: string | null
  lines: PatchLine[]
}

export type PatchLineKind = 'context' | 'added' | 'removed'

/** A single line inside a patch hunk with resolved base/head line numbers. */
export interface PatchLine {
  kind: PatchLineKind
  content: string
  /** Line number in the base file, or null for added lines. */
  baseLine: number | null
  /** Line number in the head file, or null for removed lines. */
  headLine: number | null
}

/** A normalized CI/check result for the head SHA (plan section 7). */
export interface CheckResult {
  id: string
  analysisRunId: string
  githubCheckRunId: number
  name: string
  status: string
  conclusion: string | null
  detailsUrl: string | null
  startedAt: string | null
  completedAt: string | null
}
