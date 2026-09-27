// AI output schemas (plan section 10; Milestone 5).
//
// Every AI pass is schema-constrained. The behavioral-change pass (Pass B)
// output is validated against a STRICT Zod schema so that:
//   - unknown/hallucinated fields are rejected (`.strict()`),
//   - classification is restricted to `observed` | `inferred` (Pass B never
//     mixes observed and inferred, and the broader ReportItemClassification
//     union only applies AFTER validation/persistence),
//   - confidence is bounded to [0, 1],
//   - every cited evidence id has the opaque `E-NNNNN` shape (the citation
//     validator later confirms each id actually exists in the run's registry
//     and belongs to the analyzed SHA).
//
// This module has NO provider or network coupling; it only describes shapes.

import { z } from 'zod'

/** Opaque evidence-key shape produced by the evidence registry (E-00001). */
export const evidenceKeySchema = z
  .string()
  .regex(/^E-\d{5,}$/u, 'evidence id must look like E-00001')

/**
 * A single behavioral-change item (Pass B). `.strict()` rejects any field the
 * model invents that is not declared here.
 */
export const behavioralClaimSchema = z
  .object({
    behaviorStatement: z.string().min(1, 'behaviorStatement is required'),
    classification: z.enum(['observed', 'inferred']),
    affectedComponent: z.string().min(1, 'affectedComponent is required'),
    userVisible: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(evidenceKeySchema),
  })
  .strict()

/**
 * The Pass B response: at least one behavioral-change item. The slice requires
 * producing at least one claim, so an empty array is rejected here.
 */
export const behaviorAnalysisSchema = z
  .object({
    items: z.array(behavioralClaimSchema).min(1, 'expected at least one behavioral-change item'),
  })
  .strict()

/** Parsed, schema-valid Pass B output. */
export type BehaviorAnalysisOutput = z.infer<typeof behaviorAnalysisSchema>

/** A single schema-valid behavioral claim (pre-citation-validation). */
export type BehavioralClaimOutput = z.infer<typeof behavioralClaimSchema>
