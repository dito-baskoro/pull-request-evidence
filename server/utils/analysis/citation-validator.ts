// Citation and provenance validator (plan section 10 "Output validation";
// Milestone 5). PURE FUNCTION: no I/O, no provider, heavily unit-tested.
//
// Given the behavioral claims emitted by the AI pass and the run's registered
// evidence, this enforces the four provenance rules from plan section 10:
//
//   (1) Every cited evidence id exists in the registry.
//   (2) The cited evidence belongs to the CURRENT analysis run AND the analyzed
//       commit SHA (a citation to a span from a different SHA is rejected).
//   (3) Observed / inferred behavioral items REQUIRE at least one valid
//       evidence id.
//   (4) Items with invalid or missing evidence are never shown as facts: they
//       are removed, or downgraded to the `unknown` classification when there
//       is still a useful (unproven) statement to surface.
//
// It returns a validation report: the accepted items (with their validation
// status and the accepted evidence ids) plus per-item rejection reasons, so the
// orchestrator can persist accurately and the UI can show limitations.

import type { BehavioralClaimOutput } from '../ai/schemas'
import type { ReportItemClassification, ValidationStatus } from '~/types/report'

/**
 * Minimal registry view the validator needs. The real EvidenceRegistry
 * satisfies this; tests can pass a lightweight fake. Each entry exposes the
 * commit SHA it is bound to so rule (2) can be enforced.
 */
export interface EvidenceLookup {
  has(evidenceKey: string): boolean
  lookup(evidenceKey: string): { commitSha: string } | null
}

/** Why a single cited evidence id was rejected. */
export type CitationRejectionReason =
  | 'unknown_id'
  | 'sha_mismatch'

/** Why an item was downgraded or dropped. */
export type ItemRejectionReason =
  | 'no_evidence_cited'
  | 'no_valid_evidence'

export interface CitationCheck {
  evidenceKey: string
  valid: boolean
  reason: CitationRejectionReason | null
}

/**
 * An accepted (or downgraded) behavioral claim after validation. Downgraded
 * items keep their statement but are reclassified to `unknown` and MUST NOT be
 * rendered as an observed/inferred fact.
 */
export interface ValidatedItem {
  behaviorStatement: string
  /** Post-validation classification: original observed/inferred, or unknown. */
  classification: ReportItemClassification
  affectedComponent: string
  userVisible: boolean
  confidence: number
  /** Only the evidence ids that passed validation. */
  evidenceIds: string[]
  validationStatus: ValidationStatus
  /** Populated when the item was downgraded, for UI limitations display. */
  downgradeReason: ItemRejectionReason | null
}

/** A claim that was dropped entirely (no salvageable statement). */
export interface DroppedItem {
  behaviorStatement: string
  originalClassification: ReportItemClassification
  reason: ItemRejectionReason
  citations: CitationCheck[]
}

export interface CitationValidationReport {
  /** Items safe to persist/show (valid facts, or unknown downgrades). */
  accepted: ValidatedItem[]
  /** Items removed entirely. */
  dropped: DroppedItem[]
  /** Per-item citation-level detail for auditing/evaluation. */
  perItem: Array<{
    behaviorStatement: string
    citations: CitationCheck[]
  }>
}

export interface ValidateCitationsInput {
  claims: BehavioralClaimOutput[]
  registry: EvidenceLookup
  /** The immutable head SHA the run is bound to. */
  analyzedSha: string
  /**
   * When true (default), items whose evidence all fails are DOWNGRADED to
   * `unknown` and kept (never shown as facts). When false, such items are
   * dropped entirely. Either way they never appear as observed/inferred facts.
   */
  downgradeUnsupported?: boolean
}

/** Validate a single citation against rules (1) and (2). */
function checkCitation(
  evidenceKey: string,
  registry: EvidenceLookup,
  analyzedSha: string,
): CitationCheck {
  // Rule (1): the id must exist in the registry.
  const entry = registry.lookup(evidenceKey)
  if (!entry) {
    return { evidenceKey, valid: false, reason: 'unknown_id' }
  }
  // Rule (2): the evidence must belong to the analyzed commit SHA.
  if (entry.commitSha !== analyzedSha) {
    return { evidenceKey, valid: false, reason: 'sha_mismatch' }
  }
  return { evidenceKey, valid: true, reason: null }
}

/**
 * Validate the behavioral claims from the AI pass against the run's evidence.
 * Deterministic and side-effect free.
 */
export function validateCitations(input: ValidateCitationsInput): CitationValidationReport {
  const downgradeUnsupported = input.downgradeUnsupported ?? true
  const accepted: ValidatedItem[] = []
  const dropped: DroppedItem[] = []
  const perItem: CitationValidationReport['perItem'] = []

  for (const claim of input.claims) {
    const citations = claim.evidenceIds.map((id) =>
      checkCitation(id, input.registry, input.analyzedSha),
    )
    perItem.push({ behaviorStatement: claim.behaviorStatement, citations })

    const validIds = citations.filter((c) => c.valid).map((c) => c.evidenceKey)

    // Rule (3): observed/inferred items require at least one valid evidence id.
    // (The strict schema already restricts classification to observed|inferred.)
    if (claim.evidenceIds.length === 0) {
      handleUnsupported(claim, citations, 'no_evidence_cited', downgradeUnsupported, accepted, dropped)
      continue
    }
    if (validIds.length === 0) {
      handleUnsupported(claim, citations, 'no_valid_evidence', downgradeUnsupported, accepted, dropped)
      continue
    }

    // Accepted as a fact: keep only the valid evidence ids.
    accepted.push({
      behaviorStatement: claim.behaviorStatement,
      classification: claim.classification,
      affectedComponent: claim.affectedComponent,
      userVisible: claim.userVisible,
      confidence: claim.confidence,
      evidenceIds: validIds,
      validationStatus: 'valid',
      downgradeReason: null,
    })
  }

  return { accepted, dropped, perItem }
}

/**
 * Rule (4): an item with no valid evidence is never shown as a fact. Depending
 * on policy it is either downgraded to `unknown` (kept, but not a fact) or
 * dropped entirely.
 */
function handleUnsupported(
  claim: BehavioralClaimOutput,
  citations: CitationCheck[],
  reason: ItemRejectionReason,
  downgradeUnsupported: boolean,
  accepted: ValidatedItem[],
  dropped: DroppedItem[],
): void {
  if (downgradeUnsupported) {
    accepted.push({
      behaviorStatement: claim.behaviorStatement,
      classification: 'unknown',
      affectedComponent: claim.affectedComponent,
      userVisible: claim.userVisible,
      confidence: claim.confidence,
      evidenceIds: [],
      validationStatus: 'downgraded',
      downgradeReason: reason,
    })
  }
  else {
    dropped.push({
      behaviorStatement: claim.behaviorStatement,
      originalClassification: claim.classification,
      reason,
      citations,
    })
  }
}
