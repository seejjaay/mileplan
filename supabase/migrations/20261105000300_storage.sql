-- Private buckets with project-scoped policies. Object path: {project_id}/{uuid}-{filename}
-- (avatars: {user_id}/{file}).

-- Raster images, PDF and ZIP only. SVG is deliberately excluded (it can carry script).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select b, b, false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'application/zip']
from unnest(array['documents', 'attachments', 'payment-proofs', 'avatars']) as b
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- First path segment as a project id; null when it is not a uuid.
create function public.path_project_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;
grant execute on function public.path_project_id(text) to authenticated, service_role;

-- Reads: project buckets need can_see; avatars are readable by any signed-in user.
create policy objects_select on storage.objects for select to authenticated
  using (
    public.is_admin()
    or (bucket_id in ('documents', 'attachments', 'payment-proofs') and public.can_see(public.path_project_id(name)))
    or bucket_id = 'avatars'
  );

-- Inserts: clients only into payment-proofs/attachments of projects they can see; avatars into own folder.
create policy objects_insert on storage.objects for insert to authenticated
  with check (
    public.is_admin()
    or (bucket_id in ('payment-proofs', 'attachments') and public.can_see(public.path_project_id(name)))
    or (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  );

create policy objects_update on storage.objects for update to authenticated
  using (public.is_admin() or (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text))
  with check (public.is_admin() or (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text));

create policy objects_delete on storage.objects for delete to authenticated
  using (public.is_admin() or (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text));
