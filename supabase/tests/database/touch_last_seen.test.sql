begin;
select plan(5);

do $$ begin perform tests.create_user('cara@client-c.test'); end $$;

insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id, last_seen_at) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'), '2020-01-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('cara@client-c.test'), '2020-01-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'), '2020-01-01T00:00:00Z');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select lives_ok($$select public.touch_last_seen('00000000-0000-0000-0000-0000000000a1')$$, 'a member can record a visit');

select tests.clear_auth();
select ok(
  (select last_seen_at > now() - interval '1 minute' from public.project_members
   where project_id = '00000000-0000-0000-0000-0000000000a1' and user_id = tests.get_user('ana@client-a.test')),
  'the member''s own stamp is set from the database clock');
select is(
  (select last_seen_at from public.project_members where project_id = '00000000-0000-0000-0000-0000000000a1' and user_id = tests.get_user('cara@client-c.test')),
  '2020-01-01T00:00:00Z'::timestamptz, 'a co-member''s stamp is untouched');

-- someone who is not a member of the project: no error, nothing changes
select tests.authenticate_as(tests.get_user('ben@client-b.test'));
select lives_ok($$select public.touch_last_seen('00000000-0000-0000-0000-0000000000a1')$$, 'a non-member call is a harmless no-op');
select tests.clear_auth();
select is(
  (select count(*) from public.project_members where last_seen_at > now() - interval '1 minute' and project_id = '00000000-0000-0000-0000-0000000000a2'),
  0::bigint, 'and does not stamp anything of its own');

select * from finish();
rollback;
