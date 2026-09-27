// Read-only raw file content fetch at an immutable SHA (plan section 8).
//
// Fetches full file content for selected changed files at a specific commit
// SHA (never a branch), so evidence excerpts and permalinks are bound to the
// exact observed source. Read-only.

import type { Octokit } from '@octokit/rest'

export interface FileContentAtSha {
  path: string
  sha: string
  /** Decoded UTF-8 content, or null when the blob is binary/too large. */
  content: string | null
}

/**
 * Fetch a single file's content at a commit SHA. Returns null content when the
 * response is not a decodable text blob (directory, submodule, or binary).
 */
export async function fetchFileAtSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  sha: string,
): Promise<FileContentAtSha> {
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref: sha,
  })

  if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
    return { path, sha, content: null }
  }

  const decoded = Buffer.from(data.content, (data.encoding as BufferEncoding) || 'base64').toString('utf8')
  return { path, sha, content: decoded }
}

/** Fetch several files at the same SHA, tolerating individual failures. */
export async function fetchFilesAtSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  sha: string,
): Promise<FileContentAtSha[]> {
  const results: FileContentAtSha[] = []
  for (const path of paths) {
    try {
      results.push(await fetchFileAtSha(octokit, owner, repo, path, sha))
    }
    catch {
      results.push({ path, sha, content: null })
    }
  }
  return results
}
