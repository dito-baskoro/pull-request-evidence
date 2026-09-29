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

After a user installs or updates the app, GitHub redirects the browser to this Setup URL and appends `installation_id` and `setup_action` query parameters. The dashboard reads those parameters and records the installation for the signed-in user, so the person who completes the install becomes the owner of that installation. This is what persists the connection so the dashboard stops showing "No GitHub App connected yet". The Setup URL must stay consistent with `NUXT_PUBLIC_APP_URL` and always point at the `/dashboard` path.

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

The application uses it to build the install URL on the dashboard:

```
https://github.com/apps/<slug>/installations/new
```

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
NUXT_PUBLIC_GITHUB_APP_SLUG=pr-evidence-pack
NUXT_PUBLIC_APP_URL=http://localhost:3000
```

`NUXT_GITHUB_WEBHOOK_SECRET` can remain unset for the MVP.

### Production (Cloudflare Workers)

- `NUXT_GITHUB_APP_ID`: plaintext Worker variable.
- `NUXT_PUBLIC_GITHUB_APP_SLUG`: plaintext Worker variable.
- `NUXT_GITHUB_APP_PRIVATE_KEY`: encrypted Worker Secret. Pipe the `.pem` file so newlines are preserved:

  ```bash
  npx wrangler secret put NUXT_GITHUB_APP_PRIVATE_KEY < /secure/path/github-app-private-key.pem
  ```

See the [Cloudflare Workers setup guide](cloudflare-setup.md) for the full variable and secret setup.

## Step 10: Verify

1. Start the app (`npm run dev`, or your deployed Worker).
2. Sign in and open the dashboard.
3. Confirm the "Install GitHub App" link points to `https://github.com/apps/<your-slug>/installations/new`.
4. Complete an install. GitHub redirects back to `<NUXT_PUBLIC_APP_URL>/dashboard` with the `installation_id` and `setup_action` query parameters, the dashboard shows a success banner, and the new installation appears automatically without a manual reload or database step. Reinstalling does not create a duplicate row.
5. Confirm your installation, repositories, and open pull requests list correctly. This exercises the JWT signing and installation-token exchange.

If installations do not appear, first confirm the GitHub App **Setup URL** is set to `<NUXT_PUBLIC_APP_URL>/dashboard` (matching `NUXT_PUBLIC_APP_URL`), then re-check the App ID, the private key (full PEM including the BEGIN/END lines), and that the app is installed on at least one repository.

## Troubleshooting

- **"Missing NUXT_GITHUB_APP_ID or NUXT_GITHUB_APP_PRIVATE_KEY":** the server-only credentials are not set. Confirm `.env` locally or the Worker variable/secret in production.
- **Private key errors:** ensure the value is the complete PEM. Multi-line values must be quoted or provided with literal `\n` escapes; the app converts literal `\n` back to newlines.
- **No repositories listed:** the app is authenticated but not installed on any repository, or it was installed on repositories other than the one you expect. Re-run the install step and select the correct repositories.
- **Dashboard still shows "No GitHub App connected yet" after installing:** the GitHub App **Setup URL** is missing or does not point at `<NUXT_PUBLIC_APP_URL>/dashboard`, so GitHub never redirected back with the `installation_id` and `setup_action` parameters that record the installation. Set the Setup URL to `<NUXT_PUBLIC_APP_URL>/dashboard`, confirm it matches `NUXT_PUBLIC_APP_URL`, then install again while signed in.

## Reference documentation

- [Registering a GitHub App](https://docs.github.com/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Managing private keys for GitHub Apps](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)
- [Authenticating as a GitHub App installation](https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
