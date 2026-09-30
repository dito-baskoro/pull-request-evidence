-- Add dedicated provenance columns to analysis_runs so the AI hook can record
-- the resolved model id and workflow version WITHOUT touching the idempotency
-- key columns (pull_request_id, workflow_version, model_id).
--
-- Background: the hook in server/utils/ai/behavior-hook.ts previously called
-- UPDATE SET workflow_version = ..., model_id = ... on the run row. Because
-- those two columns are part of the unique constraint
-- (pull_request_id, workflow_version, model_id), the UPDATE was re-evaluated
-- against the index and raised:
--   "duplicate key value violates unique constraint
--    analysis_runs_pull_request_id_workflow_version_model_id_key"
-- whenever a prior run for the same PR already existed with the resolved values.
--
-- The key columns now remain immutable after INSERT (they are the idempotency
-- key). Provenance is written to the new columns below.

alter table public.analysis_runs
  add column if not exists resolved_workflow_version text,
  add column if not exists resolved_model_id         text;
