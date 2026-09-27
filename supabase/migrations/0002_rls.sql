-- PR Evidence Pack: row-level security (plan section 7).
--
-- Ownership model:
--   * A user owns github_installations where user_id = auth.uid().
--   * repositories / pull_requests are reachable via an owned installation.
--   * analysis_runs are owned by requested_by = auth.uid().
--   * artifacts / evidence_spans / report_items / report_item_evidence /
--     check_results derive access from the owning analysis_run's requested_by.
--
-- The service-role key bypasses RLS and is used ONLY server-side
-- (server/utils/supabase/admin.ts). Browser code uses the anon key and is
-- constrained by these policies.

-- ---------------------------------------------------------------------------
-- Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.github_installations enable row level security;
alter table public.repositories enable row level security;
alter table public.pull_requests enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.artifacts enable row level security;
alter table public.evidence_spans enable row level security;
alter table public.report_items enable row level security;
alter table public.report_item_evidence enable row level security;
alter table public.check_results enable row level security;

-- ---------------------------------------------------------------------------
-- Helper predicates are expressed inline via EXISTS subqueries so that the
-- policies remain self-contained and readable.
-- ---------------------------------------------------------------------------

-- profiles: a user sees and manages only their own profile row.
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- github_installations: owner-scoped full access.
create policy installations_select_own on public.github_installations
  for select using (user_id = auth.uid());
create policy installations_insert_own on public.github_installations
  for insert with check (user_id = auth.uid());
create policy installations_update_own on public.github_installations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy installations_delete_own on public.github_installations
  for delete using (user_id = auth.uid());

-- repositories: readable/writable via an owned installation.
create policy repositories_select_via_installation on public.repositories
  for select using (
    exists (
      select 1 from public.github_installations gi
      where gi.id = repositories.installation_id
        and gi.user_id = auth.uid()
    )
  );
create policy repositories_insert_via_installation on public.repositories
  for insert with check (
    exists (
      select 1 from public.github_installations gi
      where gi.id = repositories.installation_id
        and gi.user_id = auth.uid()
    )
  );

-- pull_requests: readable/writable via an owned installation's repository.
create policy pull_requests_select_via_installation on public.pull_requests
  for select using (
    exists (
      select 1
      from public.repositories r
      join public.github_installations gi on gi.id = r.installation_id
      where r.id = pull_requests.repository_id
        and gi.user_id = auth.uid()
    )
  );
create policy pull_requests_insert_via_installation on public.pull_requests
  for insert with check (
    exists (
      select 1
      from public.repositories r
      join public.github_installations gi on gi.id = r.installation_id
      where r.id = pull_requests.repository_id
        and gi.user_id = auth.uid()
    )
  );

-- analysis_runs: create + read by the requester.
create policy analysis_runs_select_own on public.analysis_runs
  for select using (requested_by = auth.uid());
create policy analysis_runs_insert_own on public.analysis_runs
  for insert with check (requested_by = auth.uid());
create policy analysis_runs_update_own on public.analysis_runs
  for update using (requested_by = auth.uid()) with check (requested_by = auth.uid());

-- artifacts: access derived from the owning analysis_run.
create policy artifacts_select_via_run on public.artifacts
  for select using (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = artifacts.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );
create policy artifacts_insert_via_run on public.artifacts
  for insert with check (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = artifacts.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );

-- evidence_spans: access derived from the artifact's owning analysis_run.
create policy evidence_spans_select_via_run on public.evidence_spans
  for select using (
    exists (
      select 1
      from public.artifacts a
      join public.analysis_runs ar on ar.id = a.analysis_run_id
      where a.id = evidence_spans.artifact_id
        and ar.requested_by = auth.uid()
    )
  );
create policy evidence_spans_insert_via_run on public.evidence_spans
  for insert with check (
    exists (
      select 1
      from public.artifacts a
      join public.analysis_runs ar on ar.id = a.analysis_run_id
      where a.id = evidence_spans.artifact_id
        and ar.requested_by = auth.uid()
    )
  );

-- report_items: access derived from the owning analysis_run.
create policy report_items_select_via_run on public.report_items
  for select using (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = report_items.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );
create policy report_items_insert_via_run on public.report_items
  for insert with check (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = report_items.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );

-- report_item_evidence: access derived from the report item's analysis_run.
create policy report_item_evidence_select_via_run on public.report_item_evidence
  for select using (
    exists (
      select 1
      from public.report_items ri
      join public.analysis_runs ar on ar.id = ri.analysis_run_id
      where ri.id = report_item_evidence.report_item_id
        and ar.requested_by = auth.uid()
    )
  );
create policy report_item_evidence_insert_via_run on public.report_item_evidence
  for insert with check (
    exists (
      select 1
      from public.report_items ri
      join public.analysis_runs ar on ar.id = ri.analysis_run_id
      where ri.id = report_item_evidence.report_item_id
        and ar.requested_by = auth.uid()
    )
  );

-- check_results: access derived from the owning analysis_run.
create policy check_results_select_via_run on public.check_results
  for select using (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = check_results.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );
create policy check_results_insert_via_run on public.check_results
  for insert with check (
    exists (
      select 1 from public.analysis_runs ar
      where ar.id = check_results.analysis_run_id
        and ar.requested_by = auth.uid()
    )
  );
