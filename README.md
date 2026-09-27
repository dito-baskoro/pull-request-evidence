# PR Evidence Pack

PR Evidence Pack is a read-only web application that turns a GitHub pull request into a cited review-preparation report. It maps stated intent, implementation changes, requirements, test evidence, CI checks, potential risks, and unresolved questions, always linking claims back to immutable source evidence, and without claiming to approve the code.

This repository implements the first vertical slice of the plan (sign in, connect a read-only GitHub App, select a PR, ingest immutable artifacts, build a deterministic change map, produce one cited behavioral claim, validate the citation, and render a working commit permalink). Later milestones extend the same evidence model into requirements, risks, tests, and synthesis.

The deterministic core and read-only GitHub seams (Milestones 2 to 4) are implemented under `server/utils/{github,patches,analysis}` and exposed through the Nitro routes under `server/api/`. The AI behavioral-change pass and citation validation (Milestone 5) are implemented behind the `AiAnalysisHook` seam: the provider-isolated AI code lives under `server/utils/ai/`, and citation/provenance validation lives in `server/utils/analysis/citation-validator.ts`.

## Framework note: Nuxt, not Next.js

The authoritative plan (`../PR_EVIDENCE_PACK_IMPLEMENTATION_PLAN.md`) is written for Next.js. This implementation is a faithful translation to Nuxt 3 (Vue 3 plus the Nitro server), which was chosen because a server-side runtime is required for GitHub App token exchange, AI calls, and the Supabase service-role key, none of which may reach the browser. The mapping is:

- Next.js `app/*/page.tsx` becomes Nuxt `pages/*.vue`.
- Next.js `app/api/*/route.ts` becomes Nitro routes under `server/api/*`.
- The plan's `lib/*` modules live under `server/utils/*` (Nitro auto-imports these).

## Project structure

```text
nuxt.config.ts            Nuxt config, runtimeConfig (server-only secrets + public values)
app.vue                   Root shell (NuxtLayout + NuxtPage)
layouts/default.vue       App title + sign-out control
pages/
  index.vue               Redirects to /dashboard
  login.vue               Magic-link sign in
  dashboard.vue           Protected dashboard (auth middleware, empty/loading states)
middleware/auth.ts        Redirects anonymous users to /login
composables/useAuth.ts    Browser auth composable (current user, sign in, sign out)
server/utils/supabase/
  client.ts               Browser anon client boundary
  server.ts               Per-request SSR client (reads auth cookies)
  admin.ts                Service-role client (SERVER-ONLY, bypasses RLS)
  analyses/[id].vue       Analysis view: change map + registered evidence permalinks
components/
  ChangeMap.vue           Category counts, exclusion reasons, candidate associations
server/utils/
  hash.ts                 SHA-256 content-hash helper
  github/
    app-auth.ts           GitHub App JWT + short-lived installation token exchange
    client.ts             Octokit factory from an installation token
    fetch-pr.ts           Read-only PR metadata, changed files/patches, commits
    fetch-checks.ts       Read-only check-run fetch + normalization
    fetch-content.ts      Read-only raw file content at an immutable SHA
    permalink.ts          Commit-SHA blob permalink builder (pure)
  patches/
    parse-patch.ts        Unified-diff parser into base/head line maps (pure)
    map-lines.ts          Head/base line resolution + added-run extraction (pure)
  analysis/
    classify-file.ts      Plan section 9 file classification (pure)
    change-map.ts         Deterministic change map + candidate associations (pure)
    evidence-registry.ts  Opaque E-NNNNN evidence IDs bound to the head SHA
    orchestrator.ts       Run pipeline seam + typed AI hook (FEAT-003)
server/api/
  github/installations.get.ts  List owned installations
  github/repositories.get.ts   List repos for an owned installation
  github/pulls.get.ts          List open PRs for an owned repository
  analyses/index.post.ts       Create a run (ownership-checked) + deterministic pipeline
  analyses/[id].get.ts         Run status + change map + evidence spans
types/
  github.ts               PR metadata, changed file, patch hunk, check result
  analysis.ts             Artifact kind, run status, evidence span, change map
  report.ts               Report item, classification union, behavioral claim, citation
supabase/migrations/
  0001_init.sql           Schema for the slice tables
  0002_rls.sql            Row-level security: enable + owner-scoped policies
test/
  permalink.test.ts       buildPermalink / buildLineFragment
  parse-patch.test.ts     multi-hunk, add/del/context, no-newline-at-EOF
  map-lines.test.ts       head/base resolution + added runs
  classify-file.test.ts   representative JS/TS paths, lockfiles, migrations, generated
  change-map.test.ts      category counts + candidate associations (never proof of coverage)
  evidence-registry.test.ts  E-NNNNN stability/uniqueness + SHA + permalink
```

## Prerequisites

- Node.js 20 or newer (Node 22 recommended; use `nvm use 22`).
- npm (or another package manager) with access to the public npm registry.
- A Supabase project (URL, anon key, and service-role key).
- A read-only GitHub App (App id, private key, webhook secret, and public slug).
- An AI provider or gateway API key (used in a later milestone).

## Setup

1. Install dependencies (requires npm registry access):

   ```bash
   npm install
   ```

   The `postinstall` script runs `nuxt prepare`, which generates `.nuxt/tsconfig.json` (referenced by `tsconfig.json`).

2. Copy the example environment file and fill in real values:

   ```bash
   cp .env.example .env
   ```

3. Apply the database migrations to your Supabase project (see "Database migrations").

4. Start the dev server:

   ```bash
   npm run dev
   ```

## Environment variables

Nuxt maps environment variables onto `runtimeConfig`. `NUXT_*` variables are server-only; `NUXT_PUBLIC_*` variables are exposed to the browser. Never move a server-only secret into a `NUXT_PUBLIC_` variable.

### Server-only secrets (owned by the backend / deployment operator)

| Variable | Purpose |
|---|---|
| `NUXT_GITHUB_APP_ID` | GitHub App numeric id used to mint short-lived installation tokens server-side. |
| `NUXT_GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM). Never sent to the browser. |
| `NUXT_GITHUB_WEBHOOK_SECRET` | Secret used to verify GitHub webhook payloads. |
| `NUXT_SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key. Bypasses RLS; used only in `server/utils/supabase/admin.ts`. |
| `NUXT_AI_API_KEY` | AI provider or gateway API key. |
| `NUXT_AI_GATEWAY_BASE_URL` | Optional AI Gateway base URL. |

### Public values (safe for the browser)

| Variable | Purpose |
|---|---|
| `NUXT_PUBLIC_SUPABASE_URL` | Supabase project URL used by the browser anon client. |
| `NUXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key. Public by design; RLS enforces per-user access. |
| `NUXT_PUBLIC_APP_URL` | Public base URL of this app (used for auth redirects). |
| `NUXT_PUBLIC_GITHUB_APP_SLUG` | GitHub App slug used to build the public install URL. |

## Database migrations

The schema and row-level security policies live in `supabase/migrations/`:

- `0001_init.sql` creates the slice tables (profiles, github_installations, repositories, pull_requests, analysis_runs, artifacts, evidence_spans, report_items, report_item_evidence, check_results). No table stores a GitHub installation access token; short-lived tokens are minted server-side on demand and never persisted.
- `0002_rls.sql` enables row-level security on every table and adds owner-scoped policies. Users can read only their own installations; repositories and pull requests are reachable via an owned installation; analysis runs are scoped to `requested_by = auth.uid()`; and artifacts, evidence spans, report items, report-item evidence, and check results derive access from the owning analysis run. The service-role key bypasses RLS and is used only server-side.

Apply them with either the Supabase CLI or the SQL editor:

```bash
# Using the Supabase CLI (recommended)
supabase db push

# Or run each file in order in the Supabase SQL editor:
#   0001_init.sql then 0002_rls.sql
```

## Supabase client boundaries

There are three distinct Supabase clients, each with a clear trust boundary:

1. `server/utils/supabase/client.ts`: browser anon client. Runs in the browser, uses the public anon key, constrained by RLS.
2. `server/utils/supabase/server.ts`: per-request SSR client. Runs on the server, reads the request's auth cookies, uses the anon key, still constrained by RLS as the signed-in user.
3. `server/utils/supabase/admin.ts`: service-role client. Server-only, bypasses RLS. Must never be imported into client code; always perform ownership checks yourself when using it.

## AI boundary and citation validation (Milestone 5)

The behavioral-change pass (plan section 10, Pass B) turns registered evidence into a structured, cited claim. It is deliberately isolated so no AI provider code touches the deterministic pipeline or the browser bundle.

- **Provider isolation.** `server/utils/ai/provider.ts` is the ONLY module that imports an AI provider (`ai`, `@ai-sdk/openai`). It exposes a typed `BehaviorAnalyzer` interface; the default implementation calls the Vercel AI SDK `generateObject` constrained by a strict Zod schema, with the provider and key read from server-only `runtimeConfig` (`aiApiKey` / `aiGatewayBaseUrl`). Tests inject a fake analyzer, so the whole pipeline runs with no network. Never import from `server/utils/ai/*` in components or pages.
- **Trust boundary.** `server/utils/ai/prompts.ts` instructs the model to treat all repository/PR content as untrusted data (never instructions), to cite only the opaque evidence ids from the provided manifest, and never to invent file paths or line numbers.
- **Strict schema.** `server/utils/ai/schemas.ts` validates the pass output with `.strict()` so unknown/hallucinated fields are rejected. Classification is restricted to `observed` or `inferred`; confidence is bounded to `[0, 1]`.
- **Citation and provenance validation.** `server/utils/analysis/citation-validator.ts` (a pure function) enforces plan section 10: every cited id must exist in the run's registry and belong to the analyzed commit SHA; observed/inferred items require at least one valid evidence id; items with invalid or missing evidence are downgraded to `unknown` (or dropped) so they are never shown as facts.
- **Provenance persistence.** When the AI hook runs, it records `workflow_version` and `model_id` on the `analysis_runs` row and persists validated items into `report_items` with their citations in `report_item_evidence`. Report items are inserted as a single batch and the evidence joins are inserted afterward; if the join insert fails the items are rolled back, so a run that ends in the recoverable `failed` state never leaves partial report items behind. On provider failure or malformed output the run enters a recoverable `failed` state with `error_code`/`error_message` rather than crashing. When no model runs (no AI key configured, or the AI stage fails before recording provenance) the run keeps `model_id = 'deterministic-only'` as a deliberate sentinel meaning "only the deterministic phase produced output"; the report view surfaces run status and limitations so this is not mistaken for an AI-analyzed run.
- **Honest coverage.** The report view (`pages/reports/[id].vue`, `components/ReportItemCard.vue`, `components/EvidenceLink.vue`) shows the classification badge and confidence, links each cited span to a GitHub commit permalink at the immutable SHA, distinguishes observed from inferred, and shows an analysis-status/limitations area. Missing test evidence is described as "matching test evidence not found in analyzed context", never as "untested".

### Run lifecycle: idempotent ingestion and a documented synchronous deviation

- **Idempotent re-ingestion.** The run row is upserted on `(pull_request_id, workflow_version, model_id)`, so re-requesting the same logical run resolves to the same run id. Before re-ingesting, the orchestrator clears all run-scoped rows (`artifacts`, which cascades to `evidence_spans`; `report_items`, which cascades to `report_item_evidence`; and `check_results`) and rebuilds them from the immutable head SHA. Repeating a run therefore does not duplicate artifacts, evidence spans, report items, or check results (plan Milestone 3).
- **Normalized check results.** Fetched check runs are stored both as `check` artifacts (in the generic content-hash ledger) and as normalized rows in the dedicated `check_results` table that later milestones read for CI status, so the schema and the persistence path stay in sync.
- **Synchronous execution (intentional deviation for this slice).** The whole fetch/persist/AI pipeline runs synchronously inside `POST /api/analyses`, so the request blocks until the run reaches a terminal state. The plan describes an async run with status polling (`GET /api/analyses/:id` already exists for it). A later milestone should move the pipeline off the request path (queue/worker) so a large PR or a slow model does not tie up the request; the idempotent re-ingestion above already makes re-running a run safe under either model. This is called out in `server/utils/analysis/orchestrator.ts`.

### Live validation still required

The following require a registry-enabled and network-enabled environment and could not be exercised in the authoring sandbox:

1. Apply migrations: `supabase db push` (or run `0001_init.sql` then `0002_rls.sql`).
2. Set env: copy `.env.example` to `.env` and fill values, including `NUXT_AI_API_KEY` (and optional `NUXT_AI_GATEWAY_BASE_URL`).
3. Install and test: `unset NODE_OPTIONS && npm install && npm run test`.
4. Build: `npm run build`.
5. Run the slice end-to-end against a real JS/TS pull request (real GitHub App + AI provider + Supabase) and confirm the report renders a cited behavioral claim whose permalink resolves to the exact evidenced lines.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Nuxt dev server. |
| `npm run build` | Build for production (`nuxt build`). |
| `npm run generate` | Static generation (`nuxt generate`). |
| `npm run preview` | Preview a production build. |
| `npm run test` | Run unit tests once (`vitest run`). |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run typecheck` | Type-check with `nuxt typecheck`. |

## Security posture

- Secrets (GitHub App private key, Supabase service-role key, AI key) live only in server-only `runtimeConfig` and never in `runtimeConfig.public`.
- GitHub integration is read-only. Installation access tokens are never persisted; they are minted server-side and short-lived.
- Row-level security is enabled on every table so users cannot read one another's installations, analyses, or private repository content.
- All repository content (PR text, patches, commit messages, file contents) is treated as untrusted data at the AI boundary; it is never treated as instructions.

## Dependency versions

Dependency versions in `package.json` are pinned to reasonable recent ranges. Exact versions may need small adjustments at install time depending on registry availability and peer-dependency resolution.

## Sandbox limitations

This project was authored in a sandbox with network mode `INTEGRATIONS_ONLY`. In that environment the npm registry returns HTTP 403 and there is no offline package cache, so the following could NOT be run during authoring and MUST be validated in an environment with npm registry access:

- `npm install` (no packages could be fetched).
- `nuxt prepare` / `nuxt build` (require installed dependencies).
- `vitest` (requires installed dependencies).
- Real Supabase, GitHub App, and AI provider network calls (no external network beyond the connected GitHub gateway).

Every file here is hand-written so the project is complete and runnable once dependencies are installed in a registry-enabled environment. Please run `npm install`, `npm run build`, and `npm run test` there to complete verification.
