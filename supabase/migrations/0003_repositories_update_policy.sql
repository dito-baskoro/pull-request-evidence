-- Add the missing UPDATE policy on public.repositories.
--
-- 0002_rls.sql created SELECT and INSERT policies for repositories but no
-- UPDATE policy. An upsert (INSERT ... ON CONFLICT DO UPDATE) needs UPDATE
-- privileges on the conflict path; without a policy, that path is rejected with
-- "new row violates row-level security policy (USING expression) for table
-- repositories". The route now performs the write with the service-role client
-- (which bypasses RLS) after an explicit ownership check, but this policy is
-- added as defense in depth so any RLS-scoped update is still owner-checked and
-- the table's policy set is complete and consistent with the other tables.

create policy repositories_update_via_installation on public.repositories
  for update
  using (
    exists (
      select 1 from public.github_installations gi
      where gi.id = repositories.installation_id
        and gi.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.github_installations gi
      where gi.id = repositories.installation_id
        and gi.user_id = auth.uid()
    )
  );
