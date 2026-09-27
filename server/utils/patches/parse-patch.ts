// Unified-diff patch parser (plan sections 8 and 9; Milestone 3).
//
// Parses a single file's unified-diff `patch` string (as returned by the GitHub
// PR files API) into hunks with resolved base/head line numbers per line. This
// is a pure function so it can be unit-tested without any runtime and stays
// completely independent of AI and persistence.
//
// It handles:
//   - multiple hunks in one patch
//   - added / removed / context lines
//   - the "\ No newline at end of file" marker (which does not consume a line
//     number on either side)
//   - hunk headers with an optional single-line count (e.g. `@@ -1 +1,2 @@`)
//   - trailing section text after the closing `@@`

import type { PatchHunk, PatchLine } from '~/types/github'

/** Result of parsing a whole file patch. */
export interface ParsedPatch {
  hunks: PatchHunk[]
  /** True if the patch contained a "no newline at end of file" marker. */
  hadNoNewlineAtEof: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/

/**
 * Parse a unified-diff patch into hunks. Returns empty hunks for an empty or
 * null patch (for example a binary file, which has no textual patch).
 */
export function parsePatch(patch: string | null | undefined): ParsedPatch {
  const hunks: PatchHunk[] = []
  let hadNoNewlineAtEof = false

  if (!patch) {
    return { hunks, hadNoNewlineAtEof }
  }

  // Split on \n and tolerate CRLF by trimming a trailing \r per line.
  const rawLines = patch.split('\n')

  let current: PatchHunk | null = null
  let baseCursor = 0
  let headCursor = 0

  for (const raw of rawLines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    const header = HUNK_HEADER.exec(line)
    if (header) {
      const baseStart = Number(header[1])
      const baseLines = header[2] === undefined ? 1 : Number(header[2])
      const headStart = Number(header[3])
      const headLines = header[4] === undefined ? 1 : Number(header[4])
      const section = header[5] !== undefined && header[5] !== '' ? header[5] : null

      current = {
        baseStart,
        baseLines,
        headStart,
        headLines,
        section,
        lines: [],
      }
      hunks.push(current)
      baseCursor = baseStart
      headCursor = headStart
      continue
    }

    // Lines that appear before the first hunk header (diff/index/--- /+++ )
    // are file-level metadata and are ignored here.
    if (!current) continue

    // "\ No newline at end of file" applies to the previous content line and
    // does not consume a line number.
    if (line.startsWith('\\')) {
      hadNoNewlineAtEof = true
      continue
    }

    const marker = line.charAt(0)
    const content = line.slice(1)

    if (marker === '+') {
      const entry: PatchLine = {
        kind: 'added',
        content,
        baseLine: null,
        headLine: headCursor,
      }
      current.lines.push(entry)
      headCursor += 1
    }
    else if (marker === '-') {
      const entry: PatchLine = {
        kind: 'removed',
        content,
        baseLine: baseCursor,
        headLine: null,
      }
      current.lines.push(entry)
      baseCursor += 1
    }
    else if (marker === ' ' || line === '') {
      // A context line. An empty string (a blank context line whose single
      // leading space was stripped by a tool) is treated as blank context.
      const entry: PatchLine = {
        kind: 'context',
        content,
        baseLine: baseCursor,
        headLine: headCursor,
      }
      current.lines.push(entry)
      baseCursor += 1
      headCursor += 1
    }
    // Any other leading character (should not occur in a well-formed patch) is
    // ignored so parsing stays robust.
  }

  return { hunks, hadNoNewlineAtEof }
}
