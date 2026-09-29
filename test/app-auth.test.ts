import { describe, expect, it } from 'vitest'
import { normalizePrivateKey } from '~/server/utils/github/private-key'

// normalizePrivateKey is pure and does not touch Nitro auto-imports, so it can
// be unit-tested directly. It must recover keys mangled by an environment or
// secret store without altering an already-valid multiline PEM.

const VALID_PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOwIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q',
  'uKUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQ==',
  '-----END RSA PRIVATE KEY-----',
].join('\n')

describe('normalizePrivateKey', () => {
  it('passes a well-formed multiline PEM through unchanged (aside from trim)', () => {
    expect(normalizePrivateKey(VALID_PEM)).toBe(VALID_PEM)
    expect(normalizePrivateKey(`\n${VALID_PEM}\n`)).toBe(VALID_PEM)
  })

  it('converts literal escaped \\n sequences into real newlines', () => {
    const singleLine = VALID_PEM.replace(/\n/g, '\\n')
    expect(normalizePrivateKey(singleLine)).toBe(VALID_PEM)
  })

  it('strips a single pair of surrounding double quotes', () => {
    expect(normalizePrivateKey(`"${VALID_PEM}"`)).toBe(VALID_PEM)
  })

  it('strips a single pair of surrounding single quotes', () => {
    expect(normalizePrivateKey(`'${VALID_PEM}'`)).toBe(VALID_PEM)
  })

  it('normalizes CRLF line endings to LF', () => {
    const crlf = VALID_PEM.replace(/\n/g, '\r\n')
    expect(normalizePrivateKey(crlf)).toBe(VALID_PEM)
  })

  it('handles a quoted single-line key with escaped CRLF', () => {
    const mangled = `"${VALID_PEM.replace(/\n/g, '\\r\\n')}"`
    expect(normalizePrivateKey(mangled)).toBe(VALID_PEM)
  })
})
