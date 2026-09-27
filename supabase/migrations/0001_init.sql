-- PR Evidence Pack: initial schema (plan section 7).
--
-- Scope: the tables needed by the first implementation slice (section 18):
-- profiles, github_installations, repositories, pull_requests, analysis_runs,
-- artifacts, evidence_spans, report_items, report_item_evidence, check_results.
--
-- IMPORTANT: no table stores a GitHub installation access token. Short-lived
-- tokens are minted server-side on demand and never persisted (section 7/8).
--
-- Row-level security is enabled and policed in 0002_rls.sql.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per Supabase auth user.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- github_installations: connected read-only GitHub App installations.
-- No access token column by design.
-- ---------------------------------------------------------------------------
create table if not exists public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  github_installation_id bigint not null,
  account_login text not null,
  account_type text not null,
  created_at timestamptz not null default now(),
  unique (user_id, github_installation_id)
);

create index if not exists github_installations_user_id_idx
  on public.github_installations (user_id);

-- ---------------------------------------------------------------------------
-- repositories: repos reachable through an installation.
-- ---------------------------------------------------------------------------
create table if not exists public.repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.github_installations (id) on delete cascade,
  github_repository_id bigint not null,
  owner text not null,
  name text not null,
  default_branch text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  -- Idempotency: a repo is unique per installation (plan section 7).
  unique (github_repository_id, installation_id)
);

create index if not exists repositories_installation_id_idx
  on public.repositories (installation_id);

-- ---------------------------------------------------------------------------
-- pull_requests: an immutable-at-a-SHA view of a PR.
-- A new head SHA yields a new row rather than replacing prior evidence.
-- ---------------------------------------------------------------------------
create table if not exists public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,
  github_number integer not null,
  title text not null,
  body text,
  author_login text,
  base_sha text not null,
  head_sha text not null,
  state text not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  -- Idempotency: (repo, number, head_sha) is unique (plan section 7).
  unique (repository_id, github_number, head_sha)
);

create index if not exists pull_requests_repository_id_idx
  on public.pull_requests (repository_id);

-- ---------------------------------------------------------------------------
-- analysis_runs: one analysis of one PR at an immutable head SHA.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  pull_request_id uuid not null references public.pull_requests (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','ingesting','deterministic','ai','validating','complete','failed')),
  workflow_version text not null,
  model_id text not null,
  coverage_status text
    check (coverage_status is null or coverage_status in ('complete','partial','rejected')),
  coverage_notes jsonb,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Idempotency key (plan section 7).
  unique (pull_request_id, workflow_version, model_id)
);

create index if not exists analysis_runs_pull_request_id_idx
  on public.analysis_runs (pull_request_id);
create index if not exists analysis_runs_requested_by_idx
  on public.analysis_runs (requested_by);

-- ---------------------------------------------------------------------------
-- artifacts: normalized PR-level sources for a run.
-- ---------------------------------------------------------------------------
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs (id) on delete cascade,
  kind text not null
    check (kind in ('pr_body','issue','commit','file','patch','check')),
  external_id text,
  commit_sha text,
  file_path text,
  content text,
  content_hash text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists artifacts_analysis_run_id_idx
  on public.artifacts (analysis_run_id);

-- ---------------------------------------------------------------------------
-- evidence_spans: opaque, immutable source spans registered before AI calls.
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_spans (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  evidence_key text not null,
  source_type text not null,
  commit_sha text not null,
  file_path text,
  side text not null check (side in ('base','head','metadata')),
  start_line integer,
  end_line integer,
  excerpt text not null,
  excerpt_hash text not null,
  permalink text,
  created_at timestamptz not null default now()
);

create index if not exists evidence_spans_artifact_id_idx
  on public.evidence_spans (artifact_id);

-- ---------------------------------------------------------------------------
-- report_items: cited report cards.
-- ---------------------------------------------------------------------------
create table if not exists public.report_items (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs (id) on delete cascade,
  section text not null,
  classification text not null
    check (classification in ('observed','inferred','potential_risk','unknown','question')),
  title text not null,
  statement text not null,
  severity text,
  confidence numeric,
  sort_order integer not null default 0,
  validation_status text not null default 'pending'
    check (validation_status in ('pending','valid','downgraded','rejected')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists report_items_analysis_run_id_idx
  on public.report_items (analysis_run_id);

-- ---------------------------------------------------------------------------
-- report_item_evidence: join between report items and evidence spans.
-- ---------------------------------------------------------------------------
create table if not exists public.report_item_evidence (
  report_item_id uuid not null references public.report_items (id) on delete cascade,
  evidence_span_id uuid not null references public.evidence_spans (id) on delete cascade,
  support_type text not null default 'supports'
    check (support_type in ('supports','contextualizes','contradicts')),
  primary key (report_item_id, evidence_span_id)
);

-- ---------------------------------------------------------------------------
-- check_results: normalized CI check runs for the head SHA.
-- ---------------------------------------------------------------------------
create table if not exists public.check_results (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs (id) on delete cascade,
  github_check_run_id bigint not null,
  name text not null,
  status text not null,
  conclusion text,
  details_url text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists check_results_analysis_run_id_idx
  on public.check_results (analysis_run_id);
