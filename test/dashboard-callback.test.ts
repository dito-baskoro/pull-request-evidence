import { describe, expect, it, vi } from 'vitest'
import { normalizeQueryValue, runInstallCallback } from '~/pages/dashboard-callback'

// These tests exercise the extracted dashboard callback logic directly, in the
// hand-rolled-fake style of test/installations-post.test.ts. The .vue component
// is not testable under the repo's vitest setup (no @vue/test-utils / happy-dom),
// so the normalization + POST + success/failure branching is unit-tested here.

describe('normalizeQueryValue', () => {
  it('returns a plain string unchanged', () => {
    expect(normalizeQueryValue('123')).toBe('123')
  })

  it('takes the first element of an array', () => {
    expect(normalizeQueryValue(['123', '456'])).toBe('123')
  })

  it('collapses empty, undefined, and null to undefined', () => {
    expect(normalizeQueryValue('')).toBeUndefined()
    expect(normalizeQueryValue(undefined)).toBeUndefined()
    expect(normalizeQueryValue(null)).toBeUndefined()
    expect(normalizeQueryValue([])).toBeUndefined()
  })
})

describe('runInstallCallback', () => {
  it('no installation_id: does not POST, does not strip, stays idle', async () => {
    const post = vi.fn(async () => ({}))
    const refresh = vi.fn(async () => ({}))
    const stripQuery = vi.fn(async () => ({}))

    const result = await runInstallCallback({
      installationId: undefined,
      setupAction: undefined,
      state: undefined,
      post,
      refresh,
      stripQuery,
    })

    expect(post).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(stripQuery).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'idle', message: '', posted: false, stripped: false })
  })

  it('success: POSTs normalized params, refreshes, reports success, strips query', async () => {
    const post = vi.fn(async () => ({}))
    const refresh = vi.fn(async () => ({}))
    const stripQuery = vi.fn(async () => ({}))

    const result = await runInstallCallback({
      installationId: '555',
      setupAction: 'install',
      state: 'signed-state-token',
      post,
      refresh,
      stripQuery,
    })

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({
      installation_id: '555',
      setup_action: 'install',
      state: 'signed-state-token',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(stripQuery).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      status: 'success',
      message: 'GitHub App connected.',
      posted: true,
      stripped: true,
    })
  })

  it('failure: reports error from the fallback chain and does NOT strip the query', async () => {
    const err = { data: { statusMessage: 'This GitHub connection link is invalid or has expired.' } }
    const post = vi.fn(async () => {
      throw err
    })
    const refresh = vi.fn(async () => ({}))
    const stripQuery = vi.fn(async () => ({}))

    const result = await runInstallCallback({
      installationId: '555',
      setupAction: 'install',
      state: 'stale',
      post,
      refresh,
      stripQuery,
    })

    expect(post).toHaveBeenCalledTimes(1)
    // Query preserved so a reload re-attempts the connect.
    expect(stripQuery).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(result.status).toBe('error')
    expect(result.stripped).toBe(false)
    expect(result.posted).toBe(true)
    expect(result.message).toBe('This GitHub connection link is invalid or has expired.')
  })

  it('failure: falls through data.statusMessage -> statusMessage -> message -> default', async () => {
    const stripQuery = vi.fn(async () => ({}))

    const fromStatusMessage = await runInstallCallback({
      installationId: '1',
      setupAction: undefined,
      state: undefined,
      post: vi.fn(async () => {
        throw { statusMessage: 'top-level status' }
      }),
      refresh: vi.fn(),
      stripQuery,
    })
    expect(fromStatusMessage.message).toBe('top-level status')

    const fromMessage = await runInstallCallback({
      installationId: '1',
      setupAction: undefined,
      state: undefined,
      post: vi.fn(async () => {
        throw new Error('plain error message')
      }),
      refresh: vi.fn(),
      stripQuery,
    })
    expect(fromMessage.message).toBe('plain error message')

    const fromDefault = await runInstallCallback({
      installationId: '1',
      setupAction: undefined,
      state: undefined,
      post: vi.fn(async () => {
        throw {}
      }),
      refresh: vi.fn(),
      stripQuery,
    })
    expect(fromDefault.message).toBe('Could not connect the GitHub App. Please try again.')

    // No success path ran, so the query is never stripped.
    expect(stripQuery).not.toHaveBeenCalled()
  })

  it('normalization: array-valued installation_id/setup_action/state take the first element', async () => {
    const post = vi.fn(async () => ({}))
    const refresh = vi.fn(async () => ({}))
    const stripQuery = vi.fn(async () => ({}))

    await runInstallCallback({
      installationId: ['777', '888'],
      setupAction: ['update', 'install'],
      state: ['tok-a', 'tok-b'],
      post,
      refresh,
      stripQuery,
    })

    expect(post).toHaveBeenCalledWith({
      installation_id: '777',
      setup_action: 'update',
      state: 'tok-a',
    })
  })
})
