// GET /api/github/installations (plan section 11; Milestone 2).
//
// Returns the GitHub App installations OWNED by the authenticated user. Read
// only. Installation access tokens are never minted, returned, or logged here.

import { createError, defineEventHandler } from 'h3'
import type { GithubInstallation } from '~/types/github'

export default defineEventHandler(async (event): Promise<{ installations: GithubInstallation[] }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  // RLS already scopes this to the current user; the explicit user_id filter is
  // defense in depth.
  const { data, error } = await supabase
    .from('github_installations')
    .select('id, user_id, github_installation_id, account_login, account_type, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const installations: GithubInstallation[] = (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    githubInstallationId: row.github_installation_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    createdAt: row.created_at,
  }))

  return { installations }
})
