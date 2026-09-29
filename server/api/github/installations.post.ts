// POST /api/github/installations (Milestone 2).
//
// Post-install connection callback. After a user installs the read-only GitHub
// App, GitHub redirects them (via the App's Setup URL) back to the dashboard
// with installation_id and setup_action query params. The dashboard then POSTs
// those here so the installation is persisted as a github_installations row
// OWNED by the signed-in user. This is the only place a row is created, which
// is why the dashboard previously stayed on "No GitHub App connected yet".
//
// Read only: no installation access token is minted, returned, or logged, and
// repositories are NOT persisted (they stay live-fetched). The account
// login/type are read authoritatively from the GitHub App JWT, never from the
// client. user_id is bound to the SSR-resolved auth.uid(), and the SSR client's
// RLS (installations_insert_own / installations_update_own) additionally scopes
// the write to the authenticated user.
//
// Cross-tenant guard: the app JWT can read metadata for EVERY installation of
// the app, so a valid installation_id alone (which is not secret) is not proof
// that this user performed the install. Before any GitHub lookup or DB write we
// verify a per-user `state` token that our own GET /api/github/connect issued
// and GitHub echoed back on the setup redirect. See connect-state.ts for the
// trust model and residual assumption.
//
// The guard, body-key aliasing, validation, and persist logic live in
// resolveInstallationConnect so they can be unit-tested away from Nitro's
// auto-imports (createSupabaseServerClient, useRuntimeConfig). This handler is
// a thin adapter: resolve the SSR user + dependencies, delegate, and map any
// PersistInstallationError statusCode straight onto createError.

import { createError, defineEventHandler, readBody } from 'h3'
import type { GithubInstallation } from '~/types/github'
import { getAppOctokit } from '~/server/utils/github/app-auth'
import {
  ConnectStateError,
  readConnectStateSecret,
  verifyConnectState,
} from '~/server/utils/github/connect-state'
import {
  type ConnectInstallationBody,
  PersistInstallationError,
  resolveInstallationConnect,
} from '~/server/utils/github/persist-installation'

export default defineEventHandler(async (event): Promise<{ installation: GithubInstallation }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user ?? null

  // Short-circuit unauthenticated requests before reading the body or minting
  // the app JWT client. resolveInstallationConnect enforces the same 401, but
  // guarding here avoids needless work for anonymous callers.
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const body = await readBody<ConnectInstallationBody>(event)

  // Credential problems (missing/non-numeric App ID, unusable private key) are
  // configuration errors: surface the secret-free, actionable message instead
  // of an opaque 500.
  let appOctokit
  try {
    appOctokit = await getAppOctokit()
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'GitHub App credentials are invalid.'
    console.error('[github connect] app credentials unusable', { message })
    throw createError({ statusCode: 502, statusMessage: message })
  }

  // Bind the connect-state verifier with the server-only signing secret. This
  // runs BEFORE any GitHub lookup or DB write inside resolveInstallationConnect,
  // so a missing/invalid/mismatched/expired state rejects with 400 and persists
  // nothing. readConnectStateSecret fails closed when the secret is unset, so
  // verification can never be silently skipped. The token is never logged.
  const secret = readConnectStateSecret()
  const verifyState = (token: string | undefined, userId: string) =>
    verifyConnectState({ token, userId, secret })

  try {
    return await resolveInstallationConnect({ user, body, supabase, appOctokit, verifyState })
  }
  catch (err) {
    // Both PersistInstallationError and ConnectStateError expose statusCode; map
    // either straight onto createError so the status contract cannot drift.
    if (err instanceof PersistInstallationError || err instanceof ConnectStateError) {
      throw createError({ statusCode: err.statusCode, statusMessage: err.message })
    }
    throw err
  }
})
