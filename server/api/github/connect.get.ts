// GET /api/github/connect (Milestone 2 security hardening).
//
// Issues the GitHub App install URL for the signed-in user, carrying a
// server-signed, short-lived, per-user `state` token. GitHub echoes `state`
// back on the setup redirect, and POST /api/github/installations verifies it
// before recording the installation. This binds the connect to the user who
// initiated the install from our app, blocking a bare, guessed, or replayed
// installation_id from being claimed by another account. See
// server/utils/github/connect-state.ts for the trust model and residual
// assumption (this does NOT prove GitHub account ownership).
//
// The token is never logged. Read only: no installation token is minted here.

import { createError, defineEventHandler } from 'h3'
import { readConnectStateSecret, signConnectState } from '~/server/utils/github/connect-state'

export default defineEventHandler(async (event): Promise<{ installUrl: string }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const config = useRuntimeConfig()
  const slug = config.public.githubAppSlug
  if (!slug) {
    throw createError({
      statusCode: 500,
      statusMessage: 'GitHub App slug is not configured (NUXT_PUBLIC_GITHUB_APP_SLUG).',
    })
  }

  // readConnectStateSecret fails closed when the secret is unset, so the connect
  // link can never be issued without a verifiable state.
  const secret = readConnectStateSecret()
  const state = signConnectState({ userId: user.id, secret })

  const installUrl = `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`
  return { installUrl }
})
