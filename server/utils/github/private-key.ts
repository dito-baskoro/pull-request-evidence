// GitHub App private key handling (pure, dependency-free, runtime-agnostic).
//
// Why this exists: GitHub downloads App private keys in PKCS#1 format
// ("-----BEGIN RSA PRIVATE KEY-----"). On Cloudflare Workers, @octokit/auth-app
// signs the App JWT through universal-github-app-jwt's WebCrypto build, and
// WebCrypto can only import PKCS#8 keys ("-----BEGIN PRIVATE KEY-----"). A
// PKCS#1 key therefore fails locally, before any request reaches GitHub. We
// convert PKCS#1 to PKCS#8 here so the key downloaded from GitHub works as-is
// on every runtime.
//
// Only Web-standard APIs (atob/btoa) are used, so this runs unchanged on
// Workers, Node 16+, and in tests. Key material is never logged, and error
// messages never include it.

const PKCS1_HEADER = '-----BEGIN RSA PRIVATE KEY-----'
const PKCS1_FOOTER = '-----END RSA PRIVATE KEY-----'
const PKCS8_HEADER = '-----BEGIN PRIVATE KEY-----'
const PKCS8_FOOTER = '-----END PRIVATE KEY-----'
const OPENSSH_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----'

/** Private key container formats we can recognize from the PEM header. */
export type PrivateKeyFormat = 'pkcs1' | 'pkcs8' | 'openssh' | 'unknown'

/**
 * Normalize a private key that may have been mangled by an environment or
 * secret store. Handles, in order:
 *   - surrounding single or double quotes (dashboards sometimes keep them),
 *   - literal escaped "\n" / "\r\n" sequences (the value became one line),
 *   - CRLF line endings,
 *   - stray leading/trailing whitespace.
 * A well-formed multiline PEM passes through unchanged (aside from trimming).
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim()
  if (
    (key.startsWith('"') && key.endsWith('"'))
    || (key.startsWith('\'') && key.endsWith('\''))
  ) {
    key = key.slice(1, -1)
  }
  key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
  key = key.replace(/\r\n/g, '\n')
  return key.trim()
}

/** Detect the key format from its PEM header. */
export function detectPrivateKeyFormat(key: string): PrivateKeyFormat {
  if (key.includes(PKCS1_HEADER)) return 'pkcs1'
  if (key.includes(PKCS8_HEADER)) return 'pkcs8'
  if (key.includes(OPENSSH_HEADER)) return 'openssh'
  return 'unknown'
}

/** Extract and decode the base64 body between a PEM header and footer. */
function pemBodyToBytes(key: string, header: string, footer: string): Uint8Array {
  const start = key.indexOf(header)
  const end = key.indexOf(footer)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Private key PEM is malformed (missing or misordered BEGIN/END markers).')
  }
  const base64 = key.slice(start + header.length, end).replace(/[^A-Za-z0-9+/=]/g, '')
  let binary: string
  try {
    binary = atob(base64)
  }
  catch {
    throw new Error('Private key PEM body is not valid base64.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Encode a DER length (short form below 128, long form otherwise). */
function derLength(length: number): number[] {
  if (length < 0x80) return [length]
  const out: number[] = []
  let remaining = length
  while (remaining > 0) {
    out.unshift(remaining & 0xff)
    remaining >>= 8
  }
  return [0x80 | out.length, ...out]
}

/** Wrap content bytes in a DER TLV with the given tag. */
function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const len = derLength(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tag
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function bytesToPem(bytes: Uint8Array, header: string, footer: string): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  const lines = base64.match(/.{1,64}/g) ?? []
  return [header, ...lines, footer].join('\n')
}

// PKCS#8 fixed prefix pieces for an RSA key:
//   version INTEGER 0
//   AlgorithmIdentifier SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
const PKCS8_VERSION = new Uint8Array([0x02, 0x01, 0x00])
const RSA_ALGORITHM_IDENTIFIER = new Uint8Array([
  0x30, 0x0d,
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
])

/**
 * Convert an RSA PKCS#1 PEM ("BEGIN RSA PRIVATE KEY") into the equivalent
 * PKCS#8 PEM ("BEGIN PRIVATE KEY") by wrapping the PKCS#1 DER in a
 * PrivateKeyInfo structure. The key material itself is unchanged.
 */
export function pkcs1ToPkcs8(pkcs1Pem: string): string {
  const pkcs1Der = pemBodyToBytes(pkcs1Pem, PKCS1_HEADER, PKCS1_FOOTER)
  if (pkcs1Der.length === 0 || pkcs1Der[0] !== 0x30) {
    throw new Error('Private key is not a valid PKCS#1 RSA key.')
  }
  const privateKeyInfo = derTlv(
    0x30,
    concatBytes(PKCS8_VERSION, RSA_ALGORITHM_IDENTIFIER, derTlv(0x04, pkcs1Der)),
  )
  return bytesToPem(privateKeyInfo, PKCS8_HEADER, PKCS8_FOOTER)
}

/**
 * Prepare a raw private key from configuration for JWT signing on any
 * runtime: normalize mangling, then ensure PKCS#8. Throws a secret-free,
 * actionable error when the key cannot be used.
 */
export function preparePrivateKey(raw: string): string {
  const key = normalizePrivateKey(raw)
  const format = detectPrivateKeyFormat(key)
  switch (format) {
    case 'pkcs8':
      return key
    case 'pkcs1':
      return pkcs1ToPkcs8(key)
    case 'openssh':
      throw new Error(
        'GitHub App private key is in OpenSSH format, which cannot be used. Use the .pem file downloaded from the GitHub App settings page.',
      )
    default:
      throw new Error(
        'GitHub App private key is not a valid PEM (missing BEGIN/END markers). Set it by piping the .pem file, not by pasting.',
      )
  }
}
