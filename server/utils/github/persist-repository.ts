// Persist a repository the signed-in user selected (Milestone 2).
//
// This is the testable core of POST /api/github/repositories. It is extracted
// here (rather than inline in the route) because the route relies on Nitro
// auto-imported globals (createSupabaseServerClient) that do not exist under
// vitest. The route resolves the authenticated user and its dependencies, then
// hands them to this helper so the persist logic can be unit-tested with fakes.
//
// Why persist at all: repositories are otherwise live-fetched and their id is
// blank. The pull-request list and analysis endpoints key off a stored
// repositories.id (uuid), so the selected repo must be persisted first.
//
// Security posture:
//   - The installation MUST belong to the SSR-resolved user before any write;
//     verified here against the app-local installation uuid, never trusting a
//     client-supplied user id. RLS additionally scopes the write.
//   - owner / name / default_branch / is_private are resolved AUTHORITATIVELY
//     from GitHub via the installation token, never trusted from client input.
//   - No installation access token is minted here, returned, or logged.

import type { Repository } from '~/types/github'

/**
 * Minimal shape of the installation-scoped Octokit this helper needs: it lists
 * the repositories the installation can access so the persisted identity is
 * authoritative. Tests inject a small fake.
 */
export interface InstallationOctokitLike {
  paginate(
    route: unknown,
    params: { per_page: number },
  ): Promise<Array<{
    id: number
    name: string
    private?: boolean
    default_branch?: string | null
    owner?: { login?: string | null } | null
  }>>
  rest: { apps: { listReposAccessibleToInstallation: unknown } }
}

/**
 * Minimal SSR Supabase client shape: an ownership read on github_installations
 * and an idempotent upsert on repositories returning the persisted row.
 */
export interface SupabaseLike {
  from(table: string): any
}

/** Error carrying an HTTP-style status so the route can map it to createError. */
export class PersistRepositoryError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'PersistRepositoryError'
    this.statusCode = statusCode
  }
}

/** Validate and return the app-local installation uuid from the request body. */
export function parseInstallationUuid(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new PersistRepositoryError(400, 'installationId (uuid) is required.')
  }
  return raw
}

/** Validate and return the numeric GitHub repository id from the request body. */
export function parseGithubRepositoryId(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
    throw new PersistRepositoryError(400, 'A positive githubRepositoryId is required.')
  }
  return value
}

export interface PersistRepositoryArgs {
  supabase: SupabaseLike
  /** Factory that returns an installation-scoped Octokit for a numeric id. */
  getInstallationOctokit: (githubInstallationId: number) => Promise<InstallationOctokitLike>
  /** The SSR-resolved authenticated user id (auth.uid()). */
  userId: string
  /** The app-local installation uuid (from repositories.get.ts / the client). */
  installationId: string
  /** The numeric GitHub repository id the user selected. */
  githubRepositoryId: number
}

/**
 * Verify installation ownership, resolve the repository's authoritative
 * identity from GitHub, and upsert an owner-scoped repositories row. Idempotent
 * on unique (github_repository_id, installation_id) so re-selecting a repo
 * refreshes its fields and returns the same id.
 */
export async function persistRepository(args: PersistRepositoryArgs): Promise<Repository> {
  const { supabase, userId, installationId, githubRepositoryId } = args

  // Ownership: the app-local installation must belong to this user. Resolve the
  // numeric github_installation_id needed to talk to GitHub.
  const { data: installation, error: instErr } = await supabase
    .from('github_installations')
    .select('id, github_installation_id')
    .eq('id', installationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (instErr) {
    throw new PersistRepositoryError(500, instErr.message)
  }
  if (!installation) {
    throw new PersistRepositoryError(403, 'You do not own this installation.')
  }

  // Resolve the repository's authoritative identity from GitHub via the
  // installation token. Never trust client-sent owner/name/visibility.
  const octokit = await args.getInstallationOctokit(installation.github_installation_id as number)
  const repos = await octokit.paginate(
    octokit.rest.apps.listReposAccessibleToInstallation,
    { per_page: 100 },
  )
  const match = repos.find(r => r.id === githubRepositoryId)
  if (!match) {
    throw new PersistRepositoryError(
      404,
      'Repository is not accessible by this installation. Re-run the GitHub App install and select it.',
    )
  }

  const { data: row, error } = await supabase
    .from('repositories')
    .upsert(
      {
        installation_id: installationId,
        github_repository_id: match.id,
        owner: match.owner?.login ?? '',
        name: match.name,
        default_branch: match.default_branch ?? 'main',
        is_private: Boolean(match.private),
      },
      { onConflict: 'github_repository_id,installation_id' },
    )
    .select('id, installation_id, github_repository_id, owner, name, default_branch, is_private, created_at')
    .single()

  if (error || !row) {
    throw new PersistRepositoryError(500, error?.message ?? 'Failed to persist the repository.')
  }

  return {
    id: row.id,
    installationId: row.installation_id,
    githubRepositoryId: row.github_repository_id,
    owner: row.owner,
    name: row.name,
    defaultBranch: row.default_branch,
    isPrivate: row.is_private,
    createdAt: row.created_at,
  }
}

/** Raw request body accepted by the persist-repository route. */
export interface PersistRepositoryBody {
  installationId?: string
  githubRepositoryId?: number | string
}

/** Minimal authenticated user shape (the SSR user). */
export interface ConnectUser {
  id: string
}

export interface ResolvePersistRepositoryArgs {
  user: ConnectUser | null
  body: PersistRepositoryBody | null | undefined
  supabase: SupabaseLike
  getInstallationOctokit: (githubInstallationId: number) => Promise<InstallationOctokitLike>
}

/**
 * Route-level logic extracted for unit testing: 401 guard, body validation,
 * owner binding, and delegation to persistRepository. All thrown errors are
 * PersistRepositoryError with a statusCode the route maps to createError.
 */
export async function resolvePersistRepository(
  args: ResolvePersistRepositoryArgs,
): Promise<{ repository: Repository }> {
  const { user, body, supabase, getInstallationOctokit } = args

  if (!user) {
    throw new PersistRepositoryError(401, 'Authentication required.')
  }

  const installationId = parseInstallationUuid(body?.installationId)
  const githubRepositoryId = parseGithubRepositoryId(body?.githubRepositoryId)

  const repository = await persistRepository({
    supabase,
    getInstallationOctokit,
    userId: user.id,
    installationId,
    githubRepositoryId,
  })

  return { repository }
}
