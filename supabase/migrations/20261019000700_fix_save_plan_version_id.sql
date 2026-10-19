-- Fix "column reference version_id is ambiguous" in worker_save_plan: RETURNING
-- cannot be used when the function also has a RETURNS TABLE output column named
-- version_id. Generate the UUID explicitly instead.
set search_path = public, extensions;

create or replace function public.worker_save_plan(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_plan_id uuid,
  p_profile_id uuid,
  p_direction_id text,
  p_rules_version text,
  p_corpus_version text,
  p_embedding_profile_id text,
  p_actions jsonb,
  p_result jsonb,
  p_warnings jsonb
) returns table (plan_id uuid, version_id uuid, version integer)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
  v_run public.app_runs%rowtype;
  v_plan public.app_plans%rowtype;
  v_next integer;
  v_version_id uuid;
begin
  select * into v_job from app_private.jobs
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch and status = 'running'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'stale_lease';
  end if;

  select * into v_run from public.app_runs r where r.run_id = v_job.run_id;
  if v_run.kind <> 'plan' then
    raise exception using errcode = 'P0001', message = 'bad_request';
  end if;

  if not exists (select 1 from public.app_profiles p where p.profile_id = p_profile_id and p.owner_id = v_run.owner_id) then
    raise exception using errcode = 'P0001', message = 'resource_not_found';
  end if;

  if p_plan_id is null then
    insert into public.app_plans (owner_id, profile_id, direction_id)
    values (v_run.owner_id, p_profile_id, p_direction_id)
    returning * into v_plan;
  else
    select * into v_plan from public.app_plans p
     where p.plan_id = p_plan_id and p.owner_id = v_run.owner_id and p.profile_id = p_profile_id
     for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'resource_not_found';
    end if;
    if v_plan.direction_id <> p_direction_id then
      raise exception using errcode = 'P0001', message = 'version_conflict';
    end if;
  end if;

  select coalesce(max(pv.version), 0) + 1 into v_next from public.app_plan_versions pv where pv.plan_id = v_plan.plan_id;

  update public.app_plan_versions pv set status = 'stale' where pv.plan_id = v_plan.plan_id and pv.status = 'active';

  v_version_id := gen_random_uuid();
  insert into public.app_plan_versions (
    version_id, plan_id, version, profile_version, rules_version, corpus_version, embedding_profile_id,
    actions, user_overrides, warnings, status, result
  ) values (
    v_version_id, v_plan.plan_id, v_next, v_run.profile_version, p_rules_version, p_corpus_version, p_embedding_profile_id,
    coalesce(p_actions, '[]'::jsonb), '{}'::jsonb, coalesce(p_warnings, '[]'::jsonb), 'active', p_result
  );

  update public.app_plans p set current_version_id = v_version_id where p.plan_id = v_plan.plan_id;

  return query select v_plan.plan_id, v_version_id, v_next;
end;
$$;
revoke all on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
