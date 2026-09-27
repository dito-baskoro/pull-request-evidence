import { describe, expect, it } from 'vitest'
import { parsePatch } from '~/server/utils/patches/parse-patch'
import { addedHeadRuns, findByBaseLine, findByHeadLine, headRangeOfHunk } from '~/server/utils/patches/map-lines'

const PATCH = [
  '@@ -1,4 +1,6 @@',
  ' context one',
  '-old two',
  '+new two',
  '+new three',
  ' context four',
  '@@ -10,2 +12,3 @@',
  ' context ten',
  '+new eleven',
  ' context twelve',
].join('\n')

const parsed = parsePatch(PATCH)

describe('findByHeadLine', () => {
  it('resolves an added head line to the head side', () => {
    const pos = findByHeadLine(parsed, 2)
    expect(pos).toMatchObject({ side: 'head', kind: 'added', headLine: 2, content: 'new two' })
  })

  it('resolves a context head line to the head side with both numbers', () => {
    const pos = findByHeadLine(parsed, 1)
    expect(pos).toMatchObject({ side: 'head', kind: 'context', baseLine: 1, headLine: 1 })
  })

  it('returns null for a head line not present', () => {
    expect(findByHeadLine(parsed, 999)).toBeNull()
  })
})

describe('findByBaseLine', () => {
  it('resolves a removed base line to the base side', () => {
    const pos = findByBaseLine(parsed, 2)
    expect(pos).toMatchObject({ side: 'base', kind: 'removed', baseLine: 2, headLine: null })
  })
})

describe('headRangeOfHunk', () => {
  it('computes the head-line range of the first hunk', () => {
    const range = headRangeOfHunk(parsed.hunks[0])
    expect(range).toEqual({ start: 1, end: 4 })
  })
})

describe('addedHeadRuns', () => {
  it('groups contiguous added lines into runs with correct line numbers', () => {
    const runs = addedHeadRuns(parsed)
    // First hunk: head lines 2,3 are a contiguous added run.
    // Second hunk: head line 13 is a single added run.
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ startLine: 2, endLine: 3 })
    expect(runs[0].lines.map((l) => l.content)).toEqual(['new two', 'new three'])
    expect(runs[1]).toMatchObject({ startLine: 13, endLine: 13 })
    expect(runs[1].lines.map((l) => l.content)).toEqual(['new eleven'])
  })
})
