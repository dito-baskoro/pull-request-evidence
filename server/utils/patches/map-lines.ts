// Line mapping helpers over parsed patch hunks (plan section 8; Milestone 3).
//
// Given the hunks produced by parsePatch, these helpers resolve a head line
// number to its base counterpart (and vice versa) and expose enough structure
// to build accurate evidence spans with the correct `side` (base | head).
//
// Pure functions, no I/O; independent of AI and persistence.

import type { EvidenceSide } from '~/types/analysis'
import type { PatchHunk, PatchLine } from '~/types/github'
import type { ParsedPatch } from './parse-patch'

/** A single resolved position inside a patch. */
export interface LinePosition {
  side: EvidenceSide
  baseLine: number | null
  headLine: number | null
  kind: PatchLine['kind']
  content: string
}

/** Iterate every parsed line across all hunks in file order. */
export function allLines(patch: ParsedPatch): PatchLine[] {
  const out: PatchLine[] = []
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) out.push(line)
  }
  return out
}

/**
 * Resolve a head-file line number to its position, if it appears in the patch.
 * Added and context lines have a head line number; removed lines do not.
 */
export function findByHeadLine(patch: ParsedPatch, headLine: number): LinePosition | null {
  for (const line of allLines(patch)) {
    if (line.headLine === headLine) {
      return toPosition(line)
    }
  }
  return null
}

/**
 * Resolve a base-file line number to its position, if it appears in the patch.
 * Removed and context lines have a base line number; added lines do not.
 */
export function findByBaseLine(patch: ParsedPatch, baseLine: number): LinePosition | null {
  for (const line of allLines(patch)) {
    if (line.baseLine === baseLine) {
      return toPosition(line)
    }
  }
  return null
}

/**
 * Compute the inclusive head-line range touched by additions/context in a
 * hunk. Returns null when the hunk only removes lines (no head presence).
 */
export function headRangeOfHunk(hunk: PatchHunk): { start: number; end: number } | null {
  let start: number | null = null
  let end: number | null = null
  for (const line of hunk.lines) {
    if (line.headLine != null) {
      if (start == null || line.headLine < start) start = line.headLine
      if (end == null || line.headLine > end) end = line.headLine
    }
  }
  if (start == null || end == null) return null
  return { start, end }
}

/**
 * Return the contiguous runs of ADDED head lines within a patch. Each run is a
 * candidate evidence span on the head side: it is exactly the new code a PR
 * introduced, with accurate line numbers for a permalink.
 */
export function addedHeadRuns(
  patch: ParsedPatch,
): Array<{ startLine: number; endLine: number; lines: PatchLine[] }> {
  const runs: Array<{ startLine: number; endLine: number; lines: PatchLine[] }> = []
  let run: PatchLine[] = []

  const flush = () => {
    if (run.length === 0) return
    const first = run[0].headLine as number
    const last = run[run.length - 1].headLine as number
    runs.push({ startLine: first, endLine: last, lines: run })
    run = []
  }

  for (const line of allLines(patch)) {
    if (line.kind === 'added' && line.headLine != null) {
      if (run.length > 0) {
        const prev = run[run.length - 1].headLine as number
        if (line.headLine !== prev + 1) flush()
      }
      run.push(line)
    }
    else {
      flush()
    }
  }
  flush()
  return runs
}

function toPosition(line: PatchLine): LinePosition {
  const side: EvidenceSide = line.kind === 'removed' ? 'base' : 'head'
  return {
    side,
    baseLine: line.baseLine,
    headLine: line.headLine,
    kind: line.kind,
    content: line.content,
  }
}
