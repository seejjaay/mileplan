-- Tracker, payments, messaging and audit tables with RLS.

create type public.document_kind as enum ('contract', 'agreement', 'srs', 'milestone_plan', 'amendment', 'other');
create type public.document_status as enum ('signed', 'superseded');
create type public.milestone_status as enum ('planned', 'in_progress', 'in_review', 'approved', 'paid');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.review_decision as enum ('approved', 'changes_requested');
create type public.payment_status as enum ('pending', 'confirmed', 'rejected');
create type public.activity_entity as enum ('project', 'milestone', 'task', 'document', 'payment', 'update', 'review');
create type public.activity_action as enum ('created', 'updated', 'deleted', 'status_changed');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.document_kind not null,
  title text not null,
  version int not null default 1,
  storage_path text not null,
  sha256 text,
  signed_at date,
  status public.document_status not null default 'signed',
  uploaded_by uuid references public.profiles (id)
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null default 0,
  title text not null,
  description text,
  acceptance_criteria text[] not null default '{}',
  due_date date,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status public.milestone_status not null default 'planned',
  on_hold boolean not null default false,
  plan_key text,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  unique (project_id, plan_key)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  position int not null default 0,
  title text not null,
  status public.task_status not null default 'todo'
);

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  author_id uuid not null references public.profiles (id),
  body text not null,
  attachments jsonb not null default '[]'
);

create table public.milestone_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  decision public.review_decision not null,
  comment text
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method text,
  reference text,
  paid_on date,
  proof_path text,
  status public.payment_status not null default 'pending',
  submitted_by uuid references public.profiles (id),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  attachments jsonb not null default '[]',
  edited_at timestamptz
);

create table public.message_reads (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  entity public.activity_entity not null,
  entity_id uuid not null,
  action public.activity_action not null,
  changes jsonb,
  reason text,
  plan_change boolean not null default false
);

create table public.plan_change_acks (
  activity_id uuid not null references public.activity (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  acked_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table public.setup_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Indexes on foreign keys / filters used by RLS and Realtime
create index documents_project_idx on public.documents (project_id);
create index milestones_project_idx on public.milestones (project_id, position);
create index tasks_milestone_idx on public.tasks (milestone_id, position);
create index tasks_project_idx on public.tasks (project_id);
create index updates_project_idx on public.updates (project_id, created_at desc);
create index milestone_reviews_milestone_idx on public.milestone_reviews (milestone_id);
create index payments_project_idx on public.payments (project_id);
create index messages_project_idx on public.messages (project_id, created_at desc);
create index activity_project_idx on public.activity (project_id, created_at desc);
create index setup_tokens_hash_idx on public.setup_tokens (token_hash);

-- tasks.project_id is copied from the milestone (used for RLS and Realtime filters)
create function public.tasks_set_project_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select m.project_id into new.project_id from public.milestones m where m.id = new.milestone_id;
  return new;
end;
$$;
create trigger tasks_set_project_id
  before insert or update of milestone_id on public.tasks
  for each row execute function public.tasks_set_project_id();

-- Privileges: nothing for anon; policies below do the row filtering.
revoke all on
  public.documents, public.milestones, public.tasks, public.updates, public.milestone_reviews,
  public.payments, public.messages, public.message_reads, public.activity,
  public.plan_change_acks, public.setup_tokens
from anon, authenticated;

alter table public.documents enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.updates enable row level security;
alter table public.milestone_reviews enable row level security;
alter table public.payments enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.activity enable row level security;
alter table public.plan_change_acks enable row level security;
alter table public.setup_tokens enable row level security; -- no policies, no grants: Edge Functions only

-- documents, milestones, tasks, updates: clients read what they can see, admin does everything
grant select, insert, update, delete on public.documents, public.milestones, public.tasks, public.updates to authenticated;
create policy documents_select on public.documents for select to authenticated using (public.can_see(project_id));
create policy documents_admin on public.documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy milestones_select on public.milestones for select to authenticated using (public.can_see(project_id));
create policy milestones_admin on public.milestones for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tasks_select on public.tasks for select to authenticated using (public.can_see(project_id));
create policy tasks_admin on public.tasks for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy updates_select on public.updates for select to authenticated using (public.can_see(project_id));
create policy updates_admin on public.updates for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- milestone_reviews: the milestones subquery is itself RLS-filtered, so it enforces can_see
grant select, insert, update, delete on public.milestone_reviews to authenticated;
create policy reviews_select on public.milestone_reviews for select to authenticated
  using (exists (select 1 from public.milestones m where m.id = milestone_id));
create policy reviews_client_insert on public.milestone_reviews for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.milestones m where m.id = milestone_id and m.status = 'in_review')
  );
create policy reviews_admin on public.milestone_reviews for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- payments: clients may only submit pending proofs for themselves
grant select, insert, update, delete on public.payments to authenticated;
create policy payments_select on public.payments for select to authenticated using (public.can_see(project_id));
create policy payments_client_insert on public.payments for insert to authenticated
  with check (
    status = 'pending'
    and submitted_by = (select auth.uid())
    and reviewed_by is null and reviewed_at is null and review_note is null
    and public.can_see(project_id)
  );
create policy payments_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- messages: insert as self; edit own body within 15 minutes (column grant limits what can change)
grant select, insert, delete on public.messages to authenticated;
grant update (body, edited_at) on public.messages to authenticated;
create policy messages_select on public.messages for select to authenticated using (public.can_see(project_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_see(project_id));
create policy messages_update_own on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) and created_at > now() - interval '15 minutes')
  with check (sender_id = (select auth.uid()));
create policy messages_admin on public.messages for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- message_reads: own rows
grant select, insert, update, delete on public.message_reads to authenticated;
create policy message_reads_own on public.message_reads for all to authenticated
  using (user_id = (select auth.uid()) and public.can_see(project_id))
  with check (user_id = (select auth.uid()) and public.can_see(project_id));
create policy message_reads_admin on public.message_reads for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- activity: read-only for everyone; rows are written by security-definer triggers (Phase 2)
grant select on public.activity to authenticated;
create policy activity_select on public.activity for select to authenticated using (public.can_see(project_id));

-- plan_change_acks: own rows, plus everyone's for visible activity (the activity subquery is RLS-filtered)
grant select, insert on public.plan_change_acks to authenticated;
create policy acks_select on public.plan_change_acks for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.activity a where a.id = activity_id));
create policy acks_insert on public.plan_change_acks for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.activity a where a.id = activity_id));
