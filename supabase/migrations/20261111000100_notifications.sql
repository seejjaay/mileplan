-- In-app notifications.
-- Rows are written only by the triggers further down (fan-out from public.activity and public.plan_change_acks);
-- people read their own rows and change them only through the two RPCs.

-- 1. Kinds, one per event in the design (docs/superpowers/specs/2026-11-09-mileplan-notifications-design.md, section 3).
create type public.notification_kind as enum (
  'milestone_in_review', 'update_posted', 'document_added', 'payment_confirmed', 'payment_rejected',
  'plan_change', 'payment_proof', 'milestone_approved', 'changes_requested', 'plan_change_acked'
);

-- 2. The table. group_key collapses repeats of the same event into one unread row (see the unique index below).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.notification_kind not null,
  group_key text not null,
  subject_id uuid,
  needs_action boolean not null default false,
  count int not null default 1,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz
);

-- One unread row per recipient and group; a read row frees the key for the next event.
create unique index notifications_unread_group on public.notifications (recipient_id, group_key) where read_at is null;
create index notifications_recipient_recent on public.notifications (recipient_id, updated_at desc);
-- resolve_notifications() looks rows up by project and group, and project_id is a foreign key (cascade deletes use it too).
create index notifications_project_group on public.notifications (project_id, group_key);

-- 3. Security: read your own rows, nothing else. Writes go through the triggers and RPCs (security definer).
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- 4. Read state. security definer because authenticated has no UPDATE grant; both only ever touch the caller's rows.
create function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.notifications
  set read_at = now()
  where id = any (p_ids) and recipient_id = (select auth.uid()) and read_at is null
$$;

-- "Mark all read" is for information only: action items stay until the action is done (or are dismissed one by one).
create function public.mark_all_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications
  set read_at = now()
  where recipient_id = (select auth.uid()) and read_at is null and needs_action = false
$$;

revoke all on function public.mark_notifications_read(uuid[]), public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read(uuid[]), public.mark_all_notifications_read() to authenticated, service_role;

-- 5. Realtime, unless an earlier migration already added it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- 6. Helpers. Internal: only the trigger functions below call them, and those run as definers.

-- Active client members of a project, except the person who acted.
create function public.notify_client_ids(p_project uuid, p_except uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.user_id), '{}'::uuid[])
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project and p.role = 'client' and p.active and m.user_id is distinct from p_except
$$;

create function public.notify_admin_ids(p_except uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.profiles p
  where p.role = 'admin' and p.active and p.id is distinct from p_except
$$;

-- One row per recipient. A repeat of the same event merges into the recipient's unread row (count + 1).
create function public.notify(
  p_recipients uuid[], p_project uuid, p_kind public.notification_kind, p_group text,
  p_subject uuid, p_needs boolean, p_data jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications as n (recipient_id, project_id, kind, group_key, subject_id, needs_action, data)
  select r, p_project, p_kind, p_group, p_subject, p_needs, p_data from unnest(p_recipients) as r
  on conflict (recipient_id, group_key) where read_at is null
  do update set count = n.count + 1, updated_at = now(), data = excluded.data
$$;

-- The action behind an action item was done: mark it read for everyone it was sent to (or just one recipient).
create function public.resolve_notifications(p_project uuid, p_group text, p_recipient uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications
  set read_at = now()
  where project_id = p_project and group_key = p_group and read_at is null
    and (p_recipient is null or recipient_id = p_recipient)
$$;

-- 7. Fan-out from the activity log. A null actor (SQL import) counts as the admin side.
create function public.notify_from_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.project_status;
  v_admin_side boolean;
  v_from text := new.changes -> 'status' ->> 0;
  v_to text := new.changes -> 'status' ->> 1;
  v_clients uuid[];
  v_p record;
  v_r record;
  v_title text;
  v_request_title text;
  v_snippet text;
begin
  select p.status into v_status from public.projects p where p.id = new.project_id;
  if v_status is null or v_status = 'setup' then
    return null;
  end if;
  v_admin_side := new.actor_id is null
    or exists (select 1 from public.profiles pr where pr.id = new.actor_id and pr.role = 'admin');

  -- Resolve first: whatever this row did may finish an earlier action item.
  if new.entity = 'milestone' and new.action = 'status_changed' then
    if v_from = 'in_review' then
      perform public.resolve_notifications(new.project_id, 'milestone_in_review:' || new.entity_id);
    end if;
    -- A client's review also moves the milestone (in the same transaction), so only the admin side clears it.
    if v_admin_side then
      perform public.resolve_notifications(new.project_id, 'changes_requested:' || new.entity_id);
    end if;
  elsif new.entity = 'payment' and new.action = 'status_changed' and v_from = 'pending' then
    perform public.resolve_notifications(new.project_id, 'payment_proof:' || new.entity_id);
  elsif new.entity = 'payment' and new.action = 'created' then
    select p.request_id into v_p from public.payments p where p.id = new.entity_id;
    if v_p.request_id is not null then
      perform public.resolve_notifications(new.project_id, 'payment_rejected:' || v_p.request_id);
    end if;
  end if;

  v_clients := public.notify_client_ids(new.project_id, new.actor_id);

  -- Any plan change is one notification type, whatever caused it (a new payment request included).
  if new.plan_change then
    if v_admin_side then
      perform public.notify(v_clients, new.project_id, 'plan_change', 'plan_change:' || new.project_id, new.project_id, true, '{}');
    end if;
    return null;
  end if;

  if v_admin_side then
    if new.entity = 'milestone' and new.action = 'status_changed' and v_to = 'in_review' then
      select m.title into v_title from public.milestones m where m.id = new.entity_id;
      perform public.notify(v_clients, new.project_id, 'milestone_in_review', 'milestone_in_review:' || new.entity_id,
        new.entity_id, true, jsonb_build_object('milestone_title', v_title));

    elsif new.entity = 'update' and new.action = 'created' then
      select (select l from regexp_split_to_table(u.body, E'\n') with ordinality as t(l, n)
              where btrim(l, E' \t\r') <> '' order by n limit 1)
        into v_snippet from public.updates u where u.id = new.entity_id;
      perform public.notify(v_clients, new.project_id, 'update_posted', 'update_posted:' || new.entity_id,
        new.entity_id, false,
        jsonb_build_object('actor_name', public.display_name(new.actor_id), 'snippet', left(btrim(coalesce(v_snippet, ''), E' \t\r'), 80)));

    elsif new.entity = 'document' and new.action = 'created' then
      select d.title into v_title from public.documents d where d.id = new.entity_id;
      perform public.notify(v_clients, new.project_id, 'document_added', 'document_added:' || new.entity_id,
        new.entity_id, false, jsonb_build_object('document_title', v_title));

    elsif new.entity = 'payment' and new.action = 'status_changed' and v_to in ('confirmed', 'rejected') then
      select p.request_id, p.amount, p.review_note into v_p from public.payments p where p.id = new.entity_id;
      select r.title into v_request_title from public.payment_requests r where r.id = v_p.request_id;
      if v_to = 'confirmed' then
        perform public.notify(v_clients, new.project_id, 'payment_confirmed', 'payment_confirmed:' || new.entity_id,
          new.entity_id, false, jsonb_build_object('request_title', v_request_title, 'amount', v_p.amount));
      else
        perform public.notify(v_clients, new.project_id, 'payment_rejected',
          'payment_rejected:' || coalesce(v_p.request_id, new.entity_id), coalesce(v_p.request_id, new.entity_id), true,
          jsonb_build_object('request_title', v_request_title, 'amount', v_p.amount, 'note', v_p.review_note));
      end if;
    end if;

  elsif new.entity = 'payment' and new.action = 'created' then
    select p.request_id, p.amount into v_p from public.payments p where p.id = new.entity_id;
    select r.title into v_request_title from public.payment_requests r where r.id = v_p.request_id;
    perform public.notify(public.notify_admin_ids(new.actor_id), new.project_id, 'payment_proof', 'payment_proof:' || new.entity_id,
      new.entity_id, true,
      jsonb_build_object('client_name', public.display_name(new.actor_id), 'request_title', v_request_title, 'amount', v_p.amount));

  elsif new.entity = 'review' and new.action = 'created' then
    select r.decision, r.comment, r.milestone_id into v_r from public.milestone_reviews r where r.id = new.entity_id;
    select m.title into v_title from public.milestones m where m.id = v_r.milestone_id;
    perform public.notify(public.notify_admin_ids(new.actor_id), new.project_id,
      case v_r.decision when 'approved' then 'milestone_approved' else 'changes_requested' end::public.notification_kind,
      case v_r.decision when 'approved' then 'milestone_approved:' else 'changes_requested:' end || v_r.milestone_id,
      v_r.milestone_id, v_r.decision = 'changes_requested',
      jsonb_build_object('client_name', public.display_name(new.actor_id), 'milestone_title', v_title, 'comment', v_r.comment));
  end if;
  return null;
end;
$$;

create trigger notify_from_activity after insert on public.activity
  for each row execute function public.notify_from_activity();

-- 8. Acknowledging plan changes: tell the admin (one row per client, counting acks), and clear the client's own
-- "plan changed" item once nothing is left to acknowledge in that project.
create function public.notify_from_ack() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
begin
  select a.project_id into v_project from public.activity a where a.id = new.activity_id;
  if v_project is null then
    return null;
  end if;
  if not exists (
    select 1 from public.activity a
    where a.project_id = v_project and a.plan_change
      and not exists (select 1 from public.plan_change_acks k where k.activity_id = a.id and k.user_id = new.user_id)
  ) then
    perform public.resolve_notifications(v_project, 'plan_change:' || v_project, new.user_id);
  end if;
  perform public.notify(public.notify_admin_ids(new.user_id), v_project, 'plan_change_acked',
    'plan_change_acked:' || v_project || ':' || new.user_id, new.user_id, false,
    jsonb_build_object('client_name', public.display_name(new.user_id)));
  return null;
end;
$$;

create trigger notify_from_ack after insert on public.plan_change_acks
  for each row execute function public.notify_from_ack();

revoke all on function public.notify_client_ids(uuid, uuid), public.notify_admin_ids(uuid),
  public.notify(uuid[], uuid, public.notification_kind, text, uuid, boolean, jsonb),
  public.resolve_notifications(uuid, text, uuid), public.notify_from_activity(), public.notify_from_ack()
  from public, anon, authenticated;
