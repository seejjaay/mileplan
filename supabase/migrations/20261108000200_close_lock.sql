-- Phase 3: closing a project makes the tracker read-only.
-- A closed project (completed or terminated) refuses every write to the tracker tables, admin included,
-- until it is reopened. Messages stay open for 30 days after the close. Refusals raise SQLSTATE MP001.

-- 1. Helpers. Security definer so a client's own RLS never hides the project row from the check.
create function public.project_is_open(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.status in ('setup', 'active') from public.projects p where p.id = p_project_id), false)
$$;

create function public.project_accepts_messages(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.status in ('setup', 'active') or p.closed_at > now() - interval '30 days'
     from public.projects p where p.id = p_project_id),
    false)
$$;

revoke all on function public.project_is_open(uuid), public.project_accepts_messages(uuid) from public, anon;
grant execute on function public.project_is_open(uuid), public.project_accepts_messages(uuid) to authenticated, service_role;

-- 2. The lock. One BEFORE trigger function, attached to every tracker table and to messages.
create function public.lock_closed_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_project uuid;
  v_ok boolean;
begin
  v_project := case tg_table_name
    when 'milestone_reviews' then (select m.project_id from public.milestones m where m.id = (v_row ->> 'milestone_id')::uuid)
    else (v_row ->> 'project_id')::uuid
  end;

  -- A cascade delete of the whole project has already removed the parent row: let it through.
  if v_project is null or not exists (select 1 from public.projects p where p.id = v_project) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_ok := case tg_table_name
    when 'messages' then public.project_accepts_messages(v_project)
    else public.project_is_open(v_project)
  end;
  if not v_ok then
    raise exception 'project is closed' using errcode = 'MP001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger milestones_lock_closed before insert or update or delete on public.milestones
  for each row execute function public.lock_closed_project();
create trigger tasks_lock_closed before insert or update or delete on public.tasks
  for each row execute function public.lock_closed_project();
create trigger updates_lock_closed before insert or update or delete on public.updates
  for each row execute function public.lock_closed_project();
create trigger documents_lock_closed before insert or update or delete on public.documents
  for each row execute function public.lock_closed_project();
create trigger payment_requests_lock_closed before insert or update or delete on public.payment_requests
  for each row execute function public.lock_closed_project();
create trigger payments_lock_closed before insert or update or delete on public.payments
  for each row execute function public.lock_closed_project();
create trigger milestone_reviews_lock_closed before insert or update or delete on public.milestone_reviews
  for each row execute function public.lock_closed_project();
create trigger messages_lock_closed before insert or update or delete on public.messages
  for each row execute function public.lock_closed_project();

-- 3. Close and reopen. security INVOKER; begin_admin_edit refuses non-admins with 42501 and records the reason
-- for the projects activity trigger (a status change).
create function public.close_project(p_project_id uuid, p_outcome text, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_status public.project_status;
begin
  perform public.begin_admin_edit(p_reason);
  if p_outcome is null or p_outcome not in ('completed', 'terminated') then
    raise exception 'outcome must be completed or terminated' using errcode = '22023';
  end if;
  select status into v_status from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'a % project cannot be closed', v_status using errcode = '22023';
  end if;
  update public.projects set status = p_outcome::public.project_status, closed_at = now() where id = p_project_id;
end;
$$;

create function public.reopen_project(p_project_id uuid, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_status public.project_status;
begin
  perform public.begin_admin_edit(p_reason);
  select status into v_status from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_status not in ('completed', 'terminated') then
    raise exception 'a % project cannot be reopened', v_status using errcode = '22023';
  end if;
  update public.projects set status = 'active', closed_at = null where id = p_project_id;
end;
$$;

revoke all on function public.close_project(uuid, text, text), public.reopen_project(uuid, text) from public, anon;
grant execute on function public.close_project(uuid, text, text), public.reopen_project(uuid, text) to authenticated;

-- 4. Storage. Uploads into a closed project's folder are refused as well, so a stale tab cannot leave an orphan file.
-- payment-proofs and documents need the project open; attachments follow the message window. The admin bypass
-- is narrowed the same way.
drop policy objects_insert on storage.objects;
create policy objects_insert on storage.objects for insert to authenticated
  with check (
    (bucket_id = 'payment-proofs'
      and (public.is_admin() or public.can_see(public.path_project_id(name)))
      and public.project_is_open(public.path_project_id(name)))
    or (bucket_id = 'documents'
      and public.is_admin()
      and public.project_is_open(public.path_project_id(name)))
    or (bucket_id = 'attachments'
      and (public.is_admin() or public.can_see(public.path_project_id(name)))
      and public.project_accepts_messages(public.path_project_id(name)))
    or (bucket_id = 'avatars'
      and (public.is_admin() or (storage.foldername(name))[1] = (select auth.uid())::text))
  );
