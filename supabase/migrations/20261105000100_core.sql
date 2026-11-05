-- Core schema: enums, profiles, projects, project_members, helpers, RLS.

create type public.user_role as enum ('admin', 'client');
create type public.project_status as enum ('setup', 'active', 'completed', 'terminated');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  role public.user_role not null default 'client',
  full_name text,
  company text,
  avatar_path text,
  active boolean not null default true
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null,
  summary text,
  status public.project_status not null default 'setup',
  currency char(3) not null default 'PHP',
  start_date date,
  end_date date,
  activated_at timestamptz,
  closed_at timestamptz
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

-- Profile row for every new auth user (always a client; admins are promoted by hand).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, full_name)
  values (new.id, 'client', new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS helpers
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create function public.can_see(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (
    select 1
    from public.project_members m
    join public.projects pr on pr.id = m.project_id
    join public.profiles pf on pf.id = m.user_id
    where m.project_id = p_project_id
      and m.user_id = (select auth.uid())
      and pr.status <> 'setup'
      and pf.active
  );
$$;

-- True when the caller shares a visible project with p_user (used by the profiles policy).
create function public.shares_visible_project(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user
      and public.can_see(mine.project_id)
  );
$$;

revoke all on function public.is_admin(), public.can_see(uuid), public.shares_visible_project(uuid) from public, anon;
grant execute on function public.is_admin(), public.can_see(uuid), public.shares_visible_project(uuid) to authenticated, service_role;

-- Privileges: nothing for anon; narrow grants for authenticated.
revoke all on public.profiles, public.projects, public.project_members from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- profiles
grant select on public.profiles to authenticated;
grant update (full_name, avatar_path) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin() or public.shares_visible_project(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- projects
grant select, insert, update, delete on public.projects to authenticated;
create policy projects_select on public.projects for select to authenticated
  using (public.can_see(id));
create policy projects_admin_insert on public.projects for insert to authenticated
  with check (public.is_admin());
create policy projects_admin_update on public.projects for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy projects_admin_delete on public.projects for delete to authenticated
  using (public.is_admin());

-- project_members
grant select, insert, update, delete on public.project_members to authenticated;
create policy members_select on public.project_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_see(project_id));
create policy members_admin_insert on public.project_members for insert to authenticated
  with check (public.is_admin());
create policy members_update on public.project_members for update to authenticated
  using (public.is_admin() or user_id = (select auth.uid()))
  with check (public.is_admin() or user_id = (select auth.uid()));
create policy members_admin_delete on public.project_members for delete to authenticated
  using (public.is_admin());
