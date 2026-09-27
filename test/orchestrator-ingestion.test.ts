import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the read-only GitHub fetch seams so runAnalysis needs no network.
vi.mock('~/server/utils/github/fetch-pr', () => ({
  fetchPullRequest: vi.fn(async () => ({
    metadata: {
      githubNumber: 7,
      title: 'Add retry',
      body: 'body',
      authorLogin: 'octo',
      baseSha: 'b'.repeat(40),
      headSha: 'a'.repeat(40),
      state: 'open',
      sourceUpdatedAt: null,
    },
    files: [],
    commits: [],
  })),
}))

vi.mock('~/server/utils/github/fetch-checks', () => ({
  fetchChecksForSha: vi.fn(async () => [
    {
      githubCheckRunId: 123,
      name: 'ci',
      status: 'completed',
      conclusion: 'success',
      detailsUrl: 'https://example.test/ci',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:01:00Z',
    },
  ]),
}))

import { runAnalysis } from '~/server/utils/analysis/orchestrator'

interface Op {
  table: string
  action: 'insert' | 'delete' | 'update' | 'select'
  rows?: unknown
}

/**
 * A fake Supabase admin recording the ORDER of operations per table so we can
 * assert that a re-run clears run-scoped rows before inserting new ones and
 * that check_results is populated.
 *
 * The query builder is a single thenable object supporting the chained methods
 * the orchestrator uses (select/eq/maybeSingle/single/insert/delete/update).
 * The resolved value depends on the table so ownership and lookup queries
 * return sensible shapes.
 */
function fakeAdmin(ops: Op[]): any {
  return {
    from(table: string) {
      const result = () => {
        // github_installations: ownership check expects a single matching row.
        if (table === 'github_installations') return { data: { id: 'inst-1' }, error: null }
        // artifacts select: patch-artifact lookup expects an array.
        return { data: [], error: null }
      }
      const builder: any = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        maybeSingle() {
          return Promise.resolve(result())
        },
        single() {
          return Promise.resolve(result())
        },
        insert(rows: unknown) {
          ops.push({ table, action: 'insert', rows })
          return Promise.resolve({ error: null })
        },
        delete() {
          return {
            eq: () => {
              ops.push({ table, action: 'delete' })
              return Promise.resolve({ error: null })
            },
          }
        },
        update() {
          return { eq: async () => ({ error: null }) }
        },
        // Awaiting the builder directly (e.g. .select().eq().eq()) resolves the
        // table-appropriate result.
        then(resolve: (v: unknown) => void) {
          resolve(result())
        },
      }
      return builder
    },
  }
}

const octokit = {} as any

const input = {
  analysisRunId: 'run-1',
  userId: 'user-1',
  installationId: 'inst-1',
  owner: 'octo',
  repo: 'demo',
  pullNumber: 7,
}

describe('runAnalysis ingestion idempotency and check_results', () => {
  let ops: Op[]
  beforeEach(() => {
    ops = []
  })

  it('clears run-scoped rows before persisting on (re-)ingestion', async () => {
    await runAnalysis({ admin: fakeAdmin(ops), octokit }, input)

    const deletes = ops.filter((o) => o.action === 'delete').map((o) => o.table)
    // artifacts, report_items, check_results are all cleared first.
    expect(deletes).toEqual(expect.arrayContaining(['artifacts', 'report_items', 'check_results']))

    // Every delete happens before the first artifacts insert (idempotent re-run).
    const firstArtifactInsert = ops.findIndex((o) => o.table === 'artifacts' && o.action === 'insert')
    const lastDelete = ops.map((o) => o.action).lastIndexOf('delete')
    expect(lastDelete).toBeLessThan(firstArtifactInsert)
  })

  it('persists normalized checks into the check_results table', async () => {
    await runAnalysis({ admin: fakeAdmin(ops), octokit }, input)

    const checkInsert = ops.find((o) => o.table === 'check_results' && o.action === 'insert')
    expect(checkInsert).toBeTruthy()
    const rows = checkInsert!.rows as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      analysis_run_id: 'run-1',
      github_check_run_id: 123,
      name: 'ci',
      status: 'completed',
      conclusion: 'success',
    })
  })
})
