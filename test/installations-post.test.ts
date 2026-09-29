import { describe, expect, it, vi } from 'vitest'
import {
  PersistInstallationError,
  parseInstallationId,
  persistInstallation,
  resolveInstallationConnect,
  validateSetupAction,
  type AppOctokitLike,
} from '~/server/utils/github/persist-installation'

// These tests exercise the extracted persist helper directly, mirroring the
// fake-Supabase / fake-Octokit style in test/orchestrator-ingestion.test.ts.
// The route file itself relies on Nitro auto-imported globals
// (createSupabaseServerClient, useRuntimeConfig) that do not exist under
// vitest, so the testable logic lives in the helper and is injected with fakes.

/** Records the row an upsert was called with so tests can assert on it. */
interface UpsertCall {
  values: Record<string, unknown>
  options: { onConflict: string }
}

/**
 * Hand-rolled fake SSR Supabase client exposing the
 * from(...).upsert(...).select(...).single() chain the helper uses. It echoes
 * the upserted row back (plus a stable id/created_at) so the mapped result
 * reflects exactly what was written.
 */
function fakeSupabase(calls: UpsertCall[], overrides?: { error?: { message: string } | null; row?: any }) {
  return {
    from(_table: string) {
      return {
        upsert(values: Record<string, unknown>, options: { onConflict: string }) {
          calls.push({ values, options })
          return {
            select(_columns: string) {
              return {
                single() {
                  if (overrides?.error) {
                    return Promise.resolve({ data: null, error: overrides.error })
                  }
                  const row = overrides?.row ?? {
                    id: 'inst-row-1',
                    user_id: values.user_id,
                    github_installation_id: values.github_installation_id,
                    account_login: values.account_login,
                    account_type: values.account_type,
                    created_at: '2026-01-01T00:00:00Z',
                  }
                  return Promise.resolve({ data: row, error: null })
                },
              }
            },
          }
        },
      }
    },
  }
}

/** Fake app-level Octokit whose apps.getInstallation returns a known account. */
function fakeAppOctokit(account: { login?: string | null; type?: string | null } | null): AppOctokitLike {
  return {
    rest: {
      apps: {
        getInstallation: vi.fn(async () => ({ data: { account } })),
      },
    },
  }
}

/**
 * Fake app-level Octokit whose apps.getInstallation rejects with an
 * Octokit-style error carrying a numeric `status`. Defaults to a genuine 404.
 */
function throwingAppOctokit(status = 404): AppOctokitLike {
  return {
    rest: {
      apps: {
        getInstallation: vi.fn(async () => {
          const err = new Error(status === 404 ? 'Not Found' : 'Upstream error') as Error & {
            status: number
          }
          err.status = status
          throw err
        }),
      },
    },
  }
}

describe('parseInstallationId', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(parseInstallationId(42)).toBe(42)
    expect(parseInstallationId('42')).toBe(42)
  })

  it('rejects missing, NaN, zero, and negative values', () => {
    expect(() => parseInstallationId(undefined)).toThrow(PersistInstallationError)
    expect(() => parseInstallationId('')).toThrow(PersistInstallationError)
    expect(() => parseInstallationId('abc')).toThrow(PersistInstallationError)
    expect(() => parseInstallationId(0)).toThrow(PersistInstallationError)
    expect(() => parseInstallationId(-5)).toThrow(PersistInstallationError)
  })
})

describe('validateSetupAction', () => {
  it('accepts install, update, and missing values', () => {
    expect(validateSetupAction('install')).toBe('install')
    expect(validateSetupAction('update')).toBe('update')
    expect(validateSetupAction(undefined)).toBeNull()
    expect(validateSetupAction(null)).toBeNull()
    expect(validateSetupAction('')).toBeNull()
  })

  it('rejects other non-empty values', () => {
    expect(() => validateSetupAction('delete')).toThrow(PersistInstallationError)
    expect(() => validateSetupAction('request')).toThrow(PersistInstallationError)
  })
})

describe('persistInstallation', () => {
  it('happy path: upserts owner-scoped row with account fields from getInstallation', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'acme-org', type: 'Organization' })

    const result = await persistInstallation({
      supabase,
      appOctokit,
      userId: 'user-1',
      installationId: 555,
      setupAction: 'install',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].values).toEqual({
      user_id: 'user-1',
      github_installation_id: 555,
      account_login: 'acme-org',
      account_type: 'Organization',
    })
    expect(calls[0].options).toEqual({ onConflict: 'user_id,github_installation_id' })

    expect(result).toEqual({
      id: 'inst-row-1',
      userId: 'user-1',
      githubInstallationId: 555,
      accountLogin: 'acme-org',
      accountType: 'Organization',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it("falls back to 'User' account type when getInstallation omits it", async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: null })

    const result = await persistInstallation({
      supabase,
      appOctokit,
      userId: 'user-1',
      installationId: 7,
    })

    expect(result.accountType).toBe('User')
    expect(calls[0].values.account_type).toBe('User')
  })

  it('is idempotent on reconnect: upsert uses onConflict user_id,github_installation_id', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    const args = { supabase, appOctokit, userId: 'user-1', installationId: 99, setupAction: 'update' }
    await persistInstallation(args)
    await persistInstallation(args)

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.options.onConflict).toBe('user_id,github_installation_id')
      expect(call.values.github_installation_id).toBe(99)
      expect(call.values.user_id).toBe('user-1')
    }
  })

  it('binds user_id to the authenticated userId, never to a client-supplied id', async () => {
    const calls: UpsertCall[] = []
    // The helper only ever receives the SSR-resolved userId. Even if a caller
    // tried to smuggle a different id into the upsert row via getInstallation
    // data, the helper builds the row from the userId argument alone.
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'victim-org', type: 'Organization' })

    await persistInstallation({
      supabase,
      appOctokit,
      userId: 'authenticated-user',
      installationId: 123,
    })

    expect(calls[0].values.user_id).toBe('authenticated-user')
  })

  it('rejects invalid setup_action before writing', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1, setupAction: 'bogus' }),
    ).rejects.toBeInstanceOf(PersistInstallationError)

    expect(calls).toHaveLength(0)
  })

  it('throws a 404-style error when getInstallation returns a genuine 404', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(404)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(calls).toHaveLength(0)
  })

  it('maps a non-404 getInstallation failure to 502, not "not found"', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(500)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502 })

    // The distinct status must not carry a "not found" message.
    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.not.toThrow(/not found/i)

    expect(calls).toHaveLength(0)
  })

  it('maps a rate-limit (403) getInstallation failure to 502', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(403)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502 })

    expect(calls).toHaveLength(0)
  })

  it('maps a 401 credential failure to an actionable credentials message', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(401)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502, message: /credentials appear to be invalid/i })

    expect(calls).toHaveLength(0)
  })

  it('maps a 403 permission failure to the actionable credentials message', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(403)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ message: /credentials appear to be invalid/i })

    expect(calls).toHaveLength(0)
  })

  it('keeps the generic 502 message for unknown/transient (500) failures', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(500)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502, message: /please try again/i })

    expect(calls).toHaveLength(0)
  })

  it('rejects a null account rather than persisting a blank login', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit(null)

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502 })

    expect(calls).toHaveLength(0)
  })

  it('rejects an empty account login rather than persisting a blank login', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: '', type: 'User' })

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 502 })

    expect(calls).toHaveLength(0)
  })

  it('throws a 500-style error when the upsert fails', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls, { error: { message: 'db down' } })
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    await expect(
      persistInstallation({ supabase, appOctokit, userId: 'user-1', installationId: 1 }),
    ).rejects.toMatchObject({ statusCode: 500, message: 'db down' })
  })
})

describe('resolveInstallationConnect', () => {
  // These tests drive the actual route logic (guard + body-key aliasing +
  // validation + error mapping) that installations.post.ts delegates to,
  // rather than a re-declared stub. A regression in any of those paths
  // (dropped 401 guard, broken installation_id/setup_action aliasing,
  // mis-mapped error status) fails here. The route handler itself is a thin
  // adapter that only translates PersistInstallationError.statusCode onto
  // createError, which cannot drift because both use the same statusCode.

  it('rejects the unauthenticated case with 401 before touching GitHub or the DB', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    await expect(
      resolveInstallationConnect({
        user: null,
        body: { installation_id: 123 },
        supabase,
        appOctokit,
      }),
    ).rejects.toMatchObject({ statusCode: 401 })

    expect(appOctokit.rest.apps.getInstallation).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('reads the snake_case installation_id/setup_action keys', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'acme', type: 'Organization' })

    const { installation } = await resolveInstallationConnect({
      user: { id: 'user-1' },
      body: { installation_id: '321', setup_action: 'install' },
      supabase,
      appOctokit,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].values).toMatchObject({ user_id: 'user-1', github_installation_id: 321 })
    expect(installation.githubInstallationId).toBe(321)
  })

  it('reads the camelCase installationId/setupAction keys', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'acme', type: 'Organization' })

    const { installation } = await resolveInstallationConnect({
      user: { id: 'user-1' },
      body: { installationId: 654, setupAction: 'update' },
      supabase,
      appOctokit,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].values).toMatchObject({ user_id: 'user-1', github_installation_id: 654 })
    expect(installation.githubInstallationId).toBe(654)
  })

  it('binds user_id to the authenticated user, never to a client-supplied id', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'acme', type: 'Organization' })

    // A malicious body cannot smuggle user_id: the helper only reads user.id.
    await resolveInstallationConnect({
      user: { id: 'authenticated-user' },
      body: { installation_id: 10, user_id: 'attacker' } as any,
      supabase,
      appOctokit,
    })

    expect(calls[0].values.user_id).toBe('authenticated-user')
  })

  it('rejects a missing/invalid installation_id with 400 before any write', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    await expect(
      resolveInstallationConnect({ user: { id: 'user-1' }, body: {}, supabase, appOctokit }),
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(
      resolveInstallationConnect({
        user: { id: 'user-1' },
        body: { installation_id: 'abc' },
        supabase,
        appOctokit,
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(appOctokit.rest.apps.getInstallation).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('rejects an unexpected setup_action with 400 before any write', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'octo', type: 'User' })

    await expect(
      resolveInstallationConnect({
        user: { id: 'user-1' },
        body: { installation_id: 5, setup_action: 'delete' },
        supabase,
        appOctokit,
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(appOctokit.rest.apps.getInstallation).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('propagates a non-404 getInstallation failure as 502', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(500)

    await expect(
      resolveInstallationConnect({
        user: { id: 'user-1' },
        body: { installation_id: 5 },
        supabase,
        appOctokit,
      }),
    ).rejects.toMatchObject({ statusCode: 502 })

    expect(calls).toHaveLength(0)
  })

  it('propagates a genuine 404 getInstallation failure as 404', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = throwingAppOctokit(404)

    await expect(
      resolveInstallationConnect({
        user: { id: 'user-1' },
        body: { installation_id: 5 },
        supabase,
        appOctokit,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(calls).toHaveLength(0)
  })

  it('runs verifyState BEFORE any GitHub call or write; a rejecting verifier blocks both', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'victim-org', type: 'Organization' })

    // A rejecting verifier simulates a missing/invalid/mismatched/expired
    // state token. This is the cross-tenant guard: possession of a valid
    // installation_id alone must NOT be enough to persist.
    const verifyState = vi.fn((_token: string | undefined, _userId: string) => {
      const err = new Error('invalid state') as Error & { statusCode: number }
      err.statusCode = 400
      throw err
    })

    await expect(
      resolveInstallationConnect({
        user: { id: 'attacker' },
        body: { installation_id: 999, state: 'stale-or-forged' },
        supabase,
        appOctokit,
        verifyState,
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    // The verifier ran with the raw token and the authenticated user id.
    expect(verifyState).toHaveBeenCalledWith('stale-or-forged', 'attacker')
    // No GitHub lookup and no DB write happened.
    expect(appOctokit.rest.apps.getInstallation).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('passes the state token and authenticated user id to verifyState, then persists on success', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const appOctokit = fakeAppOctokit({ login: 'acme', type: 'Organization' })
    const verifyState = vi.fn((_token: string | undefined, _userId: string) => {})

    const { installation } = await resolveInstallationConnect({
      user: { id: 'user-1' },
      body: { installation_id: 42, state: 'valid-token' },
      supabase,
      appOctokit,
      verifyState,
    })

    expect(verifyState).toHaveBeenCalledWith('valid-token', 'user-1')
    expect(appOctokit.rest.apps.getInstallation).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(1)
    expect(installation.githubInstallationId).toBe(42)
  })
})
