-- Trigger functions are fired by the database, never called through the API, and Postgres does not
-- check EXECUTE when a trigger fires. Supabase's default privileges grant EXECUTE on every public
-- function to anon and authenticated, which exposes the SECURITY DEFINER ones as RPC endpoints
-- (/rest/v1/rpc/<name>). Close that. Helper functions used by RLS policies and RPCs
-- (is_admin, can_see, display_name, ...) are called as the logged-in user and keep their grants.
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.lock_closed_project()      from public, anon, authenticated;
revoke execute on function public.log_activity()             from public, anon, authenticated;
revoke execute on function public.milestone_reviews_apply()  from public, anon, authenticated;
revoke execute on function public.milestones_guard_status()  from public, anon, authenticated;
revoke execute on function public.payments_from_request()    from public, anon, authenticated;
revoke execute on function public.sync_profile_email()       from public, anon, authenticated;
revoke execute on function public.tasks_set_project_id()     from public, anon, authenticated;
