import { describe, expect, it } from 'vitest'
import { buildLineFragment, buildPermalink } from '~/server/utils/github/permalink'

const OWNER = 'octo'
const REPO = 'demo'
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

describe('buildPermalink', () => {
  it('builds a commit-SHA blob URL with a line range', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'src/foo.ts', 10, 20)
    expect(url).toBe(`https://github.com/${OWNER}/${REPO}/blob/${SHA}/src/foo.ts#L10-L20`)
  })

  it('uses the commit SHA in the path, never a branch', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'src/foo.ts', 1, 2)
    expect(url).toContain(`/blob/${SHA}/`)
    expect(url).not.toContain('/blob/main/')
  })

  it('collapses to a single-line fragment when start === end', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'a.ts', 7, 7)
    expect(url.endsWith('#L7')).toBe(true)
  })

  it('collapses to a single-line fragment when only startLine is given', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'a.ts', 42)
    expect(url.endsWith('#L42')).toBe(true)
  })

  it('omits the fragment when no lines are provided', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'a.ts')
    expect(url).toBe(`https://github.com/${OWNER}/${REPO}/blob/${SHA}/a.ts`)
  })

  it('url-encodes path segments but preserves slashes', () => {
    const url = buildPermalink(OWNER, REPO, SHA, 'src/my folder/foo bar.ts', 1)
    expect(url).toContain('/src/my%20folder/foo%20bar.ts#L1')
  })

  it('accepts a short (abbreviated) commit SHA', () => {
    const short = 'a1b2c3d'
    const url = buildPermalink(OWNER, REPO, short, 'a.ts', 1)
    expect(url).toContain(`/blob/${short}/`)
  })

  it('rejects a branch name masquerading as a SHA', () => {
    expect(() => buildPermalink(OWNER, REPO, 'main', 'a.ts', 1)).toThrow()
  })

  it('rejects missing owner/repo/sha', () => {
    expect(() => buildPermalink('', REPO, SHA, 'a.ts')).toThrow()
    expect(() => buildPermalink(OWNER, '', SHA, 'a.ts')).toThrow()
    expect(() => buildPermalink(OWNER, REPO, '', 'a.ts')).toThrow()
  })
})

describe('buildLineFragment', () => {
  it('handles null start', () => {
    expect(buildLineFragment(null, null)).toBe('')
  })
  it('handles start only', () => {
    expect(buildLineFragment(5)).toBe('L5')
  })
  it('handles start and larger end', () => {
    expect(buildLineFragment(5, 9)).toBe('L5-L9')
  })
  it('collapses when end <= start', () => {
    expect(buildLineFragment(5, 5)).toBe('L5')
    expect(buildLineFragment(5, 3)).toBe('L5')
  })
})
