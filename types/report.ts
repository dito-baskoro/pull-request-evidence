// Shared report domain types (plan sections 7 and 10).
// These describe the cited report items produced by the AI passes and their
// links to evidence spans. FEAT-003 validates and persists these.

/**
 * Classification of a report item. This exact union is required by the plan
 * (section 7) and drives distinct rendering per class (section 10, Pass E).
 */
export type ReportItemClassification =
  | 'observed'
  | 'inferred'
  | 'potential_risk'
  | 'unknown'
  | 'question'

/** Section of the report a given item belongs to (plan section 4). */
export type ReportSection =
  | 'stated_intent'
  | 'change_map'
  | 'behavioral_changes'
  | 'requirement_traceability'
  | 'potential_risks'
  | 'test_evidence'
  | 'ci_checks'
  | 'unknowns'
  | 'reviewer_questions'

/** Result of citation/provenance validation for an item (plan section 10). */
export type ValidationStatus = 'pending' | 'valid' | 'downgraded' | 'rejected'

/** A single report item (plan section 7). */
export interface ReportItem {
  id: string
  analysisRunId: string
  section: ReportSection
  classification: ReportItemClassification
  title: string
  statement: string
  severity: string | null
  confidence: number
  sortOrder: number
  validationStatus: ValidationStatus
  metadata: Record<string, unknown> | null
}

export type EvidenceSupportType = 'supports' | 'contextualizes' | 'contradicts'

/** Join between a report item and an evidence span (plan section 7). */
export interface ReportItemEvidence {
  reportItemId: string
  evidenceSpanId: string
  supportType: EvidenceSupportType
}

/**
 * A structured behavioral-change claim produced by AI Pass B (plan section 10).
 * `classification` is restricted to observed/inferred at the AI boundary; the
 * broader ReportItemClassification union applies once persisted. Every claim
 * must cite at least one registered evidence key.
 */
export interface BehavioralClaim {
  statement: string
  classification: Extract<ReportItemClassification, 'observed' | 'inferred'>
  affectedComponent: string
  userVisible: boolean
  confidence: number
  /** Registered evidence keys (e.g. `E-00001`) that support this claim. */
  evidenceKeys: string[]
}

/** A citation as emitted by a model, before validation (plan section 10). */
export interface Citation {
  evidenceKey: string
  supportType: EvidenceSupportType
}

/** Outcome of validating a single citation against the run's evidence set. */
export interface CitationValidationResult {
  evidenceKey: string
  exists: boolean
  belongsToRun: boolean
  matchesSha: boolean
  valid: boolean
  reason: string | null
}
