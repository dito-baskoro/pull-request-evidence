import { describe, expect, it, vi } from 'vitest'
import {
  PersistRepositoryError,
  parseGithubRepositoryId,
  parseInstallationUuid,
  persistRepository,
  resolvePersistRepository,
  type InstallationOctokitLike,
} from '~/server/utils/github/persist-repository'

// Mirrors the fake-Supabase / fake-Octokit style of installations-post.test.ts.
// The route relies on Nitro auto-imports, so the testable logic lives in the
// helper and is injected with hand-rolled fakes (no network).

interface UpsertCall {
  values: Record<string, unknown>
  options: { onConflict: string }
}

/**
 * Fake SSR Supabase client. `github_installations` resolves ownership (returns
 * a row only when installationId + userId match the configured owner), and
 * `repositories` records the upsert and echoes a persisted row.
 */
function fakeSupabase(
  calls: UpsertCall[],
  opts: {
    ownedInstallationId?: string
    ownerUserId?: string
    githubInstallationId?: number
    upsertError?: { message: string } | null
  } = {},
) {
  const ownedInstallationId = opts.ownedInstallationId ?? 'inst-uuid-1'
  const ownerUserId = opts.ownerUserId ?? 'user-1'
  const githubInstallationId = opts.githubInstallationId ?? 4242

  return {
    from(table: string) {
      if (table === 'github_installations') {
        return {
          select: () => ({
            eq: (_c1: string, idVal: string) => ({
              eq: (_c2: string, userVal: string) => ({
                maybeSingle: () => {
                  if (idVal === ownedInstallationId && userVal === ownerUserId) {
                    return Promise.resolve({
                      data: { id: ownedInstallationId, github_installation_id: githubInstallationId },
                      error: null,
                    })
                  }
                  return Promise.resolve({ data: null, error: null })
                },
              }),
            }),
          }),
        }
      }
      // repositories
      return {
        upsert(values: Record<string, unknown>, options: { onConflict: string }) {
          calls.push({ values, options })
          return {
            select: () => ({
              single: () => {
                if (opts.upsertError) {
                  return Promise.resolve({ data: null, error: opts.upsertError })
                }
                return Promise.resolve({
                  data: {
                    id: 'repo-uuid-1',
                    installation_id: values.installation_id,
                    github_repository_id: values.github_repository_id,
                    owner: values.owner,
                    name: values.name,
                    default_branch: values.default_branch,
                    is_private: values.is_private,
                    created_at: '2026-01-01T00:00:00Z',
                  },
                  error: null,
                })
              },
            }),
          }
        },
      }
    },
  }
}

/** Fake installation Octokit listing the repos the installation can access. */
function fakeInstallationOctokit(
  repos: Array<{ id: number; name: string; owner: string; private?: boolean; default_branch?: string }>,
): InstallationOctokitLike {
  return {
    rest: { apps: { listReposAccessibleToInstallation: {} } },
    paginate: vi.fn(async () =>
      repos.map(r => ({
        id: r.id,
        name: r.name,
        private: r.private,
        default_branch: r.default_branch ?? 'main',
        owner: { login: r.owner },
      })),
    ),
  }
}

describe('parseInstallationUuid / parseGithubRepositoryId', () => {
  it('accepts a non-empty string and positive number', () => {
    expect(parseInstallationUuid('inst-1')).toBe('inst-1')
    expect(parseGithubRepositoryId(10)).toBe(10)
    expect(parseGithubRepositoryId('10')).toBe(10)
  })

  it('rejects empty/invalid values', () => {
    expect(() => parseInstallationUuid('')).toThrow(PersistRepositoryError)
    expect(() => parseInstallationUuid(undefined)).toThrow(PersistRepositoryError)
    expect(() => parseGithubRepositoryId(0)).toThrow(PersistRepositoryError)
    expect(() => parseGithubRepositoryId('abc')).toThrow(PersistRepositoryError)
  })
})

describe('persistRepository', () => {
  it('happy path: upserts owner-scoped row with identity resolved from GitHub', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 999, name: 'app', owner: 'acme', private: true, default_branch: 'trunk' }])

    const result = await persistRepository({
      supabase,
      getInstallationOctokit,
      userId: 'user-1',
      installationId: 'inst-uuid-1',
      githubRepositoryId: 999,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].options).toEqual({ onConflict: 'github_repository_id,installation_id' })
    // Identity comes from GitHub, not from client input.
    expect(calls[0].values).toMatchObject({
      installation_id: 'inst-uuid-1',
      github_repository_id: 999,
      owner: 'acme',
      name: 'app',
      default_branch: 'trunk',
      is_private: true,
    })
    expect(result).toMatchObject({ id: 'repo-uuid-1', owner: 'acme', name: 'app', githubRepositoryId: 999 })
  })

  it('is idempotent on re-select (same onConflict target)', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 1, name: 'r', owner: 'o' }])
    const args = { supabase, getInstallationOctokit, userId: 'user-1', installationId: 'inst-uuid-1', githubRepositoryId: 1 }
    await persistRepository(args)
    await persistRepository(args)
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c.options.onConflict).toBe('github_repository_id,installation_id')
  })

  it('rejects when the user does not own the installation', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls, { ownerUserId: 'someone-else' })
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 1, name: 'r', owner: 'o' }])

    await expect(
      persistRepository({ supabase, getInstallationOctokit, userId: 'user-1', installationId: 'inst-uuid-1', githubRepositoryId: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(calls).toHaveLength(0)
  })

  it('rejects when the repo is not accessible by the installation', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 1, name: 'r', owner: 'o' }])

    await expect(
      persistRepository({ supabase, getInstallationOctokit, userId: 'user-1', installationId: 'inst-uuid-1', githubRepositoryId: 424242 }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(calls).toHaveLength(0)
  })

  it('does not trust client-sent owner/name (identity is from GitHub only)', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 7, name: 'real-name', owner: 'real-owner' }])

    // The helper signature has no owner/name inputs; this asserts the persisted
    // values come solely from the GitHub listing.
    await persistRepository({ supabase, getInstallationOctokit, userId: 'user-1', installationId: 'inst-uuid-1', githubRepositoryId: 7 })
    expect(calls[0].values.owner).toBe('real-owner')
    expect(calls[0].values.name).toBe('real-name')
  })
})

describe('resolvePersistRepository', () => {
  it('rejects unauthenticated before any GitHub or DB work', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = vi.fn(async () => fakeInstallationOctokit([]))
    await expect(
      resolvePersistRepository({ user: null, body: { installationId: 'i', githubRepositoryId: 1 }, supabase, getInstallationOctokit }),
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(getInstallationOctokit).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('rejects a missing installationId/githubRepositoryId with 400', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () => fakeInstallationOctokit([])
    await expect(
      resolvePersistRepository({ user: { id: 'user-1' }, body: {}, supabase, getInstallationOctokit }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(calls).toHaveLength(0)
  })

  it('persists and returns the repository on the happy path', async () => {
    const calls: UpsertCall[] = []
    const supabase = fakeSupabase(calls)
    const getInstallationOctokit = async () =>
      fakeInstallationOctokit([{ id: 5, name: 'svc', owner: 'team' }])
    const { repository } = await resolvePersistRepository({
      user: { id: 'user-1' },
      body: { installationId: 'inst-uuid-1', githubRepositoryId: 5 },
      supabase,
      getInstallationOctokit,
    })
    expect(repository).toMatchObject({ id: 'repo-uuid-1', owner: 'team', name: 'svc' })
  })
})
