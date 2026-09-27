import { describe, expect, it } from 'vitest'
import { parsePatch } from '~/server/utils/patches/parse-patch'

// A realistic multi-hunk unified diff. Two hunks, add/del/context lines.
const MULTI_HUNK = [
  '@@ -1,4 +1,5 @@',
  ' import { a } from "a"',
  '-const x = 1',
  '+const x = 2',
  '+const y = 3',
  ' export { x }',
  ' // tail',
  '@@ -20,3 +21,4 @@ function foo() {',
  ' const p = 1',
  '+const q = 2',
  ' return p',
].join('\n')

// A patch whose head file has no trailing newline.
const NO_NEWLINE = [
  '@@ -1,2 +1,2 @@',
  ' first line',
  '-second line',
  '+second line changed',
  '\\ No newline at end of file',
].join('\n')

// A single-line hunk header form (no count).
const SINGLE_LINE_HEADER = [
  '@@ -1 +1,2 @@',
  '-only',
  '+only edited',
  '+added',
].join('\n')

describe('parsePatch multi-hunk', () => {
  const parsed = parsePatch(MULTI_HUNK)

  it('produces two hunks', () => {
    expect(parsed.hunks).toHaveLength(2)
  })

  it('reads hunk header line numbers', () => {
    expect(parsed.hunks[0].baseStart).toBe(1)
    expect(parsed.hunks[0].baseLines).toBe(4)
    expect(parsed.hunks[0].headStart).toBe(1)
    expect(parsed.hunks[0].headLines).toBe(5)
    expect(parsed.hunks[1].baseStart).toBe(20)
    expect(parsed.hunks[1].headStart).toBe(21)
  })

  it('captures the section heading after @@', () => {
    expect(parsed.hunks[1].section).toBe('function foo() {')
  })

  it('assigns correct head/base line numbers per line', () => {
    const first = parsed.hunks[0]
    // ' import { a }' context -> base 1, head 1
    expect(first.lines[0]).toMatchObject({ kind: 'context', baseLine: 1, headLine: 1 })
    // '-const x = 1' removed -> base 2, head null
    expect(first.lines[1]).toMatchObject({ kind: 'removed', baseLine: 2, headLine: null })
    // '+const x = 2' added -> base null, head 2
    expect(first.lines[2]).toMatchObject({ kind: 'added', baseLine: null, headLine: 2 })
    // '+const y = 3' added -> head 3
    expect(first.lines[3]).toMatchObject({ kind: 'added', baseLine: null, headLine: 3 })
    // ' export { x }' context -> base 3, head 4
    expect(first.lines[4]).toMatchObject({ kind: 'context', baseLine: 3, headLine: 4 })
  })

  it('continues numbering into the second hunk', () => {
    const second = parsed.hunks[1]
    expect(second.lines[0]).toMatchObject({ kind: 'context', baseLine: 20, headLine: 21 })
    expect(second.lines[1]).toMatchObject({ kind: 'added', headLine: 22 })
    expect(second.lines[2]).toMatchObject({ kind: 'context', baseLine: 21, headLine: 23 })
  })
})

describe('parsePatch no-newline-at-EOF', () => {
  const parsed = parsePatch(NO_NEWLINE)

  it('flags the missing trailing newline', () => {
    expect(parsed.hadNoNewlineAtEof).toBe(true)
  })

  it('does not consume a line number for the marker', () => {
    const lines = parsed.hunks[0].lines
    // Only 3 real lines: context, removed, added.
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatchObject({ kind: 'added', content: 'second line changed', headLine: 2 })
  })
})

describe('parsePatch single-line header', () => {
  const parsed = parsePatch(SINGLE_LINE_HEADER)

  it('defaults counts to 1 when absent', () => {
    expect(parsed.hunks[0].baseStart).toBe(1)
    expect(parsed.hunks[0].baseLines).toBe(1)
    expect(parsed.hunks[0].headStart).toBe(1)
    expect(parsed.hunks[0].headLines).toBe(2)
  })
})

describe('parsePatch empty/binary', () => {
  it('returns no hunks for null/empty', () => {
    expect(parsePatch(null).hunks).toHaveLength(0)
    expect(parsePatch('').hunks).toHaveLength(0)
  })
})
