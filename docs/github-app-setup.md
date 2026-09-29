# GitHub App Setup Guide

Step-by-step instructions to create and install the read-only GitHub App that PR Evidence Pack uses to read pull requests, diffs, commits, and CI checks.

This app authenticates using short-lived installation tokens minted server-side; it requests read-only permissions only and never persists tokens.

Use this guide together with the [Cloudflare Workers setup guide](cloudflare-setup.md), which explains where each value below is configured in production.

## Why a GitHub App (not a personal token)

PR Evidence Pack needs to read pull requests from repositories a user connects. A GitHub App is used instead of a personal access token or OAuth App because it provides:

- Fine-grained, read-only permissions.
- Per-installation access to only the selected repositories.
- Short-lived installation tokens minted on demand server-side.

The App ID is a public identifier. The private key is secret and must stay server-side; together they let the server sign a JWT and request temporary installation tokens.

## Step 1: Create the GitHub App

1. Open [GitHub App settings](https://github.com/settings/apps).
2. Click **New GitHub App**.
3. Fill in:
   - **GitHub App name:** a unique name, for example `PR Evidence Pack`.
   - **Homepage URL:** `http://localhost:3000` for development, or your deployed Worker URL.
   - **Callback URL:** not required for the current Supabase-based login flow.
   - **Setup URL (after installation):** set this to `<NUXT_PUBLIC_APP_URL>/dashboard`, using `http://localhost:3000/dashboard` for local development or `https://<your-app>/dashboard` in production. If **Redirect on update after installation** is available, enable it so updates return to the same `/dashboard` path.

After a user installs or updates the app, GitHub redirects the browser to this Setup URL and appends `installation_id`, `setup_action`, and the `state` query parameter that the dashboard's "Connect GitHub App" link carried. The dashboard reads those parameters and records the installation for the signed-in user. This is what persists the connection so the dashboard stops showing "No GitHub App connected yet". The Setup URL must stay consistent with `NUXT_PUBLIC_APP_URL` and always point at the `/dashboard` path.

The `state` parameter is a server-issued, short-lived token bound to the signed-in user who started the connection from our dashboard (`GET /api/github/connect` signs it). GitHub echoes it back on the redirect, and the server verifies it before recording the installation, so ownership is attributed to the user who initiated the install from our app rather than to whoever merely arrives with an `installation_id`. An `installation_id` is not secret (it appears in redirect URLs and is enumerable), so without this binding a signed-in user could claim another tenant's installation. Verifying the `state` blocks that bare, guessed, or replayed `installation_id` from being claimed.

Residual trust assumption: the `state` binding proves the connect was initiated from our app by this signed-in user; it does not cryptographically prove GitHub account ownership. Proving that would require GitHub user-to-server OAuth, which is deliberately out of scope for this read-only slice (authentication here is Supabase magic-link, not GitHub OAuth).

This flow remains read-only: the dashboard verifies the installation through the server using the App JWT and stores only the installation reference (id and account login/type) scoped to the owner. No installation access token is persisted, and repositories are still fetched live rather than stored.

## Step 2: Disable the webhook (for the MVP)

1. Under **Webhook**, uncheck **Active**.

The current vertical slice does not process webhooks. `NUXT_GITHUB_WEBHOOK_SECRET` exists for a future milestone and can be left unset for now.

## Step 3: Set read-only repository permissions

Under **Repository permissions**, set only these, all to **Read-only**:

| Permission | Access | Why it is needed |
|---|---|---|
| Metadata | Read-only | Base repository access (selected automatically) |
| Contents | Read-only | Read file content at an immutable commit SHA |
| Pull requests | Read-only | Read PR metadata, changed files, patches, and commits |
| Checks | Read-only | Read CI check runs for the head SHA |
| Issues | Read-only | Read linked issue context (optional but recommended) |

Do not grant any write permissions. The application never writes to GitHub.

## Step 4: Choose installation scope

Under **Where can this GitHub App be installed?**

- Choose **Only on this account** for personal or single-team development.
- Choose **Any account** only if you intend to let other users install it later.

Then click **Create GitHub App**.

## Step 5: Record the App ID

After creation, GitHub opens the app's settings page. Under **About**, copy the numeric **App ID** (this is different from the Client ID).

This maps to:

```env
NUXT_GITHUB_APP_ID=123456
```

## Step 6: Generate the private key

On the same settings page:

1. Scroll to **Private keys**.
2. Click **Generate a private key**.
3. GitHub downloads a `.pem` file. Store it securely, outside the repository.

This maps to:

```env
NUXT_GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
```

The private key is secret. Never commit it and never place it in a `NUXT_PUBLIC_*` variable. In production, set it as an encrypted Cloudflare Worker Secret (see the Cloudflare guide).

## Step 7: Record the app slug

The public app URL looks like:

```
https://github.com/apps/pr-evidence-pack
```

The final path segment is the slug. It maps to:

```env
NUXT_PUBLIC_GITHUB_APP_SLUG=pr-evidence-pack
```

The server uses it to build the install URL for the dashboard "Connect GitHub App" link, appending the per-user `state` token described above:

```
https://github.com/apps/<slug>/installations/new?state=<server-issued-token>
```

The dashboard fetches this URL from `GET /api/github/connect` rather than building it in the browser, so the link always carries a freshly signed `state`.

## Step 8: Install the app on your repositories

Install while signed in to PR Evidence Pack so the installation is attributed to your account.

1. From the app settings page, click **Install App** (or use the "Connect GitHub App" link on the dashboard).
2. Click **Install** next to your account or organization.
3. Choose **Only select repositories**.
4. Select `pull-request-evidence` and any other repositories whose pull requests you want to analyze.
5. Click **Install**. GitHub redirects you back to the Setup URL (`<NUXT_PUBLIC_APP_URL>/dashboard`) with `installation_id` and `setup_action` query parameters, and the dashboard records the installation automatically. There is no manual database step. Reconnecting or reinstalling the same account is idempotent and does not create a duplicate installation row.

## Step 9: Map values to configuration

### Local development (`.env`)

```env
NUXT_GITHUB_APP_ID=123456
NUXT_GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
NUXT_GITHUB_CONNECT_STATE_SECRET=generate-with-openssl-rand-hex-32
NUXT_PUBLIC_GITHUB_APP_SLUG=pr-evidence-pack
NUXT_PUBLIC_APP_URL=http://localhost:3000
```

`NUXT_GITHUB_CONNECT_STATE_SECRET` signs the per-user connect `state` token; generate a random value with `openssl rand -hex 32`. The connect link (and therefore the install flow) is unavailable until it is set, since the server fails closed rather than issue an unverifiable link. `NUXT_GITHUB_WEBHOOK_SECRET` can remain unset for the MVP.

### Production (Cloudflare Workers)

- `NUXT_GITHUB_APP_ID`: plaintext Worker variable.
- `NUXT_PUBLIC_GITHUB_APP_SLUG`: plaintext Worker variable.
- `NUXT_GITHUB_APP_PRIVATE_KEY`: encrypted Worker Secret. Pipe the `.pem` file so newlines are preserved:

  ```bash
  npx wrangler secret put NUXT_GITHUB_APP_PRIVATE_KEY < /secure/path/github-app-private-key.pem
  ```

- `NUXT_GITHUB_CONNECT_STATE_SECRET`: encrypted Worker Secret. Generate and set it:

  ```bash
  openssl rand -hex 32 | npx wrangler secret put NUXT_GITHUB_CONNECT_STATE_SECRET
  ```

See the [Cloudflare Workers setup guide](cloudflare-setup.md) for the full variable and secret setup.

## Step 10: Verify

1. Start the app (`npm run dev`, or your deployed Worker).
2. Sign in and open the dashboard.
3. Confirm the "Connect GitHub App" link points to `https://github.com/apps/<your-slug>/installations/new?state=<token>` (the `state` is issued by `GET /api/github/connect`). If the link is missing, confirm `NUXT_PUBLIC_GITHUB_APP_SLUG` and `NUXT_GITHUB_CONNECT_STATE_SECRET` are both set.
4. Complete an install. GitHub redirects back to `<NUXT_PUBLIC_APP_URL>/dashboard` with the `installation_id` and `setup_action` query parameters, the dashboard shows a success banner, and the new installation appears automatically without a manual reload or database step. Reinstalling does not create a duplicate row.
5. Confirm your installation, repositories, and open pull requests list correctly. This exercises the JWT signing and installation-token exchange.

If installations do not appear, first confirm the GitHub App **Setup URL** is set to `<NUXT_PUBLIC_APP_URL>/dashboard` (matching `NUXT_PUBLIC_APP_URL`), then re-check the App ID, the private key (full PEM including the BEGIN/END lines), and that the app is installed on at least one repository.

## Troubleshooting

- **"Missing NUXT_GITHUB_APP_ID or NUXT_GITHUB_APP_PRIVATE_KEY":** the server-only credentials are not set. Confirm `.env` locally or the Worker variable/secret in production.
- **Private key errors:** ensure the value is the complete PEM. Multi-line values must be quoted or provided with literal `\n` escapes; the app converts literal `\n` back to newlines.
- **No repositories listed:** the app is authenticated but not installed on any repository, or it was installed on repositories other than the one you expect. Re-run the install step and select the correct repositories.
- **Dashboard still shows "No GitHub App connected yet" after installing:** the GitHub App **Setup URL** is missing or does not point at `<NUXT_PUBLIC_APP_URL>/dashboard`, so GitHub never redirected back with the `installation_id`, `setup_action`, and `state` parameters that record the installation. Set the Setup URL to `<NUXT_PUBLIC_APP_URL>/dashboard`, confirm it matches `NUXT_PUBLIC_APP_URL`, then install again while signed in.
- **"This GitHub connection link is invalid or has expired":** the `state` token failed verification. This happens when the link was opened long after it was issued (the token is short-lived, about 15 minutes), when it was reused across accounts, or when `NUXT_GITHUB_CONNECT_STATE_SECRET` changed between issuing and verifying. Start the connection again from the dashboard so a fresh `state` is issued.
- **"Connect GitHub App" link does not appear:** `NUXT_PUBLIC_GITHUB_APP_SLUG` or `NUXT_GITHUB_CONNECT_STATE_SECRET` is unset. The server fails closed and hides the link rather than issue one without a verifiable `state`.
- **Private key format (PKCS#1 vs PKCS#8):** GitHub downloads the key as PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`). On Cloudflare Workers the App JWT is signed with WebCrypto, which only accepts PKCS#8 (`-----BEGIN PRIVATE KEY-----`). The app converts PKCS#1 to PKCS#8 automatically, so upload the downloaded `.pem` unchanged. OpenSSH-format keys (`-----BEGIN OPENSSH PRIVATE KEY-----`, for example when exported from a password manager) are not supported; use the original `.pem` from GitHub. To convert manually instead: `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private-key.pem -out private-key-pkcs8.pem`.
- **502 "Could not authenticate as the GitHub App before contacting GitHub":** the App JWT could not be signed, so no request reached GitHub. Check the private key format (above) and that the full PEM was stored.
- **502 "Could not verify the GitHub installation with GitHub" or "GitHub App credentials appear to be invalid":** the server could not authenticate to GitHub as the app, so signing the App JWT or the `getInstallation` lookup failed. This is almost always a credential problem in the deployment environment:
  - Watch the live logs while reproducing: `npx wrangler tail`. The server logs the sanitized upstream status and message (for example `401 Bad credentials`), which pinpoints the cause. No key or token is logged.
  - Set the private key by **piping the `.pem` file**, never by pasting it, so newlines are preserved:

    ```bash
    npx wrangler secret put NUXT_GITHUB_APP_PRIVATE_KEY < /secure/path/github-app-private-key.pem
    ```

    The app normalizes keys stored with escaped `\n`, surrounding quotes, or CRLF, but a key with lost line structure cannot be recovered.
  - Confirm `NUXT_GITHUB_APP_ID` is the **numeric App ID** from the app's About page, not the Client ID.
  - Confirm the app is installed on the account whose installation you are connecting.

## Reference documentation

- [Registering a GitHub App](https://docs.github.com/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Managing private keys for GitHub Apps](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [Authenticating as a GitHub App installation](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
