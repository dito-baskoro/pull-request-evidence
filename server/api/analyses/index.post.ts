// POST /api/analyses (plan section 11; Milestones 2-4).
//
// Body: { repositoryId: uuid, pullRequestNumber: number }
// Response: { analysisId: uuid, status }
//
// The server confirms the current user owns the matching installation before
// creating the run, then runs the deterministic pipeline (fetch -> persist ->
// change map -> evidence). Installation tokens are never returned to the
// client. Persistence uses the service-role admin client only AFTER the
// ownership check.

import { createError, defineEventHandler, readBody } from 'h3'
import type { AnalysisRunStatus } from '~/types/analysis'
import { getInstallationOctokit } from '~/server/utils/github/app-auth'
import { runAnalysis } from '~/server/utils/analysis/orchestrator'

const WORKFLOW_VERSION = 'slice-1'
const MODEL_ID = 'deterministic-only'

interface CreateAnalysisBody {
  repositoryId?: string
  pullRequestNumber?: number
}

export default defineEventHandler(async (event): Promise<{ analysisId: string; status: AnalysisRunStatus }> => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const body = await readBody<CreateAnalysisBody>(event)
  const repositoryId = body?.repositoryId
  const pullRequestNumber = body?.pullRequestNumber
  if (!repositoryId || typeof pullRequestNumber !== 'number') {
    throw createError({
      statusCode: 400,
      statusMessage: 'repositoryId (uuid) and pullRequestNumber (number) are required.',
    })
  }

  // Ownership check via repository -> installation -> user (also enforced by
  // RLS on this per-request client).
  const { data: repo, error: repoErr } = await supabase
    .from('repositories')
    .select('id, owner, name, installation_id, github_installations!inner(id, github_installation_id, user_id)')
    .eq('id', repositoryId)
    .eq('github_installations.user_id', user.id)
    .maybeSingle()

  if (repoErr) {
    throw createError({ statusCode: 500, statusMessage: repoErr.message })
  }
  if (!repo) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot analyze this repository.' })
  }

  const installation = Array.isArray(repo.github_installations)
    ? repo.github_installations[0]
    : repo.github_installations
  const githubInstallationId = installation.github_installation_id as number

  // Fetch the PR head SHA so the run binds to an immutable target. Read-only.
  const octokit = await getInstallationOctokit(githubInstallationId)
  const { data: prData } = await octokit.rest.pulls.get({
    owner: repo.owner as string,
    repo: repo.name as string,
    pull_number: pullRequestNumber,
  })

  // Upsert the pull_requests row (idempotent on repo + number + head SHA).
  const { data: prRow, error: prErr } = await supabase
    .from('pull_requests')
    .upsert(
      {
        repository_id: repositoryId,
        github_number: prData.number,
        title: prData.title,
        body: prData.body ?? null,
        author_login: prData.user?.login ?? null,
        base_sha: prData.base.sha,
        head_sha: prData.head.sha,
        state: prData.merged ? 'merged' : prData.state,
        source_updated_at: prData.updated_at ?? null,
      },
      { onConflict: 'repository_id,github_number,head_sha' },
    )
    .select('id')
    .single()

  if (prErr || !prRow) {
    throw createError({ statusCode: 500, statusMessage: prErr?.message ?? 'Failed to record pull request.' })
  }

  // Create (or reuse) the analysis run. Idempotent on the plan's key.
  const { data: runRow, error: runErr } = await supabase
    .from('analysis_runs')
    .upsert(
      {
        pull_request_id: prRow.id,
        requested_by: user.id,
        status: 'queued',
        workflow_version: WORKFLOW_VERSION,
        model_id: MODEL_ID,
      },
      { onConflict: 'pull_request_id,workflow_version,model_id' },
    )
    .select('id, status')
    .single()

  if (runErr || !runRow) {
    throw createError({ statusCode: 500, statusMessage: runErr?.message ?? 'Failed to create analysis run.' })
  }

  // Run the deterministic pipeline with the service-role admin client. The
  // orchestrator re-checks installation ownership before any privileged write.
  const admin = createSupabaseAdminClient()
  try {
    await runAnalysis(
      { admin, octokit },
      {
        analysisRunId: runRow.id,
        userId: user.id,
        installationId: repo.installation_id as string,
        owner: repo.owner as string,
        repo: repo.name as string,
        pullNumber: pullRequestNumber,
      },
    )
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw createError({ statusCode: 502, statusMessage: `Analysis failed: ${message}` })
  }

  // Return the current status (never a token).
  const { data: finalRun } = await supabase
    .from('analysis_runs')
    .select('status')
    .eq('id', runRow.id)
    .single()

  return { analysisId: runRow.id, status: (finalRun?.status ?? 'deterministic') as AnalysisRunStatus }
})
