// Small content-hash helper (plan sections 7 and 15; Milestone 3).
//
// Content hashes let ingestion detect duplicate artifacts and let evidence
// spans record an excerpt fingerprint that can be checked against the source at
// the immutable SHA. We use SHA-256 hex from Node's built-in crypto so there is
// no external dependency and the function stays pure and testable.

import { createHash } from 'node:crypto'

/** Return the lowercase hex SHA-256 of a string. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
