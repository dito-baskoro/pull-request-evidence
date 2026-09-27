// Analysis run pipeline seam (plan sections 5, 9, 10; Milestones 2-4).
//
// Drives the run lifecycle:
//   queued -> ingesting -> deterministic -> ai -> validating -> complete/failed
//
// For this slice the orchestrator performs the deterministic, provider-
// independent work end to end:
//   1. Confirm the authenticated user OWNS the target installation.
//   2. Fetch PR metadata + files + checks (read-only) via a short-lived token.
//   3. Persist immutable artifacts with content_hash via the Supabase admin
//      client (service-role, server-only) after the ownership check.
//   4. Parse the selected changed text file(s) into evidence spans.
//   5. Build the deterministic change map.
//   6. Register evidence (opaque E-NNNNN IDs bound to the immutable head SHA).
//
// The AI + citation-validation steps are left as a typed hook that FEAT-003
// fills in. Deterministic evidence creation stays fully independent of any AI
// provider.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Octokit } from '@octokit/rest'
import type { AnalysisRunStatus } from '~/types/analysis'
import type { DeterministicChangeMap } from './change-map'
import type { EvidenceManifestEntry, EvidenceRegistry } from './evidence-registry'
import { fetchChecksForSha } from '../github/fetch-checks'
import { fetchPullRequest } from '../github/fetch-pr'
import { buildChangeMap } from './change-map'
import { buildEvidenceRegistry } from './evidence-registry'
import { classifyFile } from './classify-file'
import { sha256Hex } from '../hash'

/**
 * Typed hook for the AI + validation stage. FEAT-003 provides a real
 * implementation; the deterministic pipeline is complete and useful without it.
 */
export interface AiAnalysisHook {
  run(input: DeterministicResult): Promise<void>
}

/** The result of the deterministic phase, ready for the AI hook. */
export interface DeterministicResult {
  analysisRunId: string
  owner: string
  repo: string
  headSha: string
  changeMap: DeterministicChangeMap
  registry: EvidenceRegistry
  evidenceManifest: EvidenceManifestEntry[]
}

export interface OrchestratorDeps {
  /** Service-role Supabase client (server-only; used AFTER ownership check). */
  admin: SupabaseClient
  /** Read-only Octokit for the owning installation. */
  octokit: Octokit
  /** Optional AI stage; when absent the run stops after `deterministic`. */
  aiHook?: AiAnalysisHook
}

export interface OrchestratorInput {
  analysisRunId: string
  /** The authenticated user requesting the run. */
  userId: string
  /** Internal installation row id (uuid) the run belongs to. */
  installationId: string
  owner: string
  repo: string
  pullNumber: number
  /**
   * Optionally restrict which changed files are turned into evidence spans for
   * the slice. When omitted, all text files with a patch are used.
   */
  selectedPaths?: string[]
}

/**
 * Confirm the authenticated user owns the installation the run targets. Throws
 * when ownership cannot be established. This MUST run before any GitHub call or
 * privileged persistence.
 */
export async function assertUserOwnsInstallation(
  admin: SupabaseClient,
  userId: string,
  installationId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('github_installations')
    .select('id')
    .eq('id', installationId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Ownership check failed: ${error.message}`)
  }
  if (!data) {
    throw new Error('Forbidden: the current user does not own this installation.')
  }
}

/**
 * Read an error `code` string off a thrown value if present. The AI hook throws
 * an AiAnalysisError carrying a typed code; we read it structurally to avoid a
 * circular import between the orchestrator and the AI hook module.
 */
function readErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return null
}

/** Update the run status (best-effort; surfaces persistence errors). */
async function setStatus(
  admin: SupabaseClient,
  analysisRunId: string,
  status: AnalysisRunStatus,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin
    .from('analysis_runs')
    .update({ status, ...patch })
    .eq('id', analysisRunId)
  if (error) throw new Error(`Failed to set run status ${status}: ${error.message}`)
}

/**
 * Run the deterministic phase of the pipeline. Persists artifacts + evidence
 * spans via the admin client and returns the deterministic result. If an AI
 * hook is provided the run advances into `ai`/`validating`; otherwise it stops
 * at `deterministic` with the change map + evidence persisted.
 */
export async function runAnalysis(
  deps: OrchestratorDeps,
  input: OrchestratorInput,
): Promise<DeterministicResult> {
  const { admin, octokit, aiHook } = deps

  // 1. Ownership check BEFORE any GitHub call or privileged write.
  await assertUserOwnsInstallation(admin, input.userId, input.installationId)

  try {
    // 2. Ingest (read-only).
    await setStatus(admin, input.analysisRunId, 'ingesting', { started_at: new Date().toISOString() })
    const pr = await fetchPullRequest(octokit, input.owner, input.repo, input.pullNumber)
    const checks = await fetchChecksForSha(octokit, input.owner, input.repo, pr.metadata.headSha)

    // 3. Persist immutable artifacts with content hashes.
    await persistArtifacts(admin, input.analysisRunId, pr, checks)

    // 4/5. Deterministic phase: change map + evidence spans.
    await setStatus(admin, input.analysisRunId, 'deterministic')
    const changeMap = buildChangeMap(pr.files)

    const candidateFiles = pr.files.filter((f) => {
      if (!f.patch) return false
      const { category } = classifyFile(f.path)
      if (category === 'binary_unsupported' || category === 'lockfile' || category === 'generated') return false
      if (input.selectedPaths && !input.selectedPaths.includes(f.path)) return false
      return true
    })

    // Look up the persisted patch artifact ids so evidence points at them.
    const patchArtifacts = await loadPatchArtifactIds(admin, input.analysisRunId)
    const files = candidateFiles
      .map((file) => {
        const artifactId = patchArtifacts.get(file.path)
        return artifactId ? { file, patchArtifact: { id: artifactId } } : null
      })
      .filter((x): x is { file: typeof candidateFiles[number]; patchArtifact: { id: string } } => x !== null)

    const registry = buildEvidenceRegistry({
      owner: input.owner,
      repo: input.repo,
      headSha: pr.metadata.headSha,
      files,
    })

    await persistEvidenceSpans(admin, registry)

    const result: DeterministicResult = {
      analysisRunId: input.analysisRunId,
      owner: input.owner,
      repo: input.repo,
      headSha: pr.metadata.headSha,
      changeMap,
      registry,
      evidenceManifest: registry.manifest(),
    }

    // 6. AI + validation hook (FEAT-003). When absent, stop deterministically.
    if (aiHook) {
      // A provider failure or malformed output must produce a RECOVERABLE
      // failed state (error_code/error_message), never a crash and never a
      // corrupt "complete" run. The hook throws an AiAnalysisError carrying a
      // code; any other error is treated as an unexpected AI-stage failure.
      try {
        await setStatus(admin, input.analysisRunId, 'ai')
        await aiHook.run(result)
        await setStatus(admin, input.analysisRunId, 'validating')
      }
      catch (aiErr) {
        const message = aiErr instanceof Error ? aiErr.message : String(aiErr)
        const code = readErrorCode(aiErr) ?? 'ai_stage_error'
        await setStatus(admin, input.analysisRunId, 'failed', {
          error_code: code,
          error_message: message,
          coverage_status: 'partial',
          completed_at: new Date().toISOString(),
        }).catch(() => {})
        return result
      }
      await setStatus(admin, input.analysisRunId, 'complete', {
        completed_at: new Date().toISOString(),
        coverage_status: 'complete',
      })
    }
    else {
      await setStatus(admin, input.analysisRunId, 'deterministic', {
        coverage_status: 'partial',
        coverage_notes: { note: 'Deterministic phase complete; AI analysis not yet run (FEAT-003).' },
      })
    }

    return result
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus(admin, input.analysisRunId, 'failed', {
      error_message: message,
      completed_at: new Date().toISOString(),
    }).catch(() => {})
    throw err
  }
}

/** Persist normalized artifacts (pr_body, commit, file/patch, check). */
async function persistArtifacts(
  admin: SupabaseClient,
  analysisRunId: string,
  pr: Awaited<ReturnType<typeof fetchPullRequest>>,
  checks: Awaited<ReturnType<typeof fetchChecksForSha>>,
): Promise<void> {
  const rows: Array<Record<string, unknown>> = []

  // PR body artifact.
  const bodyContent = pr.metadata.body ?? ''
  rows.push({
    analysis_run_id: analysisRunId,
    kind: 'pr_body',
    external_id: String(pr.metadata.githubNumber),
    commit_sha: pr.metadata.headSha,
    file_path: null,
    content: bodyContent,
    content_hash: sha256Hex(bodyContent),
    metadata: { title: pr.metadata.title, author: pr.metadata.authorLogin },
  })

  // Commits.
  for (const commit of pr.commits) {
    rows.push({
      analysis_run_id: analysisRunId,
      kind: 'commit',
      external_id: commit.sha,
      commit_sha: commit.sha,
      file_path: null,
      content: commit.message,
      content_hash: sha256Hex(commit.message),
      metadata: { author: commit.authorLogin, authoredAt: commit.authoredAt },
    })
  }

  // One patch artifact per changed file that has a textual patch.
  for (const file of pr.files) {
    if (!file.patch) continue
    rows.push({
      analysis_run_id: analysisRunId,
      kind: 'patch',
      external_id: file.path,
      commit_sha: pr.metadata.headSha,
      file_path: file.path,
      content: file.patch,
      content_hash: sha256Hex(file.patch),
      metadata: { status: file.status, additions: file.additions, deletions: file.deletions },
    })
  }

  // Checks.
  for (const check of checks) {
    const content = `${check.name}:${check.status}:${check.conclusion ?? ''}`
    rows.push({
      analysis_run_id: analysisRunId,
      kind: 'check',
      external_id: String(check.githubCheckRunId),
      commit_sha: null,
      file_path: null,
      content,
      content_hash: sha256Hex(content),
      metadata: {
        status: check.status,
        conclusion: check.conclusion,
        detailsUrl: check.detailsUrl,
      },
    })
  }

  if (rows.length === 0) return
  const { error } = await admin.from('artifacts').insert(rows)
  if (error) throw new Error(`Failed to persist artifacts: ${error.message}`)
}

/** Map file_path -> persisted patch artifact id for this run. */
async function loadPatchArtifactIds(
  admin: SupabaseClient,
  analysisRunId: string,
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from('artifacts')
    .select('id, file_path')
    .eq('analysis_run_id', analysisRunId)
    .eq('kind', 'patch')
  if (error) throw new Error(`Failed to load patch artifacts: ${error.message}`)
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    if (row.file_path) map.set(row.file_path as string, row.id as string)
  }
  return map
}

/** Persist registered evidence spans. */
async function persistEvidenceSpans(
  admin: SupabaseClient,
  registry: EvidenceRegistry,
): Promise<void> {
  const spans = registry.toEvidenceSpanRows()
  if (spans.length === 0) return
  const rows = spans.map((s) => ({
    artifact_id: s.artifactId,
    evidence_key: s.evidenceKey,
    source_type: s.sourceType,
    commit_sha: s.commitSha,
    file_path: s.filePath,
    side: s.side,
    start_line: s.startLine,
    end_line: s.endLine,
    excerpt: s.excerpt,
    excerpt_hash: s.excerptHash,
    permalink: s.permalink,
  }))
  const { error } = await admin.from('evidence_spans').insert(rows)
  if (error) throw new Error(`Failed to persist evidence spans: ${error.message}`)
}
