-- Phase 2b: realtime, client review effects, and admin/co-member display names.

-- 1. Realtime. Realtime applies each subscriber's RLS, so only people who can SELECT a row get its event.
alter publication supabase_realtime add table
  public.projects, public.milestones, public.tasks, public.updates, public.documents,
  public.activity, public.plan_change_acks, public.milestone_reviews;

-- 2. Reviews. "Request changes" must carry a comment.
alter table public.milestone_reviews
  add constraint milestone_reviews_comment_required
  check (decision <> 'changes_requested' or length(trim(coalesce(comment, ''))) > 0);

-- A client's review moves the milestone (clients have no UPDATE on milestones, so this runs as definer).
-- If the milestone is no longer in_review (another reviewer got there first) the whole insert fails with 42501.
create function public.milestone_reviews_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('mileplan.reason', '', true); -- never inherit someone else's edit reason
  update public.milestones
  set status = case new.decision
                 when 'approved' then 'approved'::public.milestone_status
                 else 'in_progress'::public.milestone_status
               end
  where id = new.milestone_id and status = 'in_review';
  if not found then
    raise exception 'this milestone was already reviewed' using errcode = '42501';
  end if;
  return null;
end;
$$;

create trigger milestone_reviews_apply after insert on public.milestone_reviews
  for each row execute function public.milestone_reviews_apply();

-- 3. Names. Clients can read the admin's name, their own, and co-members' names, never the profile rows.
create function public.display_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select p.full_name
  from public.profiles p
  where p.id = p_user
    and (p.role = 'admin'
         or p.id = (select auth.uid())
         or public.is_admin()
         or public.shares_visible_project(p.id));
$$;

-- PostgREST "computed columns": `select=*,author_name` works because these take the table's row type.
create function public.author_name(public.updates) returns text
language sql stable security definer set search_path = '' as $$ select public.display_name($1.author_id) $$;

create function public.actor_name(public.activity) returns text
language sql stable security definer set search_path = '' as $$ select public.display_name($1.actor_id) $$;

create function public.reviewer_name(public.milestone_reviews) returns text
language sql stable security definer set search_path = '' as $$ select public.display_name($1.user_id) $$;

revoke all on function
  public.display_name(uuid), public.author_name(public.updates), public.actor_name(public.activity),
  public.reviewer_name(public.milestone_reviews)
from public, anon;
grant execute on function
  public.display_name(uuid), public.author_name(public.updates), public.actor_name(public.activity),
  public.reviewer_name(public.milestone_reviews)
to authenticated, service_role;
