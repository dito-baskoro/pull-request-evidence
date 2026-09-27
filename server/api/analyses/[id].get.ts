// GET /api/analyses/:id (plan section 11; Milestones 3-4).
//
// Returns the run status plus the persisted change map (rebuilt from patch
// artifacts) and registered evidence spans. RLS restricts a user to their own
// runs; no installation token is ever included in the response.

import { createError, defineEventHandler, getRouterParam } from 'h3'
import type { AnalysisRunStatus } from '~/types/analysis'
import type { ChangedFile, ChangeStatus } from '~/types/github'
import { buildChangeMap } from '~/server/utils/analysis/change-map'

export default defineEventHandler(async (event) => {
  const supabase = createSupabaseServerClient(event)
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required.' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'analysis id is required.' })
  }

  // RLS scopes this select to the requester's own runs.
  const { data: run, error: runErr } = await supabase
    .from('analysis_runs')
    .select('id, status, coverage_status, coverage_notes, error_message, started_at, completed_at')
    .eq('id', id)
    .eq('requested_by', user.id)
    .maybeSingle()

  if (runErr) {
    throw createError({ statusCode: 500, statusMessage: runErr.message })
  }
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Analysis run not found.' })
  }

  // Rebuild the change map from persisted patch artifacts so the response is
  // self-contained. Patch artifacts store per-file status/additions/deletions
  // in metadata.
  const { data: patches } = await supabase
    .from('artifacts')
    .select('file_path, content, metadata')
    .eq('analysis_run_id', id)
    .eq('kind', 'patch')

  const files: ChangedFile[] = (patches ?? []).map((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>
    return {
      path: (p.file_path as string) ?? '',
      previousPath: null,
      status: ((meta.status as ChangeStatus) ?? 'changed'),
      additions: Number(meta.additions ?? 0),
      deletions: Number(meta.deletions ?? 0),
      changes: Number(meta.additions ?? 0) + Number(meta.deletions ?? 0),
      patch: (p.content as string) ?? null,
      sha: null,
    }
  })
  const changeMap = buildChangeMap(files)

  // Registered evidence spans (via the artifact -> run chain, RLS-scoped).
  const { data: spans } = await supabase
    .from('evidence_spans')
    .select('evidence_key, source_type, commit_sha, file_path, side, start_line, end_line, excerpt, permalink, artifacts!inner(analysis_run_id)')
    .eq('artifacts.analysis_run_id', id)
    .order('evidence_key', { ascending: true })

  const evidence = (spans ?? []).map((s) => ({
    evidenceKey: s.evidence_key,
    sourceType: s.source_type,
    commitSha: s.commit_sha,
    filePath: s.file_path,
    side: s.side,
    startLine: s.start_line,
    endLine: s.end_line,
    excerpt: s.excerpt,
    permalink: s.permalink,
  }))

  return {
    analysisId: run.id,
    status: run.status as AnalysisRunStatus,
    coverageStatus: run.coverage_status,
    coverageNotes: run.coverage_notes,
    errorMessage: run.error_message,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    changeMap,
    evidence,
  }
})
