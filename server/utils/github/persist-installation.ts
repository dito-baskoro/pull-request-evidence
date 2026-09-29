// Persist a GitHub App installation for the signed-in user (Milestone 2).
//
// This is the testable core of the POST /api/github/installations route. It is
// extracted here (rather than living inline in the route) because the route
// relies on Nitro auto-imported globals (createSupabaseServerClient,
// useRuntimeConfig) that do not exist under vitest. The route resolves the
// authenticated user and its dependencies, then hands them to this helper so
// the persist logic can be unit-tested with hand-rolled fakes.
//
// Security posture:
//   - user_id is ALWAYS bound to the SSR-resolved userId argument (auth.uid()).
//     It is never taken from any client-supplied value, so a user can never
//     attach an installation to another user's id. RLS additionally scopes the
//     write to auth.uid().
//   - The authoritative account login/type are read from the GitHub App via
//     getInstallation; client-supplied account fields are never trusted.
//   - No installation access token is ever minted, returned, or logged here.
//   - Repositories are NOT persisted (they stay live-fetched).

import type { GithubInstallation } from '~/types/github'

/**
 * Minimal shape of the app-level Octokit this helper needs. The app JWT client
 * exposes rest.apps.getInstallation; we only depend on that call so tests can
 * inject a small fake.
 */
export interface AppOctokitLike {
  rest: {
    apps: {
      getInstallation(params: { installation_id: number }): Promise<{
        data: {
          account?: {
            login?: string | null
            type?: string | null
          } | null
        }
      }>
    }
  }
}

/**
 * Read the numeric HTTP status Octokit REST errors expose on their `status`
 * property, if present. Returns undefined for non-HTTP failures (network
 * errors, thrown strings). We never read tokens or headers off the error, so
 * nothing sensitive is inspected or leaked.
 */
function readErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status
    }
  }
  return undefined
}

/**
 * Read a short error name for diagnostics. Reads only the `name` field; never
 * inspects tokens, headers, or the full error object.
 */
function readErrorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return 'Error'
}

/**
 * Read a short, truncated error message for diagnostics. GitHub/Octokit error
 * messages describe the failure (e.g. "Bad credentials") without embedding the
 * private key or token; we still cap the length defensively and never log any
 * other field.
 */
function readErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message.slice(0, 200)
  }
  return 'unknown error'
}

/**
 * Minimal shape of the SSR Supabase client this helper needs: an owner-scoped
 * upsert on github_installations returning the persisted row.
 */
export interface SupabaseLike {
  from(table: string): {
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string },
    ): {
      select(columns: string): {
        single(): Promise<{ data: any; error: { message: string } | null }>
      }
    }
  }
}

export interface PersistInstallationArgs {
  supabase: SupabaseLike
  appOctokit: AppOctokitLike
  /** The SSR-resolved authenticated user id (auth.uid()). */
  userId: string
  /** The GitHub installation id from the setup redirect. */
  installationId: number
  /** Optional setup_action from the setup redirect (install/update). */
  setupAction?: string | null
}

/** Error carrying an HTTP-style status so the route can map it to createError. */
export class PersistInstallationError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'PersistInstallationError'
    this.statusCode = statusCode
  }
}

const ALLOWED_SETUP_ACTIONS = new Set(['install', 'update'])

/**
 * Validate a raw installation id (from either `installation_id` or
 * `installationId`). Returns a positive integer or throws a 400-style error.
 */
export function parseInstallationId(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
    throw new PersistInstallationError(
      400,
      'A positive installation_id is required.',
    )
  }
  return value
}

/**
 * Validate an optional setup_action. Missing/empty is acceptable; only
 * 'install' and 'update' are accepted otherwise.
 */
export function validateSetupAction(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null
  }
  if (typeof raw !== 'string' || !ALLOWED_SETUP_ACTIONS.has(raw)) {
    throw new PersistInstallationError(
      400,
      'Unexpected setup_action; expected install or update.',
    )
  }
  return raw
}

/**
 * Verify the installation via the GitHub App JWT and upsert an owner-scoped
 * github_installations row. Idempotent on the existing unique
 * (user_id, github_installation_id) constraint so reconnecting is a no-op
 * beyond refreshing the account fields.
 */
export async function persistInstallation(
  args: PersistInstallationArgs,
): Promise<GithubInstallation> {
  const { supabase, appOctokit, userId, installationId } = args

  // setup_action is validated for defense in depth even though the route also
  // validates it. Missing is acceptable.
  validateSetupAction(args.setupAction)

  // Read the authoritative account login/type from GitHub. Never trust
  // client-supplied account fields.
  let accountLogin: string
  let accountType: string
  try {
    const { data } = await appOctokit.rest.apps.getInstallation({
      installation_id: installationId,
    })
    const account = data.account ?? null
    const login = account?.login ?? ''
    // A missing/empty account login means we cannot identify the installation.
    // Rather than persist a blank identity that the dashboard would render as an
    // unlabeled row, treat it as a connect failure with a clear message.
    if (!login) {
      throw new PersistInstallationError(
        502,
        'GitHub did not return an account for this installation. Please try reconnecting.',
      )
    }
    accountLogin = login
    accountType = account?.type ?? 'User'
  }
  catch (err) {
    // Preserve an intentional rejection (e.g. the null-account guard above).
    if (err instanceof PersistInstallationError) {
      throw err
    }
    // Distinguish a genuine "installation not found" (404) from other upstream
    // failures. Octokit REST errors expose a numeric `status`. We read ONLY the
    // status, error name, and a short message string; we never read tokens,
    // headers, the App JWT, or the full error object, so nothing sensitive is
    // logged or leaked.
    const status = readErrorStatus(err)

    // Server-side diagnostic so `wrangler tail` shows the real cause. Sanitized:
    // status + name + short message only.
    console.error('[github connect] getInstallation failed', {
      status: status ?? 'none',
      name: readErrorName(err),
      message: readErrorMessage(err),
    })

    if (status === 404) {
      throw new PersistInstallationError(
        404,
        'GitHub installation not found or not accessible by this app.',
      )
    }
    // 401/403 are credential/permission problems (bad App ID, malformed private
    // key, or the app lacking access), not transient. Surface an actionable
    // message without leaking any secret.
    if (status === 401 || status === 403) {
      throw new PersistInstallationError(
        502,
        'GitHub App credentials appear to be invalid. Verify NUXT_GITHUB_APP_ID and NUXT_GITHUB_APP_PRIVATE_KEY, and see docs/github-app-setup.md.',
      )
    }
    throw new PersistInstallationError(
      502,
      'Could not verify the GitHub installation with GitHub. Please try again.',
    )
  }

  // Owner-scoped upsert. user_id is bound to the authenticated userId only.
  const { data: row, error } = await supabase
    .from('github_installations')
    .upsert(
      {
        user_id: userId,
        github_installation_id: installationId,
        account_login: accountLogin,
        account_type: accountType,
      },
      { onConflict: 'user_id,github_installation_id' },
    )
    .select('id, user_id, github_installation_id, account_login, account_type, created_at')
    .single()

  if (error || !row) {
    throw new PersistInstallationError(
      500,
      error?.message ?? 'Failed to persist the GitHub installation.',
    )
  }

  return {
    id: row.id,
    userId: row.user_id,
    githubInstallationId: row.github_installation_id,
    accountLogin: row.account_login,
    accountType: row.account_type,
    createdAt: row.created_at,
  }
}

/** Raw request body shape accepted by the connect route (both key spellings). */
export interface ConnectInstallationBody {
  installation_id?: number | string
  installationId?: number | string
  setup_action?: string
  setupAction?: string
  /**
   * The per-user connect-state token the dashboard received on the setup
   * redirect (echoed by GitHub from the install URL). Verified server-side
   * BEFORE any GitHub lookup or DB write. See connect-state.ts.
   */
  state?: string
}

/** Minimal authenticated user shape the connect flow needs (the SSR user). */
export interface ConnectUser {
  id: string
}

export interface ResolveInstallationConnectArgs {
  /** The SSR-resolved authenticated user, or null when unauthenticated. */
  user: ConnectUser | null
  /** The raw request body (may be null/undefined). */
  body: ConnectInstallationBody | null | undefined
  supabase: SupabaseLike
  appOctokit: AppOctokitLike
  /**
   * Injected connect-state verifier. The route binds this to
   * verifyConnectState with the server-only signing secret; it MUST run before
   * the GitHub getInstallation lookup and before any DB write, and MUST throw
   * (with a statusCode the route maps to createError) when the state token is
   * missing, malformed, mismatched, or expired.
   *
   * Optional so existing tests that do not exercise state can omit it; when
   * omitted it defaults to a no-op. The route ALWAYS passes a real verifier, so
   * this default never weakens the production path.
   */
  verifyState?: (token: string | undefined, userId: string) => void
}

/**
 * Route-level connect logic, extracted from installations.post.ts so the guard,
 * body-key aliasing, validation, and error mapping are unit-testable away from
 * Nitro's auto-imports. The route resolves the user and dependencies, then
 * delegates here.
 *
 * Behavior (identical to the route contract):
 *   - Throws PersistInstallationError(401) when there is no authenticated user,
 *     BEFORE touching the body or calling GitHub.
 *   - Verifies the per-user connect-state token (via the injected verifyState)
 *     BEFORE calling GitHub or writing. A missing/invalid/mismatched/expired
 *     state rejects with 400 and persists nothing. This is the binding that
 *     stops a bare/guessed/replayed installation_id from being claimed by
 *     another account (see connect-state.ts).
 *   - Accepts both installation_id/installationId and setup_action/setupAction.
 *   - Validates installation_id (400) and setup_action (400).
 *   - Binds user_id to the SSR-resolved user.id only, then persists via
 *     persistInstallation (which maps getInstallation/DB failures to their
 *     own statuses).
 *
 * All thrown errors carry a statusCode the route maps directly to createError
 * (PersistInstallationError, or the injected verifier's ConnectStateError which
 * exposes the same statusCode shape), so no separate mapping table can drift.
 */
export async function resolveInstallationConnect(
  args: ResolveInstallationConnectArgs,
): Promise<{ installation: GithubInstallation }> {
  const { user, body, supabase, appOctokit } = args
  const verifyState = args.verifyState ?? (() => {})

  if (!user) {
    throw new PersistInstallationError(401, 'Authentication required.')
  }

  // Verify the per-user connect state BEFORE any GitHub call or DB write. A
  // rejecting verifier must prevent both, blocking the cross-tenant replay/guess
  // of another user's installation_id.
  verifyState(body?.state, user.id)

  // Accept both installation_id and installationId for robustness.
  const rawInstallationId = body?.installation_id ?? body?.installationId
  const rawSetupAction = body?.setup_action ?? body?.setupAction

  const installationId = parseInstallationId(rawInstallationId)
  const setupAction = validateSetupAction(rawSetupAction)

  const installation = await persistInstallation({
    supabase,
    appOctokit,
    userId: user.id,
    installationId,
    setupAction,
  })

  return { installation }
}
