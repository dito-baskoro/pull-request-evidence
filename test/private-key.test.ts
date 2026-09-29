import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  detectPrivateKeyFormat,
  pkcs1ToPkcs8,
  preparePrivateKey,
} from '~/server/utils/github/private-key'

// GitHub downloads App private keys as PKCS#1, but WebCrypto (used to sign the
// App JWT on Cloudflare Workers) only imports PKCS#8. These tests generate real
// RSA keys and prove the conversion is byte-identical to Node's own PKCS#8
// export and usable for RS256 signing, both via Node and via WebCrypto.

function makeKey(bits = 2048) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: bits })
  return {
    publicKey,
    pkcs1: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
  }
}

function pemToDer(pem: string): Uint8Array {
  return Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0))
}

describe('detectPrivateKeyFormat', () => {
  it('recognizes PKCS#1, PKCS#8, OpenSSH, and unknown values', () => {
    const { pkcs1, pkcs8 } = makeKey(1024)
    expect(detectPrivateKeyFormat(pkcs1)).toBe('pkcs1')
    expect(detectPrivateKeyFormat(pkcs8)).toBe('pkcs8')
    expect(detectPrivateKeyFormat('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe('openssh')
    expect(detectPrivateKeyFormat('garbage')).toBe('unknown')
  })
})

describe('pkcs1ToPkcs8', () => {
  it.each([1024, 2048, 4096])('matches Node PKCS#8 export byte-for-byte (%i-bit)', (bits) => {
    const { pkcs1, pkcs8 } = makeKey(bits)
    expect(pkcs1ToPkcs8(pkcs1)).toBe(pkcs8)
  })

  it('produces a key that signs RS256 verifiably with Node crypto', () => {
    const { pkcs1, publicKey } = makeKey()
    const data = Buffer.from('header.payload')
    const signature = sign('sha256', data, pkcs1ToPkcs8(pkcs1))
    expect(verify('sha256', data, publicKey, signature)).toBe(true)
  })

  it('produces a key WebCrypto can import as pkcs8 and sign with', async () => {
    const { pkcs1, publicKey } = makeKey()
    const key = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      pemToDer(pkcs1ToPkcs8(pkcs1)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const data = new TextEncoder().encode('header.payload')
    const signature = new Uint8Array(
      await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data),
    )
    expect(verify('sha256', data, publicKey, signature)).toBe(true)
  })

  it('rejects a malformed PKCS#1 body', () => {
    expect(() => pkcs1ToPkcs8('-----BEGIN RSA PRIVATE KEY-----\n!!!\n-----END RSA PRIVATE KEY-----'))
      .toThrow()
  })
})

describe('preparePrivateKey', () => {
  it('converts a GitHub-style PKCS#1 key to PKCS#8', () => {
    const { pkcs1, pkcs8 } = makeKey()
    expect(preparePrivateKey(pkcs1)).toBe(pkcs8)
  })

  it('converts a quoted, single-line, escaped PKCS#1 key (secret-store mangling)', () => {
    const { pkcs1, pkcs8 } = makeKey()
    expect(preparePrivateKey(`"${pkcs1.trim().replace(/\n/g, '\\n')}"`)).toBe(pkcs8)
  })

  it('converts a CRLF PKCS#1 key', () => {
    const { pkcs1, pkcs8 } = makeKey()
    expect(preparePrivateKey(pkcs1.replace(/\n/g, '\r\n'))).toBe(pkcs8)
  })

  it('passes a PKCS#8 key through unchanged', () => {
    const { pkcs8 } = makeKey()
    expect(preparePrivateKey(pkcs8)).toBe(pkcs8)
  })

  it('rejects OpenSSH keys with an actionable, secret-free message', () => {
    const openssh = '-----BEGIN OPENSSH PRIVATE KEY-----\nc2VjcmV0\n-----END OPENSSH PRIVATE KEY-----'
    expect(() => preparePrivateKey(openssh)).toThrow(/OpenSSH format/)
    expect(() => preparePrivateKey(openssh)).not.toThrow(/c2VjcmV0/)
  })

  it('rejects values without PEM markers', () => {
    expect(() => preparePrivateKey('not-a-key')).toThrow(/not a valid PEM/)
  })
})
