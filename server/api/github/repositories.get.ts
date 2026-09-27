// GET /api/github/repositories?installationId=... (plan section 11; Milestone 2).
//
// Lists repositories reachable through an installation the authenticated user
// OWNS. Ownership is confirmed before any GitHub call. Read only; no
// installation token is returned to the client.

import { createError, defineEventHandler, getQuery } from 'h3'
import type { Repository } from '~/types/github'
import { getInstallationOctokit } from '~/server/utils/github/app-auth'

export default defineEventHandler(async (event): Promise<{ repositories: Repository[] }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const query = getQuery(event)
  const installationId = typeof query.installationId === 'string' ? query.installationId : ''
  if (!installationId) {
    throw createError({ statusCode: 400, statusMessage: 'installationId is required.' })
  }

  // Ownership check: the installation must belong to this user.
  const { data: installation, error: instErr } = await supabase
    .from('github_installations')
    .select('id, github_installation_id')
    .eq('id', installationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (instErr) {
    throw createError({ statusCode: 500, statusMessage: instErr.message })
  }
  if (!installation) {
    throw createError({ statusCode: 403, statusMessage: 'You do not own this installation.' })
  }

  // Read-only listing via a short-lived installation token (never returned).
  const octokit = await getInstallationOctokit(installation.github_installation_id)
  const repositories: Repository[] = []
  const iterator = octokit.paginate.iterator(
    octokit.rest.apps.listReposAccessibleToInstallation,
    { per_page: 100 },
  )
  for await (const { data } of iterator) {
    const repos = Array.isArray(data) ? data : []
    for (const r of repos) {
      repositories.push({
        id: '', // Not yet persisted; the client persists on selection.
        installationId,
        githubRepositoryId: r.id,
        owner: r.owner?.login ?? '',
        name: r.name,
        defaultBranch: r.default_branch ?? 'main',
        isPrivate: Boolean(r.private),
        createdAt: '',
      })
    }
  }

  return { repositories }
})
