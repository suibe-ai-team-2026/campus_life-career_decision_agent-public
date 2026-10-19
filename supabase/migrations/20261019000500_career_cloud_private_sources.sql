-- Users may register their own private uploads; the shared corpus stays read-only.
create policy app_sources_insert_private on public.app_sources
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and visibility = 'private');

create policy app_sources_update_private on public.app_sources
  for update to authenticated
  using (owner_id = (select auth.uid()) and visibility = 'private')
  with check (owner_id = (select auth.uid()) and visibility = 'private');

create policy app_source_versions_insert_private on public.app_source_versions
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and visibility = 'private');

create policy app_source_versions_update_private on public.app_source_versions
  for update to authenticated
  using (owner_id = (select auth.uid()) and visibility = 'private')
  with check (owner_id = (select auth.uid()) and visibility = 'private');
