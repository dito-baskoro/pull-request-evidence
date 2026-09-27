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
    .select('id, status, workflow_version, model_id, coverage_status, coverage_notes, error_code, error_message, started_at, completed_at')
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

  // Fast lookup from evidence key -> full span (for embedding citation spans on
  // each report item so the report view can render clickable permalinks).
  const spanByKey = new Map(evidence.map((e) => [e.evidenceKey, e]))

  // Validated behavioral-change report items with their cited evidence spans.
  // report_item_evidence joins to evidence_spans by id; we resolve back to the
  // full span (including its immutable-SHA permalink) via the join select.
  const { data: itemRows } = await supabase
    .from('report_items')
    .select(
      'id, section, classification, title, statement, severity, confidence, sort_order, validation_status, metadata, ' +
        'report_item_evidence(support_type, evidence_spans(evidence_key, commit_sha, file_path, side, start_line, end_line, excerpt, permalink))',
    )
    .eq('analysis_run_id', id)
    .order('sort_order', { ascending: true })

  const reportItems = (itemRows ?? []).map((row) => {
    const joins = (row.report_item_evidence ?? []) as Array<{
      support_type: string
      evidence_spans: {
        evidence_key: string
        commit_sha: string
        file_path: string | null
        side: string
        start_line: number | null
        end_line: number | null
        excerpt: string
        permalink: string | null
      } | null
    }>
    const citedEvidence = joins
      .map((j) => j.evidence_spans)
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({
        evidenceKey: s.evidence_key,
        commitSha: s.commit_sha,
        filePath: s.file_path,
        side: s.side,
        startLine: s.start_line,
        endLine: s.end_line,
        excerpt: s.excerpt,
        // Prefer the persisted permalink; fall back to the run's span map.
        permalink: s.permalink ?? spanByKey.get(s.evidence_key)?.permalink ?? null,
      }))
    return {
      id: row.id,
      section: row.section,
      classification: row.classification,
      title: row.title,
      statement: row.statement,
      severity: row.severity,
      confidence: row.confidence,
      sortOrder: row.sort_order,
      validationStatus: row.validation_status,
      metadata: row.metadata,
      evidence: citedEvidence,
    }
  })

  return {
    analysisId: run.id,
    status: run.status as AnalysisRunStatus,
    workflowVersion: run.workflow_version,
    modelId: run.model_id,
    coverageStatus: run.coverage_status,
    coverageNotes: run.coverage_notes,
    errorCode: run.error_code,
    errorMessage: run.error_message,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    changeMap,
    evidence,
    reportItems,
  }
})
