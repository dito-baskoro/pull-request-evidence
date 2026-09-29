// POST /api/github/repositories (Milestone 2).
//
// Persists a repository the signed-in user selected on the dashboard, so the
// pull-request list and analysis endpoints (which key off a stored
// repositories.id uuid) can operate on it. Repositories are otherwise
// live-fetched; only the selected repo is persisted here.
//
// Read only against GitHub: the repository's authoritative identity is resolved
// via the installation token (never trusted from the client), and no
// installation token is returned to the client. Installation ownership is
// verified against the SSR-resolved auth.uid() before any write; RLS
// additionally scopes it.
//
// The guard, validation, ownership, and persist logic live in
// resolvePersistRepository so they can be unit-tested away from Nitro's
// auto-imports. This handler is a thin adapter.

import { createError, defineEventHandler, readBody } from 'h3'
import type { Repository } from '~/types/github'
import { getInstallationOctokit } from '~/server/utils/github/app-auth'
import {
  type PersistRepositoryBody,
  PersistRepositoryError,
  resolvePersistRepository,
} from '~/server/utils/github/persist-repository'

export default defineEventHandler(async (event): Promise<{ repository: Repository }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user ?? null

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const body = await readBody<PersistRepositoryBody>(event)

  try {
    return await resolvePersistRepository({
      user,
      body,
      supabase,
      getInstallationOctokit: (id: number) => getInstallationOctokit(id) as any,
    })
  }
  catch (err) {
    if (err instanceof PersistRepositoryError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
