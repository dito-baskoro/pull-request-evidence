import { describe, expect, it } from 'vitest'
import { createBehaviorAnalysisHook } from '~/server/utils/ai/behavior-hook'
import type { BehaviorAnalyzer, BehaviorAnalyzerInput, BehaviorAnalyzerResult } from '~/server/utils/ai/provider'
import { behaviorAnalysisSchema } from '~/server/utils/ai/schemas'
import type { DeterministicResult } from '~/server/utils/analysis/orchestrator'
import type { EvidenceManifestEntry } from '~/server/utils/analysis/evidence-registry'
import type { DeterministicChangeMap } from '~/server/utils/analysis/change-map'

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

/** Minimal deterministic result with a registry lookup the validator uses. */
function deterministicResult(): DeterministicResult {
  return {
    analysisRunId: 'run-1',
    owner: 'octo',
    repo: 'demo',
    headSha: ANALYZED_SHA,
    changeMap: CHANGE_MAP,
    // The validator only calls has()/lookup(); cast to the registry shape.
    registry: {
      has: (k: string) => k === 'E-00001',
      lookup: (k: string) => (k === 'E-00001' ? { commitSha: ANALYZED_SHA } : null),
    } as unknown as DeterministicResult['registry'],
    evidenceManifest: MANIFEST,
  }
}

function fakeAnalyzer(items: unknown[], modelId = 'fake-model'): BehaviorAnalyzer {
  return {
    async analyze(_input: BehaviorAnalyzerInput): Promise<BehaviorAnalyzerResult> {
      const parsed = behaviorAnalysisSchema.parse({ items })
      return { output: parsed, modelId }
    },
  }
}

/**
 * A fake Supabase admin client that records inserts/deletes/updates and lets a
 * test force a specific operation to fail. Supports only the query chains the
 * behavior hook uses.
 */
interface FakeState {
  reportItems: Array<Record<string, unknown>>
  reportItemEvidence: Array<Record<string, unknown>>
  updates: Array<{ table: string; patch: Record<string, unknown> }>
  deletes: Array<{ table: string }>
  failOn?: 'report_item_evidence_insert'
}

function fakeAdmin(state: FakeState): any {
  let nextId = 1
  return {
    from(table: string) {
      return {
        // update({...}).eq('id', id)
        update(patch: Record<string, unknown>) {
          state.updates.push({ table, patch })
          return { eq: async () => ({ error: null }) }
        },
        // insert(rows) or insert(rows).select('id')
        insert(rows: Array<Record<string, unknown>> | Record<string, unknown>) {
          const arr = Array.isArray(rows) ? rows : [rows]
          if (table === 'report_item_evidence') {
            if (state.failOn === 'report_item_evidence_insert') {
              return Promise.resolve({ error: { message: 'forced join failure' } })
            }
            state.reportItemEvidence.push(...arr)
            return Promise.resolve({ error: null })
          }
          if (table === 'report_items') {
            const withIds = arr.map((r) => ({ ...r, id: `item-${nextId++}` }))
            state.reportItems.push(...withIds)
            return {
              select: () => Promise.resolve({ data: withIds.map((r) => ({ id: r.id })), error: null }),
            }
          }
          return Promise.resolve({ error: null })
        },
        // delete().eq('analysis_run_id', id)
        delete() {
          return {
            eq: () => {
              state.deletes.push({ table })
              if (table === 'report_items') {
                state.reportItems = []
                state.reportItemEvidence = []
              }
              return Promise.resolve({ error: null })
            },
          }
        },
        // select('id, evidence_key, ...').eq('artifacts.analysis_run_id', id)
        select() {
          return {
            eq: async () => ({
              data: [{ id: 'span-1', evidence_key: 'E-00001' }],
              error: null,
            }),
          }
        },
      }
    },
  }
}

function claimItem(overrides: Record<string, unknown> = {}) {
  return {
    behaviorStatement: 'GitHub client now retries transient failures.',
    classification: 'observed',
    affectedComponent: 'server/utils/github/client.ts',
    userVisible: false,
    confidence: 0.9,
    evidenceIds: ['E-00001'],
    ...overrides,
  }
}

describe('createBehaviorAnalysisHook persistence', () => {
  it('records provenance and persists a validated item with its evidence join', async () => {
    const state: FakeState = { reportItems: [], reportItemEvidence: [], updates: [], deletes: [] }
    const hook = createBehaviorAnalysisHook({
      admin: fakeAdmin(state),
      analyzer: fakeAnalyzer([claimItem()]),
    })

    await hook.run(deterministicResult())

    // Provenance recorded (workflow_version + model_id).
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].table).toBe('analysis_runs')
    expect(state.updates[0].patch).toMatchObject({ model_id: 'fake-model' })

    // One report item + one citation join.
    expect(state.reportItems).toHaveLength(1)
    expect(state.reportItems[0]).toMatchObject({ classification: 'observed', validation_status: 'valid' })
    expect(state.reportItemEvidence).toHaveLength(1)
    expect(state.reportItemEvidence[0]).toMatchObject({ report_item_id: 'item-1', evidence_span_id: 'span-1' })
  })

  it('leaves no partial report items when the evidence-join insert fails', async () => {
    const state: FakeState = {
      reportItems: [],
      reportItemEvidence: [],
      updates: [],
      deletes: [],
      failOn: 'report_item_evidence_insert',
    }
    const hook = createBehaviorAnalysisHook({
      admin: fakeAdmin(state),
      analyzer: fakeAnalyzer([claimItem()]),
    })

    await expect(hook.run(deterministicResult())).rejects.toThrow(/report item evidence/)

    // The failed join triggers a rollback delete of report_items for the run,
    // so no partial item survives under the (soon to be) failed run.
    expect(state.deletes.some((d) => d.table === 'report_items')).toBe(true)
    expect(state.reportItems).toHaveLength(0)
  })
})
