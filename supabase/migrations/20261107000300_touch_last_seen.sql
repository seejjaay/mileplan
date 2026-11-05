-- Records "I just visited this project" with the DATABASE clock, so it compares correctly with activity.created_at
-- no matter how wrong the visitor's device clock is. Security invoker: RLS still limits it to the caller's own member row.
create function public.touch_last_seen(p_project_id uuid) returns void
language sql set search_path = '' as $$
  update public.project_members
  set last_seen_at = now()
  where project_id = p_project_id and user_id = (select auth.uid());
$$;

revoke all on function public.touch_last_seen(uuid) from public, anon;
grant execute on function public.touch_last_seen(uuid) to authenticated;
