// Post-install dashboard callback logic, extracted from dashboard.vue so it is
// unit-testable without Vue/Nitro auto-imports (the repo's vitest setup has no
// @vue/test-utils / happy-dom; only plain unit tests run). The .vue component
// keeps the connectHandled single-run guard and onMounted wiring and delegates
// the normalization + POST + success/failure branching here.
//
// GitHub redirects to the App Setup URL (<NUXT_PUBLIC_APP_URL>/dashboard) with
// plain string installation_id/setup_action params, plus the state token our
// own connect link carried. We defensively normalize each param to handle the
// string, array, and empty/missing shapes:
//   - array-valued -> take the first element
//   - empty/missing -> clean no-op (no POST)
// installation_id is forwarded as-is (string) to the server, which coerces it
// via parseInstallationId.
//
// On SUCCESS: POST, refresh the installation list, report success, and strip
// the query (so a reload does not re-POST). On FAILURE: report the error but do
// NOT strip the query, so reloading re-attempts the connect. The connectHandled
// guard in the component prevents an infinite re-POST loop within a single load.

/** Raw query value shape Nuxt/GitHub may hand us for a single param. */
export type RawQueryValue = string | string[] | undefined | null

/** Normalize a raw query value: take the first element of an array, else the
 * value itself; empty string and missing collapse to undefined. */
export function normalizeQueryValue(raw: RawQueryValue): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return value
}

export interface RunInstallCallbackDeps {
  /** Raw route.query.installation_id. */
  installationId: RawQueryValue
  /** Raw route.query.setup_action. */
  setupAction: RawQueryValue
  /** Raw route.query.state. */
  state: RawQueryValue
  /** Stand-in for a $fetch POST to /api/github/installations. */
  post: (body: {
    installation_id: string
    setup_action?: string
    state?: string
  }) => Promise<unknown>
  /** Refresh the installation list (useFetch refresh). */
  refresh: () => Promise<unknown> | unknown
  /** Strip the connect query params from the URL (only called on success). */
  stripQuery: () => Promise<unknown> | unknown
}

export interface RunInstallCallbackResult {
  status: 'idle' | 'success' | 'error'
  message: string
  posted: boolean
  stripped: boolean
}

/**
 * Run the post-install connect callback once. Pure over its injected deps (no
 * Vue/Nitro imports), so tests can drive every branch with hand-rolled fakes.
 *
 * Behavior:
 *   - No installation_id -> idle, no POST, query not stripped.
 *   - Success -> POST with normalized installation_id/setup_action/state,
 *     refresh the list, strip the query, status 'success'.
 *   - Failure -> status 'error' with a message from the
 *     err.data.statusMessage / err.statusMessage / err.message fallback chain,
 *     query NOT stripped so a reload re-attempts.
 */
export async function runInstallCallback(
  deps: RunInstallCallbackDeps,
): Promise<RunInstallCallbackResult> {
  const installationId = normalizeQueryValue(deps.installationId)
  if (!installationId) {
    return { status: 'idle', message: '', posted: false, stripped: false }
  }

  const setupAction = normalizeQueryValue(deps.setupAction)
  const state = normalizeQueryValue(deps.state)

  try {
    await deps.post({
      installation_id: installationId,
      setup_action: setupAction,
      state,
    })
    await deps.refresh()
    // Strip the query only on success so a reload does not re-POST.
    await deps.stripQuery()
    return { status: 'success', message: 'GitHub App connected.', posted: true, stripped: true }
  }
  catch (err: any) {
    // Preserve the query on failure so reloading re-attempts the connect.
    const message
      = err?.data?.statusMessage
        || err?.statusMessage
        || err?.message
        || 'Could not connect the GitHub App. Please try again.'
    return { status: 'error', message, posted: true, stripped: false }
  }
}
