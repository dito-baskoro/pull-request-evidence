// GET /api/github/pulls?repositoryId=... (plan section 11; Milestone 2).
//
// Lists open pull requests for a repository the authenticated user can reach
// through an installation they OWN. Ownership is confirmed (via the repository
// -> installation -> user chain) before any GitHub call. Read only; no
// installation token is returned to the client.

import { createError, defineEventHandler, getQuery } from 'h3'
import { getInstallationOctokit } from '~/server/utils/github/app-auth'

interface PullSummary {
  number: number
  title: string
  authorLogin: string | null
  headSha: string
  baseSha: string
  state: string
  updatedAt: string | null
}

export default defineEventHandler(async (event): Promise<{ pulls: PullSummary[] }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const query = getQuery(event)
  const repositoryId = typeof query.repositoryId === 'string' ? query.repositoryId : ''
  if (!repositoryId) {
    throw createError({ statusCode: 400, statusMessage: 'repositoryId is required.' })
  }

  // Ownership check via repository -> installation -> user. RLS also enforces
  // this, but we resolve the installation id and owner/name here explicitly.
  const { data: repo, error: repoErr } = await supabase
    .from('repositories')
    .select('id, owner, name, github_installations!inner(id, github_installation_id, user_id)')
    .eq('id', repositoryId)
    .eq('github_installations.user_id', user.id)
    .maybeSingle()

  if (repoErr) {
    throw createError({ statusCode: 500, statusMessage: repoErr.message })
  }
  if (!repo) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot access this repository.' })
  }

  const installation = Array.isArray(repo.github_installations)
    ? repo.github_installations[0]
    : repo.github_installations
  const githubInstallationId = installation.github_installation_id as number

  const octokit = await getInstallationOctokit(githubInstallationId)
  const pulls: PullSummary[] = []
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner: repo.owner as string,
    repo: repo.name as string,
    state: 'open',
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const pr of data) {
      pulls.push({
        number: pr.number,
        title: pr.title,
        authorLogin: pr.user?.login ?? null,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        state: pr.state,
        updatedAt: pr.updated_at ?? null,
      })
    }
  }

  return { pulls }
})
