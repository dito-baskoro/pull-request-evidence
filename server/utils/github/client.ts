// Thin Octokit factory (plan section 8; Milestone 2).
//
// Given an already-minted short-lived installation token, return an Octokit
// instance for read-only GitHub REST calls. This keeps token minting
// (app-auth.ts) separate from client construction so tests can inject a token
// without touching the GitHub App credentials.
//
// The token passed here must be short-lived and must never be persisted or
// returned to the client.

import { Octokit } from '@octokit/rest'

export function createInstallationClient(token: string): Octokit {
  if (!token) {
    throw new Error('createInstallationClient requires a short-lived installation token.')
  }
  return new Octokit({ auth: token })
}
