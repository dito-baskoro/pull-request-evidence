// AI analysis hook (plan section 10; Milestone 5).
//
// This fills the orchestrator's typed `AiAnalysisHook` seam. After the
// deterministic phase (change map + evidence registry) it:
//   1. runs the behavioral-change pass through an injected analyzer,
//   2. validates every citation against the registry + analyzed SHA,
//   3. persists the accepted/downgraded items to report_items and their valid
//      citations to report_item_evidence,
//   4. records workflow_version + model_id on the analysis_run for provenance.
//
// Provider or malformed-output failures are surfaced to the orchestrator, which
// records a recoverable `failed` state; this hook never crashes the process.
//
// All provider access is via the injected BehaviorAnalyzer (default built in
// ./provider.ts), so this module stays testable with a fake analyzer.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiAnalysisHook, DeterministicResult } from '../analysis/orchestrator'
import type { BehaviorAnalyzer } from './provider'
import { analyzeBehavior } from './analyze-behavior'
import { validateCitations } from '../analysis/citation-validator'

/** Workflow version for the behavioral-change slice. */
export const BEHAVIOR_WORKFLOW_VERSION = 'behavior-pass-v1'

/** Error codes recorded on the run for a recoverable failure. */
export type AiFailureCode = 'ai_provider_error' | 'ai_malformed_output'

/**
 * An error the orchestrator can map to a recoverable failed state. `code`
 * distinguishes a provider/transport failure from schema-invalid output.
 */
export class AiAnalysisError extends Error {
  readonly code: AiFailureCode
  constructor(code: AiFailureCode, message: string) {
    super(message)
    this.name = 'AiAnalysisError'
    this.code = code
  }
}

export interface BehaviorHookDeps {
  admin: SupabaseClient
  analyzer: BehaviorAnalyzer
  workflowVersion?: string
}

/**
 * Build the AI hook. The orchestrator calls `run(deterministicResult)` between
 * its `ai` and `validating` status transitions.
 */
export function createBehaviorAnalysisHook(deps: BehaviorHookDeps): AiAnalysisHook {
  const workflowVersion = deps.workflowVersion ?? BEHAVIOR_WORKFLOW_VERSION

  return {
    async run(result: DeterministicResult): Promise<void> {
      // 1. Behavioral-change pass. A provider/transport error or schema-invalid
      // output must NOT crash: convert to a typed AiAnalysisError so the
      // orchestrator records a recoverable failure.
      let claims
      let modelId: string
      try {
        const analysis = await analyzeBehavior(deps.analyzer, {
          manifest: result.evidenceManifest,
          changeMap: result.changeMap,
        })
        claims = analysis.claims
        modelId = analysis.modelId
      }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // The analyzer parses against the strict Zod schema; a ZodError here
        // means malformed output, anything else is a provider/transport error.
        const code: AiFailureCode = isSchemaError(err) ? 'ai_malformed_output' : 'ai_provider_error'
        throw new AiAnalysisError(code, message)
      }

      // 2. Validate citations against the registry and the analyzed SHA.
      const report = validateCitations({
        claims,
        registry: result.registry,
        analyzedSha: result.headSha,
      })

      // 3. Record provenance on the run BEFORE persisting items so a later
      // failure still leaves the model/workflow recorded.
      await recordProvenance(deps.admin, result.analysisRunId, workflowVersion, modelId)

      // 4. Persist accepted (valid + downgraded) items and their valid
      // citations. Downgraded items carry no evidence ids by construction.
      await persistReportItems(deps.admin, result, report.accepted)
    },
  }
}

/** True when the error is a Zod schema validation failure (malformed output). */
function isSchemaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'ZodError' || name === 'AI_TypeValidationError' || name === 'TypeValidationError'
}

/** Persist workflow_version + model_id on the run (plan section 10, step 8). */
async function recordProvenance(
  admin: SupabaseClient,
  analysisRunId: string,
  workflowVersion: string,
  modelId: string,
): Promise<void> {
  const { error } = await admin
    .from('analysis_runs')
    .update({ workflow_version: workflowVersion, model_id: modelId })
    .eq('id', analysisRunId)
  if (error) throw new Error(`Failed to record provenance: ${error.message}`)
}

/**
 * Persist validated items + citation joins. Each accepted item becomes a
 * report_items row; its valid evidence ids are resolved to evidence_span ids
 * and inserted into report_item_evidence.
 */
async function persistReportItems(
  admin: SupabaseClient,
  result: DeterministicResult,
  items: ReturnType<typeof validateCitations>['accepted'],
): Promise<void> {
  if (items.length === 0) return

  // Resolve evidence_key -> evidence_span id for this run so we can build the
  // join rows. RLS-independent (service-role); scoped to the run's artifacts.
  const evidenceKeyToId = await loadEvidenceSpanIds(admin, result.analysisRunId)

  // Insert all items in a SINGLE batch so a failure leaves NO partial report
  // items under a run the orchestrator will mark `failed`. A per-item loop
  // could leave already-inserted rows behind when a later insert fails; a batch
  // insert is rejected or accepted as a whole. `select('id')` returns the ids
  // in insert order so we can build the citation joins.
  const itemRows = items.map((item, index) => ({
    analysis_run_id: result.analysisRunId,
    section: 'behavioral_changes',
    classification: item.classification,
    title: item.affectedComponent,
    statement: item.behaviorStatement,
    severity: null,
    confidence: item.confidence,
    sort_order: index,
    validation_status: item.validationStatus,
    metadata: {
      userVisible: item.userVisible,
      affectedComponent: item.affectedComponent,
      downgradeReason: item.downgradeReason,
    },
  }))

  const { data: inserted, error: itemErr } = await admin
    .from('report_items')
    .insert(itemRows)
    .select('id')

  if (itemErr || !inserted || inserted.length !== items.length) {
    throw new Error(`Failed to persist report items: ${itemErr?.message ?? 'unexpected row count'}`)
  }

  // Build every citation join row up front, pairing each inserted id with its
  // originating item (same order as itemRows).
  const joinRows = items.flatMap((item, index) =>
    item.evidenceIds
      .map((key) => evidenceKeyToId.get(key))
      .filter((id): id is string => Boolean(id))
      .map((evidenceSpanId) => ({
        report_item_id: inserted[index].id,
        evidence_span_id: evidenceSpanId,
        support_type: 'supports' as const,
      })),
  )

  if (joinRows.length > 0) {
    const { error: joinErr } = await admin.from('report_item_evidence').insert(joinRows)
    if (joinErr) {
      // The join insert failed after items were inserted. Roll the items back
      // so the failed run leaves no partial report items (no orphaned rows
      // without their evidence). Best-effort: surface the original error.
      await admin.from('report_items').delete().eq('analysis_run_id', result.analysisRunId).then(
        () => undefined,
        () => undefined,
      )
      throw new Error(`Failed to persist report item evidence: ${joinErr.message}`)
    }
  }
}

/** Map evidence_key -> evidence_span id for the run's registered spans. */
async function loadEvidenceSpanIds(
  admin: SupabaseClient,
  analysisRunId: string,
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from('evidence_spans')
    .select('id, evidence_key, artifacts!inner(analysis_run_id)')
    .eq('artifacts.analysis_run_id', analysisRunId)
  if (error) throw new Error(`Failed to load evidence span ids: ${error.message}`)
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    map.set(row.evidence_key as string, row.id as string)
  }
  return map
}
