import { describe, expect, it } from 'vitest'
import { validateCitations } from '~/server/utils/analysis/citation-validator'
import type { EvidenceLookup } from '~/server/utils/analysis/citation-validator'
import type { BehavioralClaimOutput } from '~/server/utils/ai/schemas'

const ANALYZED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const OTHER_SHA = 'ffffffffffffffffffffffffffffffffffffffff'

/**
 * A lightweight registry fake: E-00001/E-00002 belong to the analyzed SHA,
 * E-00099 exists but is bound to a DIFFERENT SHA (to exercise rule 2).
 */
function fakeRegistry(): EvidenceLookup {
  const map = new Map<string, { commitSha: string }>([
    ['E-00001', { commitSha: ANALYZED_SHA }],
    ['E-00002', { commitSha: ANALYZED_SHA }],
    ['E-00099', { commitSha: OTHER_SHA }],
  ])
  return {
    has: (k) => map.has(k),
    lookup: (k) => map.get(k) ?? null,
  }
}

function claim(overrides: Partial<BehavioralClaimOutput> = {}): BehavioralClaimOutput {
  return {
    behaviorStatement: 'Adds retry on transient network errors.',
    classification: 'observed',
    affectedComponent: 'server/utils/github/client.ts',
    userVisible: false,
    confidence: 0.8,
    evidenceIds: ['E-00001'],
    ...overrides,
  }
}

describe('validateCitations', () => {
  it('accepts an item whose cited id exists and matches the analyzed SHA', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: ['E-00001', 'E-00002'] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    expect(report.accepted).toHaveLength(1)
    expect(report.dropped).toHaveLength(0)
    const item = report.accepted[0]
    expect(item.validationStatus).toBe('valid')
    expect(item.classification).toBe('observed')
    expect(item.evidenceIds).toEqual(['E-00001', 'E-00002'])
  })

  it('rejects a citation to an unknown id and downgrades the item to unknown', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: ['E-77777'] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    // The unknown id is rejected; with no other valid evidence the item is
    // downgraded to unknown and NOT shown as an observed fact.
    expect(report.accepted).toHaveLength(1)
    expect(report.accepted[0].classification).toBe('unknown')
    expect(report.accepted[0].validationStatus).toBe('downgraded')
    expect(report.accepted[0].evidenceIds).toEqual([])
    const checks = report.perItem[0].citations
    expect(checks[0]).toMatchObject({ evidenceKey: 'E-77777', valid: false, reason: 'unknown_id' })
  })

  it('rejects evidence bound to a different SHA (provenance rule)', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: ['E-00099'] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    expect(report.accepted[0].classification).toBe('unknown')
    expect(report.accepted[0].validationStatus).toBe('downgraded')
    const checks = report.perItem[0].citations
    expect(checks[0]).toMatchObject({ evidenceKey: 'E-00099', valid: false, reason: 'sha_mismatch' })
  })

  it('keeps only the valid ids when a claim mixes valid and invalid citations', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: ['E-00001', 'E-00099', 'E-77777'] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    // One valid id remains -> the item is accepted as a fact with only E-00001.
    expect(report.accepted[0].validationStatus).toBe('valid')
    expect(report.accepted[0].evidenceIds).toEqual(['E-00001'])
  })

  it('downgrades an observed item that cites zero evidence (never a fact)', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: [] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    expect(report.accepted[0].classification).toBe('unknown')
    expect(report.accepted[0].validationStatus).toBe('downgraded')
    expect(report.accepted[0].downgradeReason).toBe('no_evidence_cited')
  })

  it('drops unsupported items entirely when downgradeUnsupported is false', () => {
    const report = validateCitations({
      claims: [claim({ evidenceIds: ['E-77777'] })],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
      downgradeUnsupported: false,
    })
    expect(report.accepted).toHaveLength(0)
    expect(report.dropped).toHaveLength(1)
    expect(report.dropped[0].reason).toBe('no_valid_evidence')
  })

  it('never emits an observed/inferred item without at least one valid evidence id', () => {
    const report = validateCitations({
      claims: [
        claim({ classification: 'observed', evidenceIds: ['E-00001'] }),
        claim({ classification: 'inferred', evidenceIds: ['E-77777'] }),
        claim({ classification: 'observed', evidenceIds: [] }),
      ],
      registry: fakeRegistry(),
      analyzedSha: ANALYZED_SHA,
    })
    for (const item of report.accepted) {
      const isFact = item.classification === 'observed' || item.classification === 'inferred'
      if (isFact) {
        expect(item.evidenceIds.length).toBeGreaterThan(0)
        expect(item.validationStatus).toBe('valid')
      }
    }
  })
})
