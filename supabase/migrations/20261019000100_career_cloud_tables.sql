-- 知途（Campus Pathway）· 纯生涯规划版本 schema
-- Additive only. Do not run against the teammate's existing career_sources project.
-- pgvector 4096 dimensions are stored but NOT ANN-indexed (pgvector HNSW/IVFFlat limit is 2000 / halfvec 4000).

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Shared reference corpus
-- ---------------------------------------------------------------------------

create table if not exists public.app_sources (
  source_id text primary key,
  canonical_url text,
  title text not null,
  publisher text,
  source_scope text,
  visibility text not null default 'approved_reference' check (visibility in ('approved_reference', 'private')),
  owner_id uuid references auth.users (id) on delete set null,
  verification_status text not null default 'unverified',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (visibility = 'approved_reference' or owner_id is not null)
);

create table if not exists public.app_source_versions (
  source_version_id uuid primary key default gen_random_uuid(),
  source_id text not null references public.app_sources (source_id) on delete cascade,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at date,
  retrieved_at timestamptz not null default now(),
  effective_from date,
  effective_to date,
  storage_path text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'parsed', 'partial', 'ocr', 'failed')),
  parser_version text,
  metadata jsonb not null default '{}'::jsonb,
  visibility text not null default 'approved_reference' check (visibility in ('approved_reference', 'private')),
  owner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_id, content_sha256),
  check (visibility = 'approved_reference' or owner_id is not null)
);

create table if not exists public.app_evidence_records (
  record_id text primary key,
  source_version_id uuid not null references public.app_source_versions (source_version_id) on delete cascade,
  record_type text not null,
  cohort text,
  school text,
  degree text,
  major text,
  metric text,
  value numeric,
  unit text,
  numerator numeric,
  denominator numeric,
  statistical_cutoff date,
  definition text,
  population_scope text,
  locator jsonb not null default '{}'::jsonb,
  verification_status text not null default 'unverified',
  included boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_source_aliases (
  batch_id text not null,
  legacy_id text not null,
  entity_type text not null,
  stable_id text not null,
  primary key (batch_id, legacy_id, entity_type)
);

create table if not exists public.app_chunks (
  chunk_id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null references public.app_source_versions (source_version_id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,
  splitter_version text not null,
  ordinal integer not null check (ordinal >= 0),
  text text not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  locator jsonb not null default '{}'::jsonb,
  heading_path text,
  search_terms text not null default '',
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(search_terms, ''))) stored,
  verification_status text not null default 'unverified',
  visibility text not null default 'approved_reference' check (visibility in ('approved_reference', 'private')),
  created_at timestamptz not null default now(),
  unique (source_version_id, splitter_version, ordinal),
  check (visibility = 'approved_reference' or owner_id is not null)
);

create table if not exists public.app_embedding_profiles (
  profile_id text primary key,
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions between 1 and 4096),
  normalization text not null default 'l2',
  query_template_version text not null,
  splitter_version text not null,
  status text not null default 'building' check (status in ('building', 'active', 'retired', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists app_embedding_profiles_one_active
  on public.app_embedding_profiles ((status)) where status = 'active';

create table if not exists public.app_chunk_embeddings (
  chunk_id uuid not null references public.app_chunks (chunk_id) on delete cascade,
  profile_id text not null references public.app_embedding_profiles (profile_id) on delete cascade,
  embedding extensions.vector(4096) not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, profile_id)
);

create table if not exists public.app_import_batches (
  batch_id text primary key,
  source_repo text not null,
  source_commit text not null,
  manifest_sha256 text not null,
  counts jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'rolled_back')),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text
);

-- ---------------------------------------------------------------------------
-- Product + rules
-- ---------------------------------------------------------------------------

create table if not exists public.app_directions (
  direction_id text primary key,
  title text not null,
  category_version text not null,
  description text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.app_assessments (
  version text primary key,
  questions jsonb not null,
  scoring_spec jsonb not null,
  methodology_sources jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_profiles (
  profile_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  school text not null,
  major text not null,
  enrollment_year integer not null check (enrollment_year between 2010 and 2035),
  current_term text not null,
  answers jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  assessment_version text references public.app_assessments (version),
  exploration_status text not null default 'completed' check (exploration_status in ('completed', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_plans (
  plan_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references public.app_profiles (profile_id) on delete cascade,
  direction_id text not null references public.app_directions (direction_id),
  current_version_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.app_plan_versions (
  version_id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.app_plans (plan_id) on delete cascade,
  version integer not null check (version > 0),
  profile_version integer not null,
  rules_version text not null,
  corpus_version text,
  embedding_profile_id text references public.app_embedding_profiles (profile_id),
  actions jsonb not null default '[]'::jsonb,
  user_overrides jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'active', 'stale', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);

alter table public.app_plans
  drop constraint if exists app_plans_current_version_fk;
alter table public.app_plans
  add constraint app_plans_current_version_fk
  foreign key (current_version_id) references public.app_plan_versions (version_id) deferrable initially deferred;

create table if not exists public.app_courses (
  course_id text primary key,
  school text not null,
  major text not null,
  enrollment_year integer not null,
  curriculum_version text not null,
  title text not null,
  credits numeric,
  offered_terms text[] not null default '{}',
  verified_source_version_id uuid references public.app_source_versions (source_version_id),
  locator jsonb not null default '{}'::jsonb,
  status text not null default 'unverified' check (status in ('verified', 'partial', 'unverified', 'excluded'))
);

create table if not exists public.app_prerequisites (
  course_id text not null references public.app_courses (course_id) on delete cascade,
  prerequisite_id text not null references public.app_courses (course_id) on delete cascade,
  relation_type text not null default 'required' check (relation_type in ('required', 'recommended')),
  rule_version text not null,
  source_version_id uuid references public.app_source_versions (source_version_id),
  locator jsonb not null default '{}'::jsonb,
  primary key (course_id, prerequisite_id, relation_type, rule_version)
);

create table if not exists public.app_competitions (
  competition_id text primary key,
  title text not null,
  organizer text,
  eligibility jsonb not null default '{}'::jsonb,
  application_window text,
  recognition_rule_id text,
  source_version_id uuid references public.app_source_versions (source_version_id),
  locator jsonb not null default '{}'::jsonb,
  status text not null default 'unverified' check (status in ('verified', 'partial', 'unverified', 'historical', 'excluded'))
);

create table if not exists public.app_credit_rules (
  rule_id text primary key,
  school text not null,
  enrollment_year integer not null,
  valid_from date,
  valid_to date,
  category text not null,
  scoring_spec jsonb not null,
  cap numeric,
  source_version_id uuid references public.app_source_versions (source_version_id),
  locator jsonb not null default '{}'::jsonb,
  status text not null default 'unverified' check (status in ('verified', 'partial', 'unverified', 'excluded'))
);

create table if not exists public.app_direction_requirements (
  requirement_id text primary key,
  direction_id text not null references public.app_directions (direction_id),
  skill_id text not null,
  skill_label text not null,
  requirement_level text not null default 'preferred' check (requirement_level in ('required', 'preferred', 'mentioned')),
  source_version_id uuid references public.app_source_versions (source_version_id),
  locator jsonb not null default '{}'::jsonb,
  status text not null default 'unverified' check (status in ('verified', 'partial', 'unverified', 'excluded'))
);

create table if not exists public.app_requirement_actions (
  requirement_id text not null references public.app_direction_requirements (requirement_id) on delete cascade,
  action_id text not null,
  mapping_status text not null default 'suggested' check (mapping_status in ('suggested', 'verified', 'rejected')),
  note text,
  primary key (requirement_id, action_id)
);

-- ---------------------------------------------------------------------------
-- Runs, queue, events, artifacts, usage
-- ---------------------------------------------------------------------------

create table if not exists public.app_runs (
  run_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('assessment_explain', 'compare', 'plan', 'ask', 'export', 'ingest')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'parsing', 'embedding', 'retrieving', 'planning', 'rendering', 'validating', 'succeeded', 'failed', 'cancel_requested', 'cancelled')),
  input jsonb not null,
  input_hash text not null,
  idempotency_key uuid not null,
  profile_version integer,
  progress integer not null default 0 check (progress between 0 and 100),
  result_ref uuid,
  error_code text,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (owner_id, kind, idempotency_key)
);

create table if not exists public.app_run_results (
  run_id uuid primary key references public.app_runs (run_id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.app_runs
  drop constraint if exists app_runs_result_ref_fk;
alter table public.app_runs
  add constraint app_runs_result_ref_fk
  foreign key (result_ref) references public.app_run_results (run_id) deferrable initially deferred;

create table if not exists public.app_run_events (
  run_id uuid not null references public.app_runs (run_id) on delete cascade,
  seq bigint not null check (seq > 0),
  event_type text not null,
  safe_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, seq)
);

create table if not exists app_private.jobs (
  job_id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.app_runs (run_id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead')),
  priority integer not null default 100,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_epoch bigint not null default 0,
  worker_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  payload_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references public.app_runs (run_id) on delete cascade,
  plan_version_id uuid references public.app_plan_versions (version_id) on delete cascade,
  kind text not null check (kind in ('plan_pdf', 'plan_json', 'citation_snapshot')),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.app_usage (
  usage_id bigserial primary key,
  owner_id uuid references auth.users (id) on delete set null,
  run_id uuid references public.app_runs (run_id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost numeric,
  currency text,
  pricing_snapshot_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists app_sources_visibility_idx on public.app_sources (visibility, verification_status);
create index if not exists app_source_versions_source_idx on public.app_source_versions (source_id);
create index if not exists app_evidence_records_version_idx on public.app_evidence_records (source_version_id);
create index if not exists app_evidence_records_type_idx on public.app_evidence_records (record_type, included);
create index if not exists app_chunks_version_idx on public.app_chunks (source_version_id, ordinal);
create index if not exists app_chunks_visibility_idx on public.app_chunks (visibility, owner_id);
create index if not exists app_chunks_search_idx on public.app_chunks using gin (search_vector);
create index if not exists app_chunk_embeddings_profile_idx on public.app_chunk_embeddings (profile_id);
create index if not exists app_profiles_owner_idx on public.app_profiles (owner_id);
create index if not exists app_plans_owner_idx on public.app_plans (owner_id, created_at desc);
create index if not exists app_plan_versions_plan_idx on public.app_plan_versions (plan_id, version desc);
create index if not exists app_runs_owner_idx on public.app_runs (owner_id, created_at desc);
create index if not exists app_runs_status_idx on public.app_runs (status);
create index if not exists app_run_events_run_idx on public.app_run_events (run_id, seq);
create index if not exists app_artifacts_owner_idx on public.app_artifacts (owner_id, created_at desc);
create index if not exists app_usage_owner_idx on public.app_usage (owner_id, created_at desc);
create index if not exists app_usage_run_idx on public.app_usage (run_id);
create index if not exists app_private_jobs_claim_idx on app_private.jobs (status, available_at, priority);
create index if not exists app_private_jobs_lease_idx on app_private.jobs (lease_until) where status = 'running';
create index if not exists app_direction_requirements_direction_idx on public.app_direction_requirements (direction_id);
