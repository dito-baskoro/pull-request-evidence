// GitHub App authentication (plan sections 8 and 15; Milestone 2).
//
// Exchanges the GitHub App identity for a SHORT-LIVED installation access
// token using @octokit/auth-app, then returns an Octokit instance scoped to
// that installation.
//
// Hard rules:
//   - Installation tokens are short-lived and are NEVER persisted (no database
//     column exists for them by design) and NEVER returned to the client.
//   - The app requests read-only permissions only (configured on the GitHub
//     App itself, see README / plan section 8). This module never requests
//     write scopes.
//   - The App id and private key come from SERVER-ONLY runtimeConfig.

import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { preparePrivateKey } from './private-key'

/** A minted installation token plus its expiry. Never persisted or logged. */
export interface InstallationToken {
  token: string
  expiresAt: string
}

// Re-exported for existing callers/tests.
export { normalizePrivateKey } from './private-key'

function readAppCredentials(): { appId: string; privateKey: string } {
  const config = useRuntimeConfig()
  const appId = config.githubAppId
  const rawPrivateKey = config.githubAppPrivateKey
  if (!appId || !rawPrivateKey) {
    throw new Error(
      'Missing NUXT_GITHUB_APP_ID or NUXT_GITHUB_APP_PRIVATE_KEY (server-only). See .env.example.',
    )
  }
  // The App id must be the numeric App ID (not the Client ID).
  if (!/^\d+$/.test(String(appId).trim())) {
    throw new Error(
      'GitHub App credentials are invalid: NUXT_GITHUB_APP_ID must be the numeric App ID (not the Client ID). See docs/github-app-setup.md.',
    )
  }
  // Normalize mangling and convert GitHub's PKCS#1 download to PKCS#8, which
  // WebCrypto (used for JWT signing on Cloudflare Workers) requires. Throws a
  // secret-free, actionable error when the key cannot be used.
  let privateKey: string
  try {
    privateKey = preparePrivateKey(String(rawPrivateKey))
  }
  catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown key error'
    throw new Error(
      `GitHub App credentials are invalid: NUXT_GITHUB_APP_PRIVATE_KEY cannot be used (${reason}) See docs/github-app-setup.md.`,
    )
  }
  return { appId: String(appId).trim(), privateKey }
}

/**
 * Mint a short-lived installation access token. Intended for internal use by
 * getInstallationOctokit; exposed for tests/seams. The returned token must
 * never be persisted or sent to the browser.
 */
export async function mintInstallationToken(
  installationId: number,
): Promise<InstallationToken> {
  const { appId, privateKey } = readAppCredentials()
  const auth = createAppAuth({ appId, privateKey })
  const result = await auth({ type: 'installation', installationId })
  return { token: result.token, expiresAt: result.expiresAt }
}

/**
 * Typed seam returning an Octokit instance authenticated as a specific
 * installation. All calls made through it are read-only (the app has no write
 * permissions). Callers must confirm the current user owns the installation
 * BEFORE calling this.
 */
export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const { appId, privateKey } = readAppCredentials()
  // Octokit's app auth strategy caches and refreshes the short-lived token
  // internally; it is never persisted by this application.
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  })
}

/**
 * An app-level Octokit (JWT auth, no installation) used only for listing the
 * installations reachable by the app. Read-only.
 */
export async function getAppOctokit(): Promise<Octokit> {
  const { appId, privateKey } = readAppCredentials()
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  })
}
