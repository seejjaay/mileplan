begin;
select plan(3);

do $$ begin perform tests.create_user('cara@client-c.test'); end $$;

insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('cara@client-c.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.activity (id, project_id, actor_id, entity, entity_id, action, plan_change) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'),
   'milestone', gen_random_uuid(), 'updated', true);
insert into public.plan_change_acks (activity_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000c1', tests.get_user('cara@client-c.test'));

select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select results_eq(
  $$select a.acker_name from public.plan_change_acks a order by 1$$,
  $$values ('ana'::text), ('cara')$$, 'admin sees who acknowledged');

select tests.clear_auth();
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select results_eq(
  $$select a.acker_name from public.plan_change_acks a order by 1$$,
  $$values ('ana'::text), ('cara')$$, 'a client sees co-members'' acknowledgements by name');

select tests.clear_auth();
select tests.authenticate_as(tests.get_user('ben@client-b.test'));
select is((select count(*) from public.plan_change_acks), 0::bigint, 'an unrelated client sees no acknowledgements');

select * from finish();
rollback;
