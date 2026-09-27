// Read-only PR ingestion (plan section 8; Milestone 3).
//
// Fetches PR metadata, changed files + patches (paginated), and commits for a
// selected pull request. All calls are read-only. The returned shapes are the
// app's own domain types, decoupled from Octokit response types.

import type { Octokit } from '@octokit/rest'
import type { ChangedFile, ChangeStatus, PrMetadata } from '~/types/github'

export interface FetchedPr {
  metadata: Omit<PrMetadata, 'id' | 'repositoryId'>
  files: ChangedFile[]
  commits: PrCommit[]
}

export interface PrCommit {
  sha: string
  message: string
  authorLogin: string | null
  authoredAt: string | null
}

/** Fetch PR metadata, changed files (with patches), and commits. */
export async function fetchPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<FetchedPr> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  })

  const metadata: Omit<PrMetadata, 'id' | 'repositoryId'> = {
    githubNumber: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    authorLogin: pr.user?.login ?? null,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    state: pr.merged ? 'merged' : pr.state,
    sourceUpdatedAt: pr.updated_at ?? null,
  }

  const files = await fetchChangedFiles(octokit, owner, repo, pullNumber)
  const commits = await fetchCommits(octokit, owner, repo, pullNumber)

  return { metadata, files, commits }
}

/** Fetch all changed files across pages (100 per page). */
export async function fetchChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ChangedFile[]> {
  const out: ChangedFile[] = []
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const f of data) {
      out.push({
        path: f.filename,
        previousPath: f.previous_filename ?? null,
        status: (f.status as ChangeStatus) ?? 'changed',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        changes: f.changes ?? 0,
        patch: f.patch ?? null,
        sha: f.sha ?? null,
      })
    }
  }
  return out
}

/** Fetch commits on the PR across pages. */
export async function fetchCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PrCommit[]> {
  const out: PrCommit[] = []
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const c of data) {
      out.push({
        sha: c.sha,
        message: c.commit.message,
        authorLogin: c.author?.login ?? null,
        authoredAt: c.commit.author?.date ?? null,
      })
    }
  }
  return out
}
