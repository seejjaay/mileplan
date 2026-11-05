begin;
select plan(11);

-- Fixtures (as postgres): Ana in P1, Ben in P2; one row in every table for P2 only.
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));

insert into public.documents (project_id, kind, title, storage_path, uploaded_by) values
  ('00000000-0000-0000-0000-0000000000a2', 'contract', 'Contract', 'a2/c.pdf', tests.get_user('admin@mileplan.test'));
insert into public.milestones (id, project_id, title, status) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'M1', 'in_review');
insert into public.tasks (milestone_id, title) values
  ('00000000-0000-0000-0000-0000000000b2', 'T1');
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('admin@mileplan.test'), 'update');
insert into public.milestone_reviews (milestone_id, user_id, decision) values
  ('00000000-0000-0000-0000-0000000000b2', tests.get_user('ben@client-b.test'), 'approved');
insert into public.payments (project_id, amount, submitted_by) values
  ('00000000-0000-0000-0000-0000000000a2', 100, tests.get_user('ben@client-b.test'));
insert into public.messages (project_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'), 'hi');
insert into public.message_reads (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.activity (id, project_id, actor_id, entity, entity_id, action) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', tests.get_user('admin@mileplan.test'),
   'milestone', '00000000-0000-0000-0000-0000000000b2', 'created');
insert into public.plan_change_acks (activity_id, user_id) values
  ('00000000-0000-0000-0000-0000000000c2', tests.get_user('ben@client-b.test'));
insert into public.setup_tokens (user_id, token_hash, expires_at) values
  (tests.get_user('ben@client-b.test'), 'hash', now() + interval '7 days');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select is((select count(*) from public.documents), 0::bigint, 'isolation: documents');
select is((select count(*) from public.milestones), 0::bigint, 'isolation: milestones');
select is((select count(*) from public.tasks), 0::bigint, 'isolation: tasks');
select is((select count(*) from public.updates), 0::bigint, 'isolation: updates');
select is((select count(*) from public.milestone_reviews), 0::bigint, 'isolation: milestone_reviews');
select is((select count(*) from public.payments), 0::bigint, 'isolation: payments');
select is((select count(*) from public.messages), 0::bigint, 'isolation: messages');
select is((select count(*) from public.message_reads), 0::bigint, 'isolation: message_reads');
select is((select count(*) from public.activity), 0::bigint, 'isolation: activity');
select is((select count(*) from public.plan_change_acks), 0::bigint, 'isolation: plan_change_acks');
select throws_ok('select count(*) from public.setup_tokens', '42501', null, 'isolation: setup_tokens');

select * from finish();
rollback;
