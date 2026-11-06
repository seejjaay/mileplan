begin;
select plan(26);

-- Fixtures (as postgres)
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.payment_requests (id, project_id, title, amount, due_date) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Deposit', 50, current_date + 1);

insert into public.milestones (id, project_id, title, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'In review', 'in_review'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'Planned', 'planned');
insert into public.messages (id, project_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'), 'fresh', now()),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'), 'old', now() - interval '16 minutes');
insert into public.activity (id, project_id, actor_id, entity, entity_id, action) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'),
   'milestone', '00000000-0000-0000-0000-0000000000b1', 'updated');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

-- payments
select lives_ok(format($f$insert into public.payments (project_id, request_id, amount, status, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 50, 'pending', %L)$f$, tests.get_user('ana@client-a.test')), 'payments: client inserts pending proof');
select throws_ok(format($f$insert into public.payments (project_id, request_id, amount, status, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 50, 'confirmed', %L)$f$, tests.get_user('ana@client-a.test')), '42501', null, 'payments: client cannot insert confirmed');
select throws_ok(format($f$insert into public.payments (project_id, amount, status, submitted_by) values ('00000000-0000-0000-0000-0000000000a2', 50, 'pending', %L)$f$, tests.get_user('ana@client-a.test')), '42501', null, 'payments: client cannot insert into other project');

-- milestone_reviews
select lives_ok(format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b1', %L, 'approved')$f$, tests.get_user('ana@client-a.test')), 'reviews: insert while in_review');
select throws_ok(format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b3', %L, 'approved')$f$, tests.get_user('ana@client-a.test')), '42501', null, 'reviews: insert while planned denied');

-- messages
select lives_ok(format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hello')$f$, tests.get_user('ana@client-a.test')), 'messages: insert as self');
select throws_ok(format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'spoof')$f$, tests.get_user('ben@client-b.test')), '42501', null, 'messages: cannot spoof sender');
with u as (update public.messages set body = 'edited' where id = '00000000-0000-0000-0000-0000000000d1' returning 1)
select is((select count(*) from u), 1::bigint, 'messages: edit own within 15 minutes');
with u as (update public.messages set body = 'edited' where id = '00000000-0000-0000-0000-0000000000d2' returning 1)
select is((select count(*) from u), 0::bigint, 'messages: edit after 15 minutes changes nothing');

-- activity
select throws_ok(format($f$insert into public.activity (project_id, actor_id, entity, entity_id, action) values ('00000000-0000-0000-0000-0000000000a1', %L, 'project', gen_random_uuid(), 'created')$f$, tests.get_user('ana@client-a.test')), '42501', null, 'activity: client insert denied');

-- setup_tokens
select throws_ok('select count(*) from public.setup_tokens', '42501', null, 'setup_tokens: client cannot read');

-- milestones, tasks, documents, updates: client writes denied
select throws_ok($f$insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'x')$f$, '42501', null, 'milestones: client insert denied');
with u as (update public.milestones set title = 'hacked' where id = '00000000-0000-0000-0000-0000000000b1' returning 1)
select is((select count(*) from u), 0::bigint, 'milestones: client update changes nothing');
select throws_ok($f$insert into public.tasks (milestone_id, title) values ('00000000-0000-0000-0000-0000000000b1', 'x')$f$, '42501', null, 'tasks: client insert denied');
select throws_ok(format($f$insert into public.documents (project_id, kind, title, storage_path, uploaded_by) values ('00000000-0000-0000-0000-0000000000a1', 'other', 'x', 'a1/x.pdf', %L)$f$, tests.get_user('ana@client-a.test')), '42501', null, 'documents: client insert denied');
select throws_ok(format($f$insert into public.updates (project_id, author_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'x')$f$, tests.get_user('ana@client-a.test')), '42501', null, 'updates: client insert denied');

-- plan_change_acks
select lives_ok(format($f$insert into public.plan_change_acks (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', %L)$f$, tests.get_user('ana@client-a.test')), 'acks: client acks as self');
select throws_ok(format($f$insert into public.plan_change_acks (activity_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', %L)$f$, tests.get_user('ben@client-b.test')), '42501', null, 'acks: cannot ack as someone else');

select tests.clear_auth();
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));

-- admin writes succeed
select lives_ok($f$insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'admin ms')$f$, 'milestones: admin insert');
select lives_ok($f$insert into public.tasks (milestone_id, title) values ('00000000-0000-0000-0000-0000000000b1', 'admin task')$f$, 'tasks: admin insert');
select lives_ok(format($f$insert into public.documents (project_id, kind, title, storage_path, uploaded_by) values ('00000000-0000-0000-0000-0000000000a1', 'other', 'x', 'a1/x.pdf', %L)$f$, tests.get_user('admin@mileplan.test')), 'documents: admin insert');
select lives_ok(format($f$insert into public.updates (project_id, author_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'x')$f$, tests.get_user('admin@mileplan.test')), 'updates: admin insert');
select throws_ok(format($f$insert into public.activity (project_id, actor_id, entity, entity_id, action) values ('00000000-0000-0000-0000-0000000000a1', %L, 'project', gen_random_uuid(), 'created')$f$, tests.get_user('admin@mileplan.test')), '42501', null, 'activity: admin insert denied');
select throws_ok('select count(*) from public.setup_tokens', '42501', null, 'setup_tokens: admin cannot read');

-- deactivated client
select tests.clear_auth();
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select count(*) from public.milestones), 3::bigint, 'active client sees milestones');
select tests.clear_auth();
update public.profiles set active = false where id = tests.get_user('ana@client-a.test');
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select count(*) from public.milestones), 0::bigint, 'deactivated client sees no milestones');

select * from finish();
rollback;
