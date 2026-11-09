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
