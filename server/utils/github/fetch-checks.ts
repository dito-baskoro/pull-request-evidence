// Read-only check-run ingestion (plan sections 7 and 8; Milestone 3).
//
// Fetches check runs for the immutable head SHA and normalizes them into the
// app's CheckResult shape (minus db-generated ids). Read-only.

import type { Octokit } from '@octokit/rest'
import type { CheckResult } from '~/types/github'

/** A normalized check run before it receives db ids. */
export type NormalizedCheck = Omit<CheckResult, 'id' | 'analysisRunId'>

/** Fetch and normalize check runs for a commit SHA. */
export async function fetchChecksForSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<NormalizedCheck[]> {
  const out: NormalizedCheck[] = []
  const iterator = octokit.paginate.iterator(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref: headSha,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    // paginate yields the `check_runs` array for this endpoint.
    const runs = Array.isArray(data) ? data : []
    for (const run of runs) {
      out.push(normalizeCheckRun(run))
    }
  }
  return out
}

/** Normalize a single Octokit check-run object. Exposed for unit testing. */
export function normalizeCheckRun(run: {
  id: number
  name: string
  status: string
  conclusion: string | null
  details_url?: string | null
  started_at?: string | null
  completed_at?: string | null
}): NormalizedCheck {
  return {
    githubCheckRunId: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion ?? null,
    detailsUrl: run.details_url ?? null,
    startedAt: run.started_at ?? null,
    completedAt: run.completed_at ?? null,
  }
}
