import { describe, expect, it } from 'vitest'
import { analyzeBehavior } from '~/server/utils/ai/analyze-behavior'
import type { BehaviorAnalyzer, BehaviorAnalyzerInput, BehaviorAnalyzerResult } from '~/server/utils/ai/provider'
import { behaviorAnalysisSchema } from '~/server/utils/ai/schemas'
import { validateCitations } from '~/server/utils/analysis/citation-validator'
import type { EvidenceLookup } from '~/server/utils/analysis/citation-validator'
import type { DeterministicChangeMap } from '~/server/utils/analysis/change-map'
import type { EvidenceManifestEntry } from '~/server/utils/analysis/evidence-registry'

const ANALYZED_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const MANIFEST: EvidenceManifestEntry[] = [
  {
    evidenceKey: 'E-00001',
    filePath: 'server/utils/github/client.ts',
    side: 'head',
    startLine: 12,
    endLine: 18,
    excerpt: '+  return retry(fetchWithBackoff, { retries: 3 })',
  },
]

const CHANGE_MAP: DeterministicChangeMap = {
  entries: [],
  totalsByClass: {},
  excludedCount: 0,
  sourceFiles: ['server/utils/github/client.ts'],
  testFiles: [],
  candidateTestAssociations: [],
}

/** A FAKE analyzer: returns a fixed, schema-valid object. No network. */
function fakeAnalyzer(output: unknown, modelId = 'fake-model'): BehaviorAnalyzer {
  return {
    async analyze(_input: BehaviorAnalyzerInput): Promise<BehaviorAnalyzerResult> {
      // Parse through the real schema exactly like the provider would, so the
      // test exercises the same shape contract.
      const parsed = behaviorAnalysisSchema.parse(output)
      return { output: parsed, modelId }
    },
  }
}

function registry(): EvidenceLookup {
  const map = new Map<string, { commitSha: string }>([['E-00001', { commitSha: ANALYZED_SHA }]])
  return { has: (k) => map.has(k), lookup: (k) => map.get(k) ?? null }
}

describe('analyzeBehavior with a fake analyzer', () => {
  it('returns schema-valid claims and the model id without any network', async () => {
    const analyzer = fakeAnalyzer({
      items: [
        {
          behaviorStatement: 'GitHub client now retries transient failures up to three times.',
          classification: 'observed',
          affectedComponent: 'server/utils/github/client.ts',
          userVisible: false,
          confidence: 0.82,
          evidenceIds: ['E-00001'],
        },
      ],
    })

    const result = await analyzeBehavior(analyzer, { manifest: MANIFEST, changeMap: CHANGE_MAP })
    expect(result.modelId).toBe('fake-model')
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].classification).toBe('observed')
    expect(result.claims[0].evidenceIds).toEqual(['E-00001'])
  })

  it('feeds cleanly into citation validation for the happy path', async () => {
    const analyzer = fakeAnalyzer({
      items: [
        {
          behaviorStatement: 'GitHub client now retries transient failures.',
          classification: 'observed',
          affectedComponent: 'server/utils/github/client.ts',
          userVisible: false,
          confidence: 0.9,
          evidenceIds: ['E-00001'],
        },
      ],
    })
    const { claims } = await analyzeBehavior(analyzer, { manifest: MANIFEST, changeMap: CHANGE_MAP })
    const report = validateCitations({ claims, registry: registry(), analyzedSha: ANALYZED_SHA })
    expect(report.accepted).toHaveLength(1)
    expect(report.accepted[0].validationStatus).toBe('valid')
  })

  it('rejects malformed provider output via the strict schema', async () => {
    // Unknown field `madeUpField` must be rejected by .strict().
    const analyzer = fakeAnalyzer({
      items: [
        {
          behaviorStatement: 'x',
          classification: 'observed',
          affectedComponent: 'c',
          userVisible: true,
          confidence: 0.5,
          evidenceIds: ['E-00001'],
          madeUpField: 'hallucinated',
        },
      ],
    })
    await expect(analyzeBehavior(analyzer, { manifest: MANIFEST, changeMap: CHANGE_MAP })).rejects.toThrow()
  })

  it('rejects an out-of-range confidence via the schema', async () => {
    const analyzer = fakeAnalyzer({
      items: [
        {
          behaviorStatement: 'x',
          classification: 'inferred',
          affectedComponent: 'c',
          userVisible: false,
          confidence: 1.5,
          evidenceIds: ['E-00001'],
        },
      ],
    })
    await expect(analyzeBehavior(analyzer, { manifest: MANIFEST, changeMap: CHANGE_MAP })).rejects.toThrow()
  })

  it('rejects a classification outside observed|inferred', async () => {
    const analyzer = fakeAnalyzer({
      items: [
        {
          behaviorStatement: 'x',
          classification: 'potential_risk',
          affectedComponent: 'c',
          userVisible: false,
          confidence: 0.5,
          evidenceIds: ['E-00001'],
        },
      ],
    })
    await expect(analyzeBehavior(analyzer, { manifest: MANIFEST, changeMap: CHANGE_MAP })).rejects.toThrow()
  })
})
