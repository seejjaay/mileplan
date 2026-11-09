begin;
select plan(5);

select is(
  (select count(*)::int from unnest(array[
    'handle_new_user', 'lock_closed_project', 'log_activity', 'milestone_reviews_apply', 'notify_from_activity', 'notify_from_ack',
    'milestones_guard_status', 'payments_from_request', 'sync_profile_email', 'tasks_set_project_id'
  ]) as t(fn)
  where has_function_privilege('anon', format('public.%I()', fn)::regprocedure, 'execute')
     or has_function_privilege('authenticated', format('public.%I()', fn)::regprocedure, 'execute')),
  0, 'trigger functions are not executable by anon or authenticated');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
     and has_function_privilege('anon', p.oid, 'execute')),
  0, 'no public trigger function is executable by anon');

select is(
  (select count(*)::int from unnest(array[
    'public.notify_client_ids(uuid, uuid)', 'public.notify_admin_ids(uuid)',
    'public.notify(uuid[], uuid, public.notification_kind, text, uuid, boolean, jsonb)',
    'public.resolve_notifications(uuid, text, uuid)'
  ]) as t(fn)
  where has_function_privilege('anon', fn::regprocedure, 'execute')
     or has_function_privilege('authenticated', fn::regprocedure, 'execute')),
  0, 'notification helpers are not executable by anon or authenticated');

select ok(
  has_function_privilege('authenticated', 'public.is_admin()', 'execute')
  and has_function_privilege('authenticated', 'public.can_see(uuid)', 'execute'),
  'RLS helpers stay executable by authenticated');

-- Triggers still fire without EXECUTE: a new auth user still gets a profile.
do $$ begin perform tests.create_user('grants@client-g.test'); end $$;
select is(
  (select role::text from public.profiles where id = tests.get_user('grants@client-g.test')),
  'client', 'the signup trigger still creates a profile');

select * from finish();
rollback;
