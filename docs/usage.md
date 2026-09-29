# Using PR Evidence Pack

Step-by-step guide to analyzing a pull request once the app is deployed and the GitHub App is connected.

If you have not deployed yet, start with the [Cloudflare Workers setup guide](cloudflare-setup.md) and the [GitHub App setup guide](github-app-setup.md).

## What the app produces

Given one pull request, the app builds a cited "evidence pack":

- a deterministic **change map** (file categories and candidate test associations),
- **registered evidence spans**, each with a stable ID and a permalink to the exact lines at the immutable commit SHA,
- one AI **behavioral-change** claim, classified as observed or inferred, grounded in that evidence.

It is read-only. It never writes to GitHub, and it never claims "no test found" means "untested".

## Prerequisites

- The app is deployed and reachable (for example `https://<your-worker>.workers.dev`).
- You have signed in and the GitHub App is connected (the dashboard lists your installation rather than "No GitHub App connected yet"). See the [GitHub App setup guide](github-app-setup.md).
- `NUXT_AI_API_KEY` is set on the Worker (see "AI provider" below). Without it, the deterministic parts still run but no AI claim is produced.
- The repository you want to analyze is JavaScript/TypeScript and has at least one open pull request. The current slice targets JS/TS PRs.

## AI provider

The AI behavioral-change pass calls an OpenAI-compatible provider. The default model is `gpt-4o-mini`.

Set the key as an encrypted Worker Secret:

```bash
npx wrangler secret put NUXT_AI_API_KEY
```

If you route through a gateway or a compatible endpoint, also set the plaintext variable `NUXT_AI_GATEWAY_BASE_URL`. See the [Cloudflare Workers setup guide](cloudflare-setup.md) for where to configure variables and secrets.

If the key is missing or the model call fails, the run ends in a recoverable state: the change map and registered evidence are still shown, but there is no behavioral claim.

## Step 1: Sign in and open the dashboard

1. Open your deployed URL.
2. Sign in with the magic link.
3. Open the dashboard. Your connected installation appears under "Installations".

## Step 2: Select an installation and repository

1. Click your installation (for example `your-account (User)`).
2. The dashboard lists the repositories the app can access. These are fetched live from GitHub, not stored.
3. Choose the repository whose pull request you want to analyze.

If a repository is missing, the GitHub App is not installed on it. Re-run the install and select that repository. See the [GitHub App setup guide](github-app-setup.md).

## Step 3: Pick a pull request

Selecting a repository lists its open pull requests (title, author, head SHA). Choose the one to analyze.

If the list is empty, the repository has no open pull requests, or it is not a JavaScript/TypeScript project.

## Step 4: Run the analysis

Starting the analysis creates a run that:

1. fetches the PR metadata, changed files and patches, commits, and CI checks at the immutable head SHA,
2. builds the deterministic change map,
3. registers evidence spans with stable IDs and commit permalinks,
4. runs one AI behavioral-change pass and validates its citations.

The pipeline currently runs synchronously in the request (a documented MVP limitation), so a large pull request can take a while before the response returns. Re-running the same PR at the same head SHA is idempotent: it does not create duplicate rows.

## Step 5: Read the analysis view

You land on `/analyses/<id>`, which shows:

- a **status** pill and **coverage** indicator, with a Refresh button,
- the **change map**: file categories, exclusions, and candidate source/test associations (a candidate association is never presented as proof of test coverage),
- **registered evidence**: each span's opaque ID, file path, side and line range, and a **permalink** to the exact lines at the immutable commit SHA.

## Step 6: Open the cited report

Click **View cited report** (`/reports/<id>`). The report shows:

- **status and limitations**: the run status, coverage, and the model/workflow used. Partial or failed runs say so explicitly.
- **behavioral changes**: each validated claim with an observed/inferred badge, a confidence value, and its cited evidence as clickable commit permalinks.
- **statements shown as unknown**: any claim that could not be grounded in validated evidence is listed here rather than presented as a fact.

An empty claim list on a completed run is not a statement that the PR has no behavioral impact; it means no matching evidence was found in the analyzed context.

## Troubleshooting

- **Dashboard still shows "No GitHub App connected yet":** the GitHub App Setup URL is not set to `<NUXT_PUBLIC_APP_URL>/dashboard`, so the installation was never recorded. See the [GitHub App setup guide](github-app-setup.md).
- **Repository list is empty:** the app is not installed on that repository. Re-run the install and select it.
- **No open pull requests:** the repository has none, or it is not JavaScript/TypeScript.
- **Run completes but there is no behavioral claim:** `NUXT_AI_API_KEY` is not set or the model call failed. Check live logs with `npx wrangler tail` while running an analysis.
- **A 502 or other error during analysis:** run `npx wrangler tail`, reproduce, and read the sanitized status and message. For GitHub App credential and key-format issues, see the troubleshooting section of the [GitHub App setup guide](github-app-setup.md).

## Current limitations

- JavaScript/TypeScript pull requests only.
- One pull request per analysis.
- Analysis runs synchronously in the request; very large PRs may be slow or partially analyzed.
- The app reads GitHub; it does not post comments, approve, or change code.
