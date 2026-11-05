begin;
select plan(7);

do $$ begin perform tests.create_user('cara@client-c.test'); end $$;

insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('cara@client-c.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'), 'hello');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select is(public.display_name(tests.get_user('admin@mileplan.test')), 'admin', 'a client can read the admin''s name');
select is(public.display_name(tests.get_user('ana@client-a.test')), 'ana', 'a client can read their own name');
select is(public.display_name(tests.get_user('cara@client-c.test')), 'cara', 'a client can read a co-member''s name');
select is(public.display_name(tests.get_user('ben@client-b.test')), null, 'a client gets null for an unrelated client');
select is((select count(*) from public.profiles where id = tests.get_user('admin@mileplan.test')), 0::bigint, 'the admin profile row is still not readable');
select is((select u.author_name from public.updates u limit 1), 'admin', 'update author_name is resolved for the client');
select is(public.display_name(gen_random_uuid()), null, 'an unknown id gives null, not an error');

select * from finish();
rollback;
