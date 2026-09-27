// Behavioral-change pass orchestration (plan section 10, Pass B; Milestone 5).
//
// Assembles the context (evidence manifest + deterministic change map) and runs
// a single behavioral-change pass through an injected `BehaviorAnalyzer`. This
// module performs NO persistence and NO direct provider access: the analyzer is
// the seam, so the pipeline can be driven by a fake analyzer in tests with no
// network. The provider-backed default lives in ./provider.ts.

import type { DeterministicChangeMap } from '../analysis/change-map'
import type { EvidenceManifestEntry } from '../analysis/evidence-registry'
import type { BehavioralClaimOutput } from './schemas'
import type { BehaviorAnalyzer } from './provider'

export interface AnalyzeBehaviorInput {
  manifest: EvidenceManifestEntry[]
  changeMap: DeterministicChangeMap
}

export interface AnalyzeBehaviorResult {
  /** Schema-valid behavioral claims (NOT yet citation-validated). */
  claims: BehavioralClaimOutput[]
  /** Concrete model id used, for provenance persistence. */
  modelId: string
}

/**
 * Run the behavioral-change pass over injected inputs. The analyzer parses its
 * own output against the strict Zod schema, so `claims` here are already
 * shape-valid. Citation/provenance validation happens next in the pipeline
 * (citation-validator), keeping this function a pure-ish transform.
 */
export async function analyzeBehavior(
  analyzer: BehaviorAnalyzer,
  input: AnalyzeBehaviorInput,
): Promise<AnalyzeBehaviorResult> {
  const { output, modelId } = await analyzer.analyze({
    manifest: input.manifest,
    changeMap: input.changeMap,
  })
  return { claims: output.items, modelId }
}
