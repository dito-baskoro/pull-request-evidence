import { describe, expect, it } from 'vitest'
import {
  ConnectStateError,
  signConnectState,
  verifyConnectState,
} from '~/server/utils/github/connect-state'

// Unit tests for the pure connect-state signing/verification helpers. The
// secret is passed in (readConnectStateSecret, the only Nitro-coupled export,
// is not exercised here). No network, in the hand-rolled style of the other
// tests.

const SECRET = 'test-connect-state-secret-0123456789'

describe('signConnectState / verifyConnectState', () => {
  it('a freshly signed token verifies for the same user', () => {
    const token = signConnectState({ userId: 'user-1', secret: SECRET })
    expect(() => verifyConnectState({ token, userId: 'user-1', secret: SECRET })).not.toThrow()
  })

  it('produces the compact <payload>.<sig> shape', () => {
    const token = signConnectState({ userId: 'user-1', secret: SECRET })
    const parts = token.split('.')
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBeGreaterThan(0)
    expect(parts[1].length).toBeGreaterThan(0)
    // base64url: no '+', '/', or '=' padding.
    expect(token).not.toMatch(/[+/=]/)
  })

  it('rejects a missing token with 400', () => {
    expect(() => verifyConnectState({ token: undefined, userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
    try {
      verifyConnectState({ token: undefined, userId: 'user-1', secret: SECRET })
    }
    catch (err: any) {
      expect(err.statusCode).toBe(400)
    }
  })

  it('rejects a malformed token (no dot / empty segments) with 400', () => {
    expect(() => verifyConnectState({ token: 'not-a-token', userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
    expect(() => verifyConnectState({ token: 'abc.', userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
    expect(() => verifyConnectState({ token: '.abc', userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
  })

  it('rejects a tampered signature with 400', () => {
    const token = signConnectState({ userId: 'user-1', secret: SECRET })
    const [payload] = token.split('.')
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
    expect(() => verifyConnectState({ token: tampered, userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
  })

  it('rejects a token signed with a different secret', () => {
    const token = signConnectState({ userId: 'user-1', secret: 'other-secret' })
    expect(() => verifyConnectState({ token, userId: 'user-1', secret: SECRET }))
      .toThrow(ConnectStateError)
  })

  it('rejects a token bound to a different user (uid mismatch)', () => {
    const token = signConnectState({ userId: 'victim', secret: SECRET })
    expect(() => verifyConnectState({ token, userId: 'attacker', secret: SECRET }))
      .toThrow(ConnectStateError)
  })

  it('rejects an expired token', () => {
    const now = 1_000_000
    const token = signConnectState({ userId: 'user-1', secret: SECRET, nowMs: now, ttlMs: 1000 })
    // Verify at a time past expiry.
    expect(() =>
      verifyConnectState({ token, userId: 'user-1', secret: SECRET, nowMs: now + 2000 }),
    ).toThrow(ConnectStateError)
  })

  it('accepts a token within its TTL window', () => {
    const now = 1_000_000
    const token = signConnectState({ userId: 'user-1', secret: SECRET, nowMs: now, ttlMs: 60_000 })
    expect(() =>
      verifyConnectState({ token, userId: 'user-1', secret: SECRET, nowMs: now + 30_000 }),
    ).not.toThrow()
  })

  it('exposes a clear user-facing message and a 400 status', () => {
    try {
      verifyConnectState({ token: 'bad', userId: 'user-1', secret: SECRET })
      throw new Error('expected verifyConnectState to throw')
    }
    catch (err: any) {
      expect(err).toBeInstanceOf(ConnectStateError)
      expect(err.statusCode).toBe(400)
      expect(err.message).toMatch(/invalid or has expired/i)
    }
  })
})
