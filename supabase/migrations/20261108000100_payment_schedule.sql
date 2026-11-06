-- Phase 3: scheduled payments.
-- The admin schedules payment requests; clients submit proof (a pending `payments` row) against one;
-- the admin confirms or rejects it. A request's state is derived in the app, never stored.
-- A milestone's status is the admin's to set: payments never change it.

-- 1. Schedule table.
alter type public.activity_entity add value if not exists 'payment_request';

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null check (btrim(title) <> ''),
  amount numeric(12,2) not null check (amount > 0),
  due_date date not null,
  created_by uuid references public.profiles (id)
);
create index payment_requests_project_idx on public.payment_requests (project_id);

alter table public.payment_requests enable row level security;
grant select, insert, update, delete on public.payment_requests to authenticated;
create policy payment_requests_select on public.payment_requests for select to authenticated using (public.can_see(project_id));
create policy payment_requests_admin on public.payment_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 2. Payments become submissions against a request. Pre-existing rows keep a null request_id.
alter table public.payments add column request_id uuid references public.payment_requests (id) on delete cascade;
create index payments_request_idx on public.payments (request_id);

-- project_id and milestone_id come from the request, never from the client. (RLS WITH CHECK runs after
-- this trigger, so a client that names another project's request is stopped here or by can_see.)
create function public.payments_from_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_req public.payment_requests;
begin
  if new.request_id is null then
    return new;
  end if;
  select * into v_req from public.payment_requests where id = new.request_id;
  if not found or v_req.project_id <> new.project_id then
    raise exception 'payment request does not belong to this project' using errcode = '22023';
  end if;
  new.milestone_id := v_req.milestone_id;
  return new;
end;
$$;
create trigger payments_from_request before insert or update of request_id on public.payments
  for each row execute function public.payments_from_request();

-- A client submits only pending proof, for themselves, against a request.
drop policy payments_client_insert on public.payments;
create policy payments_client_insert on public.payments for insert to authenticated
  with check (
    status = 'pending'
    and submitted_by = (select auth.uid())
    and request_id is not null
    and reviewed_by is null and reviewed_at is null and review_note is null
    and public.can_see(project_id)
  );

-- "PostgREST computed column": `select=*,submitter_name`.
create function public.submitter_name(public.payments) returns text
language sql stable security definer set search_path = '' as $$ select public.display_name($1.submitted_by) $$;

-- 3. Activity. Requests are logged like milestones; on an active project, adding or deleting one, or changing
-- its amount or due date, is a plan change the client acknowledges. Everything else is unchanged from 20261106000300.
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_entity public.activity_entity;
  v_project uuid;
  v_status public.project_status;
  v_changes jsonb;
  v_action public.activity_action;
  v_plan boolean := false;
begin
  v_entity := case tg_table_name
    when 'projects' then 'project'
    when 'milestones' then 'milestone'
    when 'tasks' then 'task'
    when 'documents' then 'document'
    when 'payments' then 'payment'
    when 'payment_requests' then 'payment_request'
    when 'updates' then 'update'
    when 'milestone_reviews' then 'review'
  end;

  v_project := case tg_table_name
    when 'projects' then (v_row ->> 'id')::uuid
    when 'milestone_reviews' then (select m.project_id from public.milestones m where m.id = (v_row ->> 'milestone_id')::uuid)
    else (v_row ->> 'project_id')::uuid
  end;

  -- A cascade delete removes the parent first; there is nothing left to attach the log row to.
  select p.status into v_status from public.projects p where p.id = v_project;
  if v_status is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(v_old -> k, v_new -> k)) into v_changes
    from jsonb_object_keys(v_new) as k
    where k not in ('id', 'created_at') and (v_old -> k) is distinct from (v_new -> k);

    if v_changes is null then
      return null; -- no-op update
    end if;
    -- Reordering is noise: don't log updates that only moved `position`.
    if not exists (select 1 from jsonb_object_keys(v_changes) k where k <> 'position') then
      return null;
    end if;
    v_action := case when v_changes ? 'status' then 'status_changed' else 'updated' end;
  else
    v_action := case when tg_op = 'INSERT' then 'created' else 'deleted' end;
    select jsonb_object_agg(
             k,
             case when tg_op = 'INSERT' then jsonb_build_array(null::jsonb, v_row -> k) else jsonb_build_array(v_row -> k, null::jsonb) end
           ) into v_changes
    from unnest(array['title', 'amount', 'decision']) as k
    where v_row ? k;
  end if;

  v_plan := v_status = 'active' and (
    (v_entity = 'milestone'
      and (tg_op in ('INSERT', 'DELETE')
           or v_changes ?| array['amount', 'due_date', 'title', 'description', 'acceptance_criteria']))
    or (v_entity = 'payment_request'
      and (tg_op in ('INSERT', 'DELETE')
           or v_changes ?| array['amount', 'due_date']))
  );

  insert into public.activity (created_at, project_id, actor_id, entity, entity_id, action, changes, reason, plan_change)
  values (
    clock_timestamp(), v_project, (select auth.uid()), v_entity, (v_row ->> 'id')::uuid, v_action,
    v_changes, nullif(current_setting('mileplan.reason', true), ''), v_plan
  );
  return null;
end;
$$;

create trigger payment_requests_activity after insert or update or delete on public.payment_requests
  for each row execute function public.log_activity();

-- 4. Admin RPCs. security INVOKER (RLS still applies); begin_admin_edit refuses non-admins with 42501.
create function public.add_payment_request(
  p_project_id uuid, p_title text, p_amount numeric, p_due_date date,
  p_milestone_id uuid default null, p_reason text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.begin_admin_edit(p_reason);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if p_milestone_id is not null
     and not exists (select 1 from public.milestones where id = p_milestone_id and project_id = p_project_id) then
    raise exception 'milestone does not belong to this project' using errcode = '22023';
  end if;
  insert into public.payment_requests (project_id, milestone_id, title, amount, due_date, created_by)
  values (p_project_id, p_milestone_id, btrim(p_title), p_amount, p_due_date, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_payment_request(p_id uuid, p_patch jsonb, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_project uuid;
begin
  perform public.begin_admin_edit(p_reason);
  perform public.assert_keys(p_patch, array['title', 'amount', 'due_date', 'milestone_id']);
  select project_id into v_project from public.payment_requests where id = p_id;
  if not found then
    raise exception 'payment request not found' using errcode = 'P0002';
  end if;
  if (p_patch ->> 'milestone_id') is not null
     and not exists (select 1 from public.milestones where id = (p_patch ->> 'milestone_id')::uuid and project_id = v_project) then
    raise exception 'milestone does not belong to this project' using errcode = '22023';
  end if;
  update public.payment_requests q set
    title = case when p_patch ? 'title' then btrim(r.title) else q.title end,
    amount = case when p_patch ? 'amount' then r.amount else q.amount end,
    due_date = case when p_patch ? 'due_date' then r.due_date else q.due_date end,
    milestone_id = case when p_patch ? 'milestone_id' then r.milestone_id else q.milestone_id end
  from jsonb_populate_record(null::public.payment_requests, p_patch) r
  where q.id = p_id;
end;
$$;

create function public.delete_payment_request(p_id uuid, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_project uuid;
begin
  perform public.begin_admin_edit(p_reason);
  delete from public.payment_requests where id = p_id returning project_id into v_project;
  if v_project is null then
    raise exception 'payment request not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Only a pending payment can be reviewed, and a rejection carries a note.
create function public.review_payment(p_id uuid, p_decision text, p_note text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_status public.payment_status;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.begin_admin_edit(null);
  if p_decision is null or p_decision not in ('confirmed', 'rejected') then
    raise exception 'decision must be confirmed or rejected' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_note is null then
    raise exception 'a rejection needs a note' using errcode = '22023';
  end if;
  select status into v_status from public.payments where id = p_id for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'payment was already reviewed' using errcode = '22023';
  end if;
  update public.payments
  set status = p_decision::public.payment_status,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_note = v_note
  where id = p_id;
end;
$$;

-- The admin records a payment directly (cash, or proof sent by chat): already confirmed.
create function public.record_payment(
  p_request_id uuid, p_amount numeric, p_paid_on date,
  p_method text default null, p_reference text default null, p_proof_path text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_project uuid;
  v_id uuid;
begin
  perform public.begin_admin_edit(null);
  select project_id into v_project from public.payment_requests where id = p_request_id;
  if not found then
    raise exception 'payment request not found' using errcode = 'P0002';
  end if;
  insert into public.payments (project_id, request_id, amount, method, reference, paid_on, proof_path,
                               status, submitted_by, reviewed_by, reviewed_at)
  values (v_project, p_request_id, p_amount, p_method, p_reference, p_paid_on, p_proof_path,
          'confirmed', (select auth.uid()), (select auth.uid()), now())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function
  public.submitter_name(public.payments),
  public.add_payment_request(uuid, text, numeric, date, uuid, text),
  public.update_payment_request(uuid, jsonb, text),
  public.delete_payment_request(uuid, text),
  public.review_payment(uuid, text, text),
  public.record_payment(uuid, numeric, date, text, text, text)
from public, anon;
grant execute on function
  public.submitter_name(public.payments),
  public.add_payment_request(uuid, text, numeric, date, uuid, text),
  public.update_payment_request(uuid, jsonb, text),
  public.delete_payment_request(uuid, text),
  public.review_payment(uuid, text, text),
  public.record_payment(uuid, numeric, date, text, text, text)
to authenticated;
grant execute on function public.submitter_name(public.payments) to service_role;

-- 5. Realtime: only people who can SELECT a row get its event.
alter publication supabase_realtime add table public.payment_requests, public.payments;
