-- RLS: every browser-reachable table is owner-scoped or explicitly shared.
-- verification_status (quality) and visibility (permission) are separate columns.

alter table public.app_sources enable row level security;
alter table public.app_source_versions enable row level security;
alter table public.app_evidence_records enable row level security;
alter table public.app_source_aliases enable row level security;
alter table public.app_chunks enable row level security;
alter table public.app_embedding_profiles enable row level security;
alter table public.app_chunk_embeddings enable row level security;
alter table public.app_import_batches enable row level security;
alter table public.app_directions enable row level security;
alter table public.app_assessments enable row level security;
alter table public.app_profiles enable row level security;
alter table public.app_plans enable row level security;
alter table public.app_plan_versions enable row level security;
alter table public.app_courses enable row level security;
alter table public.app_prerequisites enable row level security;
alter table public.app_competitions enable row level security;
alter table public.app_credit_rules enable row level security;
alter table public.app_direction_requirements enable row level security;
alter table public.app_requirement_actions enable row level security;
alter table public.app_runs enable row level security;
alter table public.app_run_results enable row level security;
alter table public.app_run_events enable row level security;
alter table public.app_artifacts enable row level security;
alter table public.app_usage enable row level security;

-- Public catalog: the first four wizard steps must work before any account exists.
create policy app_directions_public_read on public.app_directions
  for select to anon, authenticated using (true);

create policy app_assessments_public_read on public.app_assessments
  for select to anon, authenticated using (true);

create policy app_embedding_profiles_read on public.app_embedding_profiles
  for select to authenticated using (true);

-- Shared reference corpus: only approved_reference sources, plus the caller's own private files.
create policy app_sources_read on public.app_sources
  for select to authenticated
  using (visibility = 'approved_reference' or owner_id = (select auth.uid()));

create policy app_source_versions_read on public.app_source_versions
  for select to authenticated
  using (visibility = 'approved_reference' or owner_id = (select auth.uid()));

create policy app_evidence_records_read on public.app_evidence_records
  for select to authenticated
  using (
    exists (
      select 1 from public.app_source_versions v
      where v.source_version_id = app_evidence_records.source_version_id
        and (v.visibility = 'approved_reference' or v.owner_id = (select auth.uid()))
    )
  );

create policy app_chunks_read on public.app_chunks
  for select to authenticated
  using (visibility = 'approved_reference' or owner_id = (select auth.uid()));

-- Rules reference data is shared read-only after human review.
create policy app_courses_read on public.app_courses for select to authenticated using (true);
create policy app_prerequisites_read on public.app_prerequisites for select to authenticated using (true);
create policy app_competitions_read on public.app_competitions for select to authenticated using (true);
create policy app_credit_rules_read on public.app_credit_rules for select to authenticated using (true);
create policy app_direction_requirements_read on public.app_direction_requirements for select to authenticated using (true);
create policy app_requirement_actions_read on public.app_requirement_actions for select to authenticated using (true);

-- Profiles: owner only, including INSERT/UPDATE checks.
create policy app_profiles_select on public.app_profiles
  for select to authenticated using (owner_id = (select auth.uid()));
create policy app_profiles_insert on public.app_profiles
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy app_profiles_update on public.app_profiles
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy app_profiles_delete on public.app_profiles
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Plans: owner only; the profile used must belong to the same owner.
create policy app_plans_select on public.app_plans
  for select to authenticated using (owner_id = (select auth.uid()));
create policy app_plans_insert on public.app_plans
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.app_profiles p
      where p.profile_id = app_plans.profile_id and p.owner_id = (select auth.uid())
    )
  );
create policy app_plans_update on public.app_plans
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy app_plans_delete on public.app_plans
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Plan versions inherit ownership from the parent plan; a child owner_id is not trusted.
create policy app_plan_versions_select on public.app_plan_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.app_plans p
      where p.plan_id = app_plan_versions.plan_id and p.owner_id = (select auth.uid())
    )
  );
create policy app_plan_versions_insert on public.app_plan_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.app_plans p
      where p.plan_id = app_plan_versions.plan_id and p.owner_id = (select auth.uid())
    )
  );
create policy app_plan_versions_update on public.app_plan_versions
  for update to authenticated
  using (
    exists (
      select 1 from public.app_plans p
      where p.plan_id = app_plan_versions.plan_id and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.app_plans p
      where p.plan_id = app_plan_versions.plan_id and p.owner_id = (select auth.uid())
    )
  );

-- Runs: users can only read their own; writes go through SECURITY DEFINER functions.
create policy app_runs_select on public.app_runs
  for select to authenticated using (owner_id = (select auth.uid()));

create policy app_run_results_select on public.app_run_results
  for select to authenticated
  using (exists (select 1 from public.app_runs r where r.run_id = app_run_results.run_id and r.owner_id = (select auth.uid())));

create policy app_run_events_select on public.app_run_events
  for select to authenticated
  using (exists (select 1 from public.app_runs r where r.run_id = app_run_events.run_id and r.owner_id = (select auth.uid())));

create policy app_artifacts_select on public.app_artifacts
  for select to authenticated using (owner_id = (select auth.uid()));

create policy app_usage_select on public.app_usage
  for select to authenticated using (owner_id = (select auth.uid()));

-- No policies on purpose: embeddings, aliases, import batches are worker/ops-only.
-- service_role bypasses RLS; anonymous users have no direct table access.
