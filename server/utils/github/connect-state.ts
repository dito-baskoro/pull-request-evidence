// Per-user connect-state signing/verification (Milestone 2 security hardening).
//
// WHY THIS EXISTS
// ---------------
// The post-install connect route persists a client-supplied installation_id
// after verifying it with the GitHub App JWT. That JWT can read metadata for
// EVERY installation of the app, so apps.getInstallation succeeds for any
// tenant's installation_id. Without an additional binding, a signed-in
// attacker could POST a victim's installation_id, pass verification, and claim
// ownership of a github_installations row under their own user_id (RLS passes
// because the row is well-formed for its owner), then list the victim's
// repositories via repositories.get.ts.
//
// TRUST MODEL
// -----------
// This module issues a short-lived, unguessable, per-user state token that the
// dashboard hands to GitHub on the "install" link. GitHub echoes the token back
// on the setup redirect, and the connect route verifies it BEFORE any GitHub
// lookup or database write. The property enforced: possession of a valid
// installation_id alone is NOT sufficient; the caller must also present a state
// token that THIS server issued for THIS signed-in user and that has not
// expired.
//
// RESIDUAL ASSUMPTION
// -------------------
// This binds the connect to the user who initiated the install from our app
// (server-issued per-user state echoed by GitHub), preventing a bare, guessed,
// or replayed installation_id from being claimed by another account. It does
// NOT cryptographically prove GitHub account ownership; that would require
// GitHub user-to-server OAuth, which is deliberately out of scope for this
// read-only slice (auth here is Supabase magic-link, not GitHub OAuth).
//
// The pure functions below take the signing secret as an argument so they are
// unit-testable without Nitro auto-imports. readConnectStateSecret() is the
// only Nitro-coupled export; it reads the server-only runtime config and fails
// closed when the secret is unset so verification can never be skipped.

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Default lifetime of a connect-state token: about 15 minutes. */
const DEFAULT_TTL_MS = 15 * 60 * 1000

/** User-facing message for any malformed/mismatched/expired state token. */
const INVALID_STATE_MESSAGE
  = 'This GitHub connection link is invalid or has expired. Please start the connection again from the dashboard.'

/**
 * Error carrying an HTTP-style status so the connect route can map it onto
 * createError exactly like PersistInstallationError. A malformed, mismatched,
 * or expired state token is a 400 (client must restart the connect flow).
 */
export class ConnectStateError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ConnectStateError'
    this.statusCode = statusCode
  }
}

/** Payload embedded in the token: the bound user id and the expiry (ms epoch). */
interface ConnectStatePayload {
  uid: string
  exp: number
}

/** base64url-encode a Buffer or string (no padding). */
function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Compute the base64url HMAC-SHA256 of a message segment. */
function hmacSegment(secret: string, message: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(message).digest())
}

/**
 * Sign a compact connect-state token of the form
 * `<base64url(payloadJson)>.<base64url(hmacSha256)>`.
 *
 * The payload is { uid, exp } where exp = now + ttl. The HMAC is computed over
 * the base64url(payloadJson) segment. The secret is passed in so this function
 * stays pure and unit-testable.
 */
export function signConnectState(args: {
  userId: string
  secret: string
  nowMs?: number
  ttlMs?: number
}): string {
  const { userId, secret } = args
  const nowMs = args.nowMs ?? Date.now()
  const ttlMs = args.ttlMs ?? DEFAULT_TTL_MS
  const payload: ConnectStatePayload = { uid: userId, exp: nowMs + ttlMs }
  const payloadSegment = base64UrlEncode(JSON.stringify(payload))
  const signature = hmacSegment(secret, payloadSegment)
  return `${payloadSegment}.${signature}`
}

/** Constant-time equality that guards unequal lengths before timingSafeEqual. */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Verify a connect-state token. Throws ConnectStateError(400) when the token is
 * missing, malformed, has an invalid HMAC, is bound to a different user, or has
 * expired. Returns void on success. The secret is passed in so this function
 * stays pure and unit-testable.
 *
 * The HMAC is verified with a constant-time comparison; unequal lengths are
 * rejected before timingSafeEqual is called.
 */
export function verifyConnectState(args: {
  token: string | undefined
  userId: string
  secret: string
  nowMs?: number
}): void {
  const { token, userId, secret } = args
  const nowMs = args.nowMs ?? Date.now()

  if (!token || typeof token !== 'string') {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  const [payloadSegment, signature] = parts
  const expected = hmacSegment(secret, payloadSegment)
  if (!safeEqual(signature, expected)) {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  let payload: ConnectStatePayload
  try {
    const json = Buffer.from(payloadSegment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    payload = JSON.parse(json) as ConnectStatePayload
  }
  catch {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  if (payload.uid !== userId) {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }

  if (!Number.isFinite(payload.exp) || nowMs >= payload.exp) {
    throw new ConnectStateError(400, INVALID_STATE_MESSAGE)
  }
}

/**
 * Read the server-only signing secret from runtime config. This is the only
 * Nitro-coupled export (it calls the auto-imported useRuntimeConfig), so it is
 * kept out of the pure functions above. Fails closed: throws a clear server
 * error when the secret is unset so verification can never be silently skipped.
 */
export function readConnectStateSecret(): string {
  const config = useRuntimeConfig()
  const secret = config.githubConnectStateSecret
  if (!secret || typeof secret !== 'string') {
    throw new Error(
      'Missing NUXT_GITHUB_CONNECT_STATE_SECRET (server-only). See .env.example.',
    )
  }
  return secret
}
