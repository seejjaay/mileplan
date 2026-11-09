begin;
select plan(14);

-- Fixtures (as postgres) ---------------------------------------------------------------------------------
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');

insert into public.notifications (id, recipient_id, project_id, kind, group_key, needs_action) values
  ('00000000-0000-0000-0000-00000000f001', tests.get_user('ana@client-a.test'), '00000000-0000-0000-0000-0000000000a1', 'update_posted', 'update_posted:u1', false),
  ('00000000-0000-0000-0000-00000000f002', tests.get_user('ana@client-a.test'), '00000000-0000-0000-0000-0000000000a1', 'milestone_in_review', 'milestone_in_review:m1', true),
  ('00000000-0000-0000-0000-00000000f003', tests.get_user('ben@client-b.test'), '00000000-0000-0000-0000-0000000000a2', 'update_posted', 'update_posted:u2', false);

-- Shape ---------------------------------------------------------------------------------------------------
select has_table('public', 'notifications', 'notifications exists');
select has_type('public', 'notification_kind', 'notification_kind exists');

-- Reads are scoped to the recipient -----------------------------------------------------------------------
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select count(*)::int from public.notifications), 2, 'a user sees only their own notifications');

-- Nobody writes the table directly ------------------------------------------------------------------------
select throws_ok(
  format($f$insert into public.notifications (recipient_id, project_id, kind, group_key) values (%L, '00000000-0000-0000-0000-0000000000a1', 'update_posted', 'x')$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'a user cannot insert a notification');
select throws_ok($$update public.notifications set read_at = now()$$, '42501', null, 'a user cannot update a notification directly');
select throws_ok($$delete from public.notifications$$, '42501', null, 'a user cannot delete a notification');

-- mark_notifications_read ---------------------------------------------------------------------------------
select lives_ok(
  $$select public.mark_notifications_read(array['00000000-0000-0000-0000-00000000f001'::uuid, '00000000-0000-0000-0000-00000000f003'::uuid])$$,
  'a user can mark notifications read');
select tests.clear_auth();
select is(
  (select array_agg(id order by id) from public.notifications where read_at is not null),
  array['00000000-0000-0000-0000-00000000f001'::uuid],
  'only the caller''s own row was marked read; someone else''s id in the list is ignored');

-- mark_all_notifications_read -----------------------------------------------------------------------------
update public.notifications set read_at = null;
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select public.mark_all_notifications_read();
select tests.clear_auth();
select is(
  (select array_agg(id order by id) from public.notifications where read_at is not null),
  array['00000000-0000-0000-0000-00000000f001'::uuid],
  'mark all read clears info items and leaves action items and other people''s rows alone');

-- One unread row per (recipient, group) -------------------------------------------------------------------
select throws_ok(
  format($f$insert into public.notifications (recipient_id, project_id, kind, group_key) values (%L, '00000000-0000-0000-0000-0000000000a1', 'milestone_in_review', 'milestone_in_review:m1')$f$, tests.get_user('ana@client-a.test')),
  '23505', null, 'a second unread row with the same group key is refused');
select lives_ok(
  format($f$insert into public.notifications (recipient_id, project_id, kind, group_key) values (%L, '00000000-0000-0000-0000-0000000000a1', 'update_posted', 'update_posted:u1')$f$, tests.get_user('ana@client-a.test')),
  'the same group key is allowed again once the earlier row is read');

-- Cascade and realtime ------------------------------------------------------------------------------------
delete from public.projects where id = '00000000-0000-0000-0000-0000000000a2';
select is((select count(*)::int from public.notifications where project_id = '00000000-0000-0000-0000-0000000000a2'), 0,
  'deleting a project removes its notifications');
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'public.notifications is in the supabase_realtime publication');

-- The resolve step looks rows up by project and group, and project_id is a foreign key.
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'notifications' and indexname = 'notifications_project_group'),
  'notifications has an index on (project_id, group_key)');

select * from finish();
rollback;
