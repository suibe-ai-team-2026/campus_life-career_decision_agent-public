-- Fix PL/pgSQL ambiguity between RETURNS TABLE output columns (run_id/plan_id/version)
-- and table columns in worker_claim_job / worker_save_plan. Same signatures, new bodies.
set search_path = public, extensions;

create or replace function public.worker_claim_job(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns table (
  job_id uuid,
  run_id uuid,
  owner_id uuid,
  kind text,
  input jsonb,
  profile_version integer,
  attempts integer,
  max_attempts integer,
  lease_epoch bigint
)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
  v_run public.app_runs%rowtype;
  v_tries integer := 0;
begin
  -- Lease recovery: dead-letter runs whose attempts are exhausted, requeue the rest.
  insert into public.app_run_events (run_id, seq, event_type, safe_payload)
  select j.run_id,
         coalesce((select max(seq) from public.app_run_events e where e.run_id = j.run_id), 0) + 1,
         'failed',
         jsonb_build_object('code', 'lease_expired')
  from app_private.jobs j
  join public.app_runs r on r.run_id = j.run_id
  where j.status = 'running' and j.lease_until < now() and j.attempts >= j.max_attempts
    and r.status not in ('succeeded', 'failed', 'cancelled');

  update public.app_runs r
     set status = 'failed', error_code = 'lease_expired', finished_at = now()
  from app_private.jobs j
  where j.run_id = r.run_id and j.status = 'running' and j.lease_until < now()
    and j.attempts >= j.max_attempts and r.status not in ('succeeded', 'failed', 'cancelled');

  update app_private.jobs j
     set status = 'dead', lease_until = null, updated_at = now()
  where j.status = 'running' and j.lease_until < now() and j.attempts >= j.max_attempts;

  update app_private.jobs j
     set status = 'queued',
         available_at = now() + make_interval(secs => least(300, 5 * power(2, least(j.attempts, 4)))),
         lease_until = null,
         worker_id = null,
         updated_at = now()
  where j.status = 'running' and j.lease_until < now() and j.attempts < j.max_attempts;

  update public.app_runs r
     set status = 'queued'
  from app_private.jobs j
  where j.run_id = r.run_id and j.status = 'queued' and r.status in ('running', 'cancel_requested') and not r.cancel_requested;

  loop
    v_tries := v_tries + 1;
    exit when v_tries > 10;

    select * into v_job
    from app_private.jobs
    where status = 'queued' and available_at <= now()
    order by priority asc, created_at asc
    for update skip locked
    limit 1;

    exit when not found;

    select * into v_run from public.app_runs r where r.run_id = v_job.run_id;
    if v_run.status in ('cancelled', 'failed', 'succeeded') or v_run.cancel_requested then
      update app_private.jobs
         set status = case when v_run.status = 'cancelled' or v_run.cancel_requested then 'cancelled' else 'failed' end,
             updated_at = now()
       where job_id = v_job.job_id;
      continue;
    end if;

    update app_private.jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           lease_epoch = j.lease_epoch + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           worker_id = p_worker_id,
           updated_at = now()
     where j.job_id = v_job.job_id
     returning * into v_job;

    update public.app_runs r
       set status = 'running', started_at = coalesce(r.started_at, now()), progress = greatest(r.progress, 5)
     where r.run_id = v_job.run_id;

    insert into public.app_run_events (run_id, seq, event_type, safe_payload)
    values (v_job.run_id,
            coalesce((select max(e.seq) from public.app_run_events e where e.run_id = v_job.run_id), 0) + 1,
            'running',
            jsonb_build_object('attempt', v_job.attempts));

    return query select v_job.job_id, v_job.run_id, v_run.owner_id, v_run.kind, v_run.input,
                        v_run.profile_version, v_job.attempts, v_job.max_attempts, v_job.lease_epoch;
    return;
  end loop;
end;
$$;

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

  insert into public.app_plan_versions (
    plan_id, version, profile_version, rules_version, corpus_version, embedding_profile_id,
    actions, user_overrides, warnings, status, result
  ) values (
    v_plan.plan_id, v_next, v_run.profile_version, p_rules_version, p_corpus_version, p_embedding_profile_id,
    coalesce(p_actions, '[]'::jsonb), '{}'::jsonb, coalesce(p_warnings, '[]'::jsonb), 'active', p_result
  ) returning version_id into v_version_id;

  update public.app_plans p set current_version_id = v_version_id where p.plan_id = v_plan.plan_id;

  return query select v_plan.plan_id, v_version_id, v_next;
end;
$$;

revoke all on function public.worker_claim_job(text, integer) from public, anon, authenticated;
revoke all on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.worker_claim_job(text, integer) to service_role;
grant execute on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
