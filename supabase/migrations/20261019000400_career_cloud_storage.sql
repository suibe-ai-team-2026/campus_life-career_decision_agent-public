-- Private buckets. Object paths are owner_id/run_id-or-source_id/uuid.ext.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('career-source-files', 'career-source-files', false, 20971520,
   array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown']),
  ('career-artifacts', 'career-artifacts', false, 52428800,
   array['application/pdf', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Uploaded source files: only the owning user may touch their own path prefix.
drop policy if exists career_source_files_insert on storage.objects;
create policy career_source_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'career-source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists career_source_files_select on storage.objects;
create policy career_source_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'career-source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists career_source_files_update on storage.objects;
create policy career_source_files_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'career-source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'career-source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists career_source_files_delete on storage.objects;
create policy career_source_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'career-source-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Artifacts are written by the trusted worker with the service role; users may
-- list/read only their own prefix. The BFF re-checks artifact ownership before signing.
drop policy if exists career_artifacts_select on storage.objects;
create policy career_artifacts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'career-artifacts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
