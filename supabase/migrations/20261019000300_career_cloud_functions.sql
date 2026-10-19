-- SECURITY DEFINER functions. User-callable functions derive identity from auth.uid();
-- worker functions are granted to service_role only and fence on (worker_id, lease_epoch).
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- User-facing run submission / cancellation
-- ---------------------------------------------------------------------------

create or replace function public.app_submit_run(
  p_kind text,
  p_idempotency_key uuid,
  p_input jsonb,
  p_input_hash text,
  p_profile_version integer default null
) returns setof public.app_runs
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.app_runs%rowtype;
  v_run public.app_runs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;
  if p_kind not in ('assessment_explain', 'compare', 'plan', 'ask', 'export') then
    raise exception using errcode = 'P0001', message = 'bad_request';
  end if;

  select * into v_existing
  from public.app_runs
  where owner_id = v_uid and kind = p_kind and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.input_hash <> p_input_hash then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return next v_existing;
    return;
  end if;

  insert into public.app_runs (owner_id, kind, input, input_hash, idempotency_key, profile_version)
  values (v_uid, p_kind, p_input, p_input_hash, p_idempotency_key, p_profile_version)
  on conflict (owner_id, kind, idempotency_key) do nothing
  returning * into v_run;

  if v_run.run_id is null then
    select * into v_existing
    from public.app_runs
    where owner_id = v_uid and kind = p_kind and idempotency_key = p_idempotency_key;
    if v_existing.input_hash <> p_input_hash then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return next v_existing;
    return;
  end if;

  return next v_run;
end;
$$;

create or replace function public.app_cancel_run(p_run_id uuid)
returns setof public.app_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run public.app_runs%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;
  select * into v_run from public.app_runs where run_id = p_run_id and owner_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'resource_not_found';
  end if;
  if v_run.status not in ('succeeded', 'failed', 'cancelled') then
    update public.app_runs
       set cancel_requested = true,
           status = case when status = 'queued' then 'cancelled' else 'cancel_requested' end,
           finished_at = case when status = 'queued' then now() else finished_at end
     where run_id = p_run_id
     returning * into v_run;
    insert into public.app_run_events (run_id, seq, event_type, safe_payload)
    values (p_run_id, coalesce((select max(seq) from public.app_run_events where run_id = p_run_id), 0) + 1, 'cancel_requested', '{}'::jsonb);
    update app_private.jobs
       set status = case when status = 'queued' then 'cancelled' else status end,
           updated_at = now()
     where run_id = p_run_id and status = 'queued';
  end if;
  return next v_run;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: one transaction creates both the run and its durable job
-- ---------------------------------------------------------------------------

create or replace function app_private.enqueue_run_job()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into app_private.jobs (run_id, max_attempts)
  values (new.run_id, 3)
  on conflict (run_id) do nothing;

  insert into public.app_run_events (run_id, seq, event_type, safe_payload)
  values (new.run_id, 1, 'queued', '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists app_runs_enqueue_job on public.app_runs;
create trigger app_runs_enqueue_job
after insert on public.app_runs
for each row execute function app_private.enqueue_run_job();

-- ---------------------------------------------------------------------------
-- Worker queue: claim / heartbeat / progress / complete / fail (fenced)
-- ---------------------------------------------------------------------------

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

    select * into v_run from public.app_runs where run_id = v_job.run_id;
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

    update public.app_runs
       set status = 'running', started_at = coalesce(started_at, now()), progress = greatest(progress, 5)
     where run_id = v_job.run_id;

    insert into public.app_run_events (run_id, seq, event_type, safe_payload)
    values (v_job.run_id,
            coalesce((select max(seq) from public.app_run_events where run_id = v_job.run_id), 0) + 1,
            'running',
            jsonb_build_object('attempt', v_job.attempts));

    return query select v_job.job_id, v_job.run_id, v_run.owner_id, v_run.kind, v_run.input,
                        v_run.profile_version, v_job.attempts, v_job.max_attempts, v_job.lease_epoch;
    return;
  end loop;
end;
$$;

create or replace function public.worker_heartbeat(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_lease_seconds integer default 120
) returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  update app_private.jobs
     set lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch
     and status = 'running';
  return found;
end;
$$;

create or replace function public.worker_set_progress(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_status text,
  p_progress integer
) returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
begin
  select * into v_job from app_private.jobs
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch and status = 'running'
   for update;
  if not found then return false; end if;

  if p_status not in ('running', 'parsing', 'embedding', 'retrieving', 'planning', 'rendering', 'validating') then
    raise exception using errcode = 'P0001', message = 'bad_request';
  end if;

  update public.app_runs
     set status = p_status, progress = greatest(progress, least(99, greatest(0, p_progress)))
   where run_id = v_job.run_id and status not in ('succeeded', 'failed', 'cancelled');

  insert into public.app_run_events (run_id, seq, event_type, safe_payload)
  values (v_job.run_id,
          coalesce((select max(seq) from public.app_run_events where run_id = v_job.run_id), 0) + 1,
          p_status,
          jsonb_build_object('progress', p_progress));

  update app_private.jobs set lease_until = now() + interval '120 seconds', updated_at = now() where job_id = p_job_id;
  return true;
end;
$$;

create or replace function public.worker_complete_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_result jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
  v_run public.app_runs%rowtype;
begin
  select * into v_job from app_private.jobs
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch and status = 'running'
   for update;
  if not found then return null; end if;

  select * into v_run from public.app_runs where run_id = v_job.run_id for update;

  insert into public.app_run_results (run_id, payload) values (v_run.run_id, p_result)
  on conflict (run_id) do update set payload = excluded.payload, created_at = now();

  update public.app_runs
     set status = 'succeeded', progress = 100, result_ref = v_run.run_id, finished_at = now(), error_code = null
   where run_id = v_run.run_id;

  update app_private.jobs
     set status = 'succeeded', lease_until = null, updated_at = now()
   where job_id = p_job_id;

  insert into public.app_run_events (run_id, seq, event_type, safe_payload)
  values (v_run.run_id,
          coalesce((select max(seq) from public.app_run_events where run_id = v_run.run_id), 0) + 1,
          'succeeded', '{}'::jsonb);

  return v_run.run_id;
end;
$$;

create or replace function public.worker_fail_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_error_code text,
  p_retryable boolean
) returns text
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
  v_run public.app_runs%rowtype;
  v_retry boolean;
begin
  select * into v_job from app_private.jobs
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch and status = 'running'
   for update;
  if not found then return 'stale'; end if;

  select * into v_run from public.app_runs where run_id = v_job.run_id for update;
  v_retry := p_retryable and v_job.attempts < v_job.max_attempts and not v_run.cancel_requested;

  insert into public.app_run_events (run_id, seq, event_type, safe_payload)
  values (v_run.run_id,
          coalesce((select max(seq) from public.app_run_events where run_id = v_run.run_id), 0) + 1,
          case when v_retry then 'running' else 'failed' end,
          jsonb_build_object('code', p_error_code, 'retry', v_retry));

  if v_retry then
    update app_private.jobs
       set status = 'queued',
           available_at = now() + make_interval(secs => least(300, 5 * power(2, least(v_job.attempts, 4)))),
           lease_until = null,
           worker_id = null,
           updated_at = now()
     where job_id = p_job_id;
    update public.app_runs set status = 'queued', progress = 0 where run_id = v_run.run_id;
    return 'retry';
  end if;

  update app_private.jobs
     set status = case when v_run.cancel_requested then 'cancelled' else 'failed' end,
         lease_until = null, updated_at = now()
   where job_id = p_job_id;

  update public.app_runs
     set status = case when v_run.cancel_requested then 'cancelled' else 'failed' end,
         error_code = case when v_run.cancel_requested then null else p_error_code end,
         finished_at = now()
   where run_id = v_run.run_id;

  return case when v_run.cancel_requested then 'cancelled' else 'failed' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker result publication (fenced): plans and artifacts cannot be written by
-- a worker whose lease was revoked.
-- ---------------------------------------------------------------------------

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

  select * into v_run from public.app_runs where run_id = v_job.run_id;
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
    select * into v_plan from public.app_plans
     where plan_id = p_plan_id and owner_id = v_run.owner_id and profile_id = p_profile_id
     for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'resource_not_found';
    end if;
    if v_plan.direction_id <> p_direction_id then
      raise exception using errcode = 'P0001', message = 'version_conflict';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_next from public.app_plan_versions where plan_id = v_plan.plan_id;

  update public.app_plan_versions set status = 'stale' where plan_id = v_plan.plan_id and status = 'active';

  insert into public.app_plan_versions (
    plan_id, version, profile_version, rules_version, corpus_version, embedding_profile_id,
    actions, user_overrides, warnings, status, result
  ) values (
    v_plan.plan_id, v_next, v_run.profile_version, p_rules_version, p_corpus_version, p_embedding_profile_id,
    coalesce(p_actions, '[]'::jsonb), '{}'::jsonb, coalesce(p_warnings, '[]'::jsonb), 'active', p_result
  ) returning version_id into v_version_id;

  update public.app_plans set current_version_id = v_version_id where plan_id = v_plan.plan_id;

  return query select v_plan.plan_id, v_version_id, v_next;
end;
$$;

create or replace function public.worker_register_artifact(
  p_job_id uuid,
  p_worker_id text,
  p_lease_epoch bigint,
  p_artifact_id uuid,
  p_kind text,
  p_storage_path text,
  p_sha256 text,
  p_bytes bigint,
  p_plan_version_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_job app_private.jobs%rowtype;
  v_run public.app_runs%rowtype;
begin
  select * into v_job from app_private.jobs
   where job_id = p_job_id and worker_id = p_worker_id and lease_epoch = p_lease_epoch and status = 'running'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'stale_lease';
  end if;
  select * into v_run from public.app_runs where run_id = v_job.run_id;

  if p_plan_version_id is not null and not exists (
    select 1 from public.app_plan_versions pv
    join public.app_plans p on p.plan_id = pv.plan_id
    where pv.version_id = p_plan_version_id and p.owner_id = v_run.owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'resource_not_found';
  end if;

  insert into public.app_artifacts (artifact_id, owner_id, run_id, plan_version_id, kind, storage_path, sha256, bytes, expires_at)
  values (p_artifact_id, v_run.owner_id, v_run.run_id, p_plan_version_id, p_kind, p_storage_path, p_sha256, p_bytes, now() + interval '7 days')
  on conflict (artifact_id) do nothing;

  return p_artifact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Authorised retrieval: permission filtering happens inside the candidate query.
-- ---------------------------------------------------------------------------

create or replace function public.worker_search_chunks(
  p_owner uuid,
  p_profile_id text,
  p_query_embedding text,
  p_query_text text,
  p_limit integer default 48
) returns table (
  branch text,
  chunk_id uuid,
  source_version_id uuid,
  source_id text,
  title text,
  publisher text,
  canonical_url text,
  verification_status text,
  source_scope text,
  owner_id uuid,
  ordinal integer,
  text text,
  locator jsonb,
  heading_path text,
  score double precision
)
language sql
security definer
set search_path = public, extensions
as $$
  with q as (
    select case
      when coalesce(trim(p_query_text), '') = '' then null::tsquery
      else plainto_tsquery('simple', p_query_text)
    end as tsq
  ),
  authorised as (
    select c.chunk_id, c.source_version_id, c.owner_id, c.ordinal, c.text, c.locator, c.heading_path,
           c.verification_status, c.search_vector, e.embedding,
           v.source_id, v.visibility, s.title, s.publisher, s.canonical_url, s.source_scope
    from public.app_chunks c
    join public.app_chunk_embeddings e on e.chunk_id = c.chunk_id and e.profile_id = p_profile_id
    join public.app_source_versions v on v.source_version_id = c.source_version_id
    join public.app_sources s on s.source_id = v.source_id
    where c.visibility = 'approved_reference' or c.owner_id = p_owner
  ),
  dense as (
    select a.*, (a.embedding <=> p_query_embedding::extensions.vector) as score
    from authorised a
    order by a.embedding <=> p_query_embedding::extensions.vector
    limit greatest(1, least(200, p_limit))
  ),
  lexical as (
    select a.*, ts_rank_cd(a.search_vector, q.tsq) as score
    from authorised a, q
    where q.tsq is not null and a.search_vector @@ q.tsq
    order by score desc
    limit greatest(1, least(200, p_limit))
  )
  select 'dense'::text, d.chunk_id, d.source_version_id, d.source_id, d.title, d.publisher, d.canonical_url,
         d.verification_status, d.source_scope, d.owner_id, d.ordinal, d.text, d.locator, d.heading_path, d.score
  from dense d
  union all
  select 'lexical'::text, l.chunk_id, l.source_version_id, l.source_id, l.title, l.publisher, l.canonical_url,
         l.verification_status, l.source_scope, l.owner_id, l.ordinal, l.text, l.locator, l.heading_path, l.score
  from lexical l;
$$;

create or replace function public.worker_chunk_neighbors(
  p_chunk_ids uuid[],
  p_owner uuid
) returns table (
  anchor_chunk_id uuid,
  chunk_id uuid,
  source_version_id uuid,
  source_id text,
  title text,
  verification_status text,
  source_scope text,
  owner_id uuid,
  ordinal integer,
  text text,
  locator jsonb,
  heading_path text
)
language sql
security definer
set search_path = public
as $$
  select a.anchor_id, c.chunk_id, c.source_version_id, v.source_id, s.title,
         c.verification_status, s.source_scope, c.owner_id, c.ordinal, c.text, c.locator, c.heading_path
  from unnest(p_chunk_ids) as a(anchor_id)
  join public.app_chunks anchor on anchor.chunk_id = a.anchor_id
  join public.app_chunks c
    on c.source_version_id = anchor.source_version_id
   and c.splitter_version = anchor.splitter_version
   and c.ordinal in (anchor.ordinal - 1, anchor.ordinal + 1)
  join public.app_source_versions v on v.source_version_id = c.source_version_id
  join public.app_sources s on s.source_id = v.source_id
  where c.visibility = 'approved_reference' or c.owner_id = p_owner
  order by a.anchor_id, c.ordinal;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.app_submit_run(text, uuid, jsonb, text, integer) from public, anon;
revoke all on function public.app_cancel_run(uuid) from public, anon;
grant execute on function public.app_submit_run(text, uuid, jsonb, text, integer) to authenticated, service_role;
grant execute on function public.app_cancel_run(uuid) to authenticated, service_role;

revoke all on function public.worker_claim_job(text, integer) from public, anon, authenticated;
revoke all on function public.worker_heartbeat(uuid, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.worker_set_progress(uuid, text, bigint, text, integer) from public, anon, authenticated;
revoke all on function public.worker_complete_job(uuid, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.worker_fail_job(uuid, text, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.worker_register_artifact(uuid, text, bigint, uuid, text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.worker_search_chunks(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.worker_chunk_neighbors(uuid[], uuid) from public, anon, authenticated;

grant execute on function public.worker_claim_job(text, integer) to service_role;
grant execute on function public.worker_heartbeat(uuid, text, bigint, integer) to service_role;
grant execute on function public.worker_set_progress(uuid, text, bigint, text, integer) to service_role;
grant execute on function public.worker_complete_job(uuid, text, bigint, jsonb) to service_role;
grant execute on function public.worker_fail_job(uuid, text, bigint, text, boolean) to service_role;
grant execute on function public.worker_save_plan(uuid, text, bigint, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.worker_register_artifact(uuid, text, bigint, uuid, text, text, text, bigint, uuid) to service_role;
grant execute on function public.worker_search_chunks(uuid, text, text, text, integer) to service_role;
grant execute on function public.worker_chunk_neighbors(uuid[], uuid) to service_role;
