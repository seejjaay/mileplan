begin;
select plan(8);

-- fixtures (as postgres)
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'P3', 'setup');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test')),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test'));

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select is((select count(*) from public.projects), 1::bigint, 'client sees own active project');
select is((select count(*) from public.projects where id = '00000000-0000-0000-0000-0000000000a2'), 0::bigint, 'client cannot see other client project');
select is((select count(*) from public.projects where id = '00000000-0000-0000-0000-0000000000a3'), 0::bigint, 'member cannot see setup project');
select throws_ok(
  format($f$update public.profiles set role = 'admin' where id = %L$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'client cannot change own role');

with u as (update public.profiles set full_name = 'Ana Renamed' where id = tests.get_user('ana@client-a.test') returning 1)
select is((select count(*) from u), 1::bigint, 'client can update own name');
select is((select count(*) from public.profiles where id = tests.get_user('ben@client-b.test')), 0::bigint, 'client cannot read unrelated profile');

select tests.clear_auth();
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select is((select count(*) from public.projects), 3::bigint, 'admin sees all projects');

select tests.clear_auth();
do $$ begin perform tests.create_user('new@client-c.test'); end $$;
select is((select role::text from public.profiles where id = tests.get_user('new@client-c.test')), 'client', 'new auth user gets client profile');

select * from finish();
rollback;
