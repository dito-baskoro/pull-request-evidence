# Cloudflare Workers Setup Guide

Step-by-step instructions to set up and deploy PR Evidence Pack on Cloudflare Workers while keeping Supabase as the Auth, Postgres, Storage, and RLS boundary.

This guide expands the "Deploy to Cloudflare Workers" section of the [README](../README.md).

## Prerequisites

Before starting, make sure you have:

- Node.js 20 or newer (Node 22 recommended; `nvm use 22`).
- A Cloudflare account ([sign up](https://dash.cloudflare.com/sign-up)).
- Your existing Supabase project (project URL, anon key, service-role key).
- A read-only GitHub App (App ID, private key `.pem`, public slug). See the [GitHub App setup guide](github-app-setup.md).
- An AI provider API key (OpenAI, or a compatible/gateway endpoint).

## Step 1: Get the code and install dependencies

```bash
git clone https://github.com/dito-baskoro/pull-request-evidence.git
cd pull-request-evidence
npm install
```

Notes:

- If your shell has a stale `NODE_OPTIONS`, run `unset NODE_OPTIONS` first.
- `npm install` runs `nuxt prepare` automatically via the `postinstall` script.

## Step 2: Run locally first (recommended)

Validate the app on plain Nuxt before touching Cloudflare, so app issues stay separate from deployment issues.

```bash
cp .env.example .env
# edit .env and fill in your real values
npm run dev
```

Open `http://localhost:3000` and confirm the login page renders.

## Step 3: Authenticate Wrangler

Wrangler is Cloudflare's CLI, installed as a dev dependency.

```bash
npx wrangler login
```

This opens a browser to authorize Wrangler against your Cloudflare account.

## Step 4: Understand the config already in the repo

You do not need to write Wrangler config from scratch.

`wrangler.jsonc`:

```jsonc
{
  "name": "pr-evidence-pack",
  "compatibility_date": "2025-09-19",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "keep_vars": true
}
```

- `nodejs_compat` is required by the GitHub App JWT signing and `node:crypto`.
- `keep_vars: true` prevents deploys from wiping the plaintext variables you set in the dashboard.

`nuxt.config.ts` already targets Cloudflare via Nitro's `cloudflare-module` preset. Nitro generates the Worker entrypoint and asset configuration at build time. Do not use `npm run generate` to deploy: the API routes under `server/api/` must remain dynamic.

## Step 5: Do a first deploy to create the Worker

The Worker must exist before you can attach secrets to it.

```bash
npm run deploy:cloudflare
```

This runs `nuxt build`, then `wrangler deploy`. It may fail at runtime until secrets are set, but it registers the `pr-evidence-pack` Worker and returns its URL:

```
https://pr-evidence-pack.<your-subdomain>.workers.dev
```

Note that URL; you will use it as `NUXT_PUBLIC_APP_URL`.

## Step 6: Set the public (non-secret) variables

In the Cloudflare dashboard: **Workers & Pages -> pr-evidence-pack -> Settings -> Variables and Secrets**, add these as plaintext variables:

| Variable | Value |
|---|---|
| `NUXT_GITHUB_APP_ID` | Your GitHub App numeric ID |
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NUXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NUXT_PUBLIC_APP_URL` | Your final `https://...workers.dev` URL from Step 5 |
| `NUXT_PUBLIC_GITHUB_APP_SLUG` | Your GitHub App slug |
| `NUXT_AI_GATEWAY_BASE_URL` | Only if using a custom/gateway endpoint |

The `NUXT_PUBLIC_*` values are visible in the browser by design. Never put a private key or the service-role key here.

## Step 7: Set the secrets (encrypted)

Set these via the CLI so they never appear in the dashboard as plaintext or in the repo:

```bash
npx wrangler secret put NUXT_GITHUB_WEBHOOK_SECRET
npx wrangler secret put NUXT_SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put NUXT_AI_API_KEY
```

For the multi-line GitHub PEM, pipe the file so line breaks are preserved:

```bash
npx wrangler secret put NUXT_GITHUB_APP_PRIVATE_KEY < /secure/path/github-app-private-key.pem
```

Keep that `.pem` file outside the repository.

## Step 8: Point Supabase auth at your Worker URL

In the Supabase dashboard: **Authentication -> URL Configuration**:

- Site URL: your `NUXT_PUBLIC_APP_URL` (the Worker URL).
- Redirect URLs: add `<NUXT_PUBLIC_APP_URL>/dashboard`.

Otherwise magic-link/OAuth logins will not return to your app. Your Supabase database, migrations, and RLS stay unchanged; Cloudflare only replaces the host.

## Step 9: Apply database migrations (if not already done)

```bash
supabase db push
# or run supabase/migrations/0001_init.sql then 0002_rls.sql in the SQL editor
```

## Step 10: Redeploy with everything configured

```bash
npm run deploy:cloudflare
```

Because `keep_vars: true` is set, this preserves the dashboard variables from Step 6.

## Step 11: Smoke-test the deployment

Visit your Worker URL and verify:

1. `/login` loads and assets render (no 404s).
2. A Supabase magic link returns you to `/dashboard` with a session.
3. GitHub App installations, repositories, and PRs list correctly (exercises JWT crypto and Octokit).
4. Running one analysis completes (`/api/analyses` route, AI call, Supabase writes).
5. The report renders and an evidence permalink opens the exact lines on GitHub.

Watch logs live while testing:

```bash
npx wrangler tail
```

## Optional: local Workers-runtime preview

To test in Cloudflare's actual runtime (workerd) before deploying, put local values in a gitignored `.dev.vars` file, then:

```bash
npm run preview:cloudflare
```

## Quick reference

| Task | Command |
|---|---|
| Install | `npm install` |
| Local Nuxt dev | `npm run dev` |
| Local Workers preview | `npm run preview:cloudflare` |
| Deploy | `npm run deploy:cloudflare` |
| Set a secret | `npx wrangler secret put NAME` |
| Watch logs | `npx wrangler tail` |

## Things to know

- Order matters: deploy once (Step 5) to create the Worker, then add secrets (Step 7), then deploy again (Step 10).
- Not yet validated live: the build/deploy path could not run in the authoring sandbox (no npm registry access). Expect to resolve minor dependency or peer-version adjustments on your first real `npm install` and `npm run build`.

## Reference documentation

- [Nuxt on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)
- [Cloudflare Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Supabase on Cloudflare Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/)
