// Commit-permalink builder (plan sections 8 and 15).
//
// Evidence links MUST point at an immutable commit SHA, never a branch name, so
// that a link always resolves to the exact source the analysis observed. This
// module is a pure function with no I/O so it is trivially unit-testable and
// carries no AI or persistence coupling.

/** Options accepted by buildPermalink for the optional line range. */
export interface PermalinkRange {
  startLine?: number | null
  endLine?: number | null
}

/**
 * Build a GitHub blob permalink at an immutable commit SHA.
 *
 *   https://github.com/{owner}/{repo}/blob/{sha}/{path}#L{start}-L{end}
 *
 * Rules:
 *   - The SHA must be a commit SHA, never a branch. Callers pass the PR head or
 *     base SHA; there is deliberately no branch-name parameter.
 *   - When only startLine is given, the fragment is `#L{start}`.
 *   - When start and end are given and differ, the fragment is
 *     `#L{start}-L{end}`. When they are equal, it collapses to `#L{start}`.
 *   - When no lines are given, no fragment is appended.
 *   - Each path segment is URL-encoded so paths with spaces or unusual
 *     characters produce a valid URL, while forward slashes are preserved.
 */
export function buildPermalink(
  owner: string,
  repo: string,
  sha: string,
  filePath: string,
  startLine?: number | null,
  endLine?: number | null,
): string {
  if (!owner || !repo || !sha) {
    throw new Error('buildPermalink requires owner, repo, and an immutable commit sha.')
  }
  if (!/^[0-9a-fA-F]{7,40}$/.test(sha)) {
    // A branch name (for example "main") would not match; this guards against
    // accidentally producing a mutable link.
    throw new Error(`buildPermalink requires a commit SHA, received: ${sha}`)
  }

  const normalizedPath = filePath.replace(/^\/+/, '')
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  const base = `https://github.com/${owner}/${repo}/blob/${sha}/${encodedPath}`

  const fragment = buildLineFragment(startLine, endLine)
  return fragment ? `${base}#${fragment}` : base
}

/** Build the `L{start}` / `L{start}-L{end}` fragment, or '' when no lines. */
export function buildLineFragment(
  startLine?: number | null,
  endLine?: number | null,
): string {
  if (startLine == null) return ''
  const start = Math.trunc(startLine)
  if (start < 1) return ''
  if (endLine == null) return `L${start}`
  const end = Math.trunc(endLine)
  if (end <= start) return `L${start}`
  return `L${start}-L${end}`
}
