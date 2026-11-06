begin;
select plan(22);

-- Fixtures (as postgres)
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'P3 setup', 'setup');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.milestones (id, project_id, title, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'P1 M1', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'P2 M1', 1);
insert into public.payment_requests (id, project_id, milestone_id, title, amount, due_date) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'Deposit', 1000, current_date + 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', null, 'Other deposit', 500, current_date + 1);

-- ---------------------------------------------------------------- client
select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select is((select count(*) from public.payment_requests), 1::bigint, 'client: sees requests of own project only');

select lives_ok(
  format($f$insert into public.payments (id, project_id, request_id, milestone_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', 1000, %L)$f$, tests.get_user('ana@client-a.test')),
  'client: submits pending proof against a request');
select is(
  (select milestone_id from public.payments where id = '00000000-0000-0000-0000-0000000000d1'),
  '00000000-0000-0000-0000-0000000000b1'::uuid,
  'client: milestone_id is copied from the request, whatever the client sent');

select throws_ok(
  format($f$insert into public.payments (project_id, request_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'client: cannot submit against another project''s request (request/project mismatch)');
select throws_ok(
  format($f$insert into public.payments (project_id, request_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'client: cannot submit against another project (RLS)');
select throws_ok(
  format($f$insert into public.payments (project_id, request_id, amount, status, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 10, 'confirmed', %L)$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'client: cannot submit confirmed');
select throws_ok(
  format($f$insert into public.payments (project_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'client: cannot submit without a request');

update public.payments set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000d1';
select is((select status::text from public.payments where id = '00000000-0000-0000-0000-0000000000d1'), 'pending', 'client: cannot confirm own payment (update touches 0 rows)');

select throws_ok($$select public.review_payment('00000000-0000-0000-0000-0000000000d1', 'confirmed')$$, '42501', null, 'client: cannot call review_payment');
select throws_ok($$select public.record_payment('00000000-0000-0000-0000-0000000000c1', 10, current_date)$$, '42501', null, 'client: cannot call record_payment');
select throws_ok($$select public.add_payment_request('00000000-0000-0000-0000-0000000000a1', 'x', 10, current_date)$$, '42501', null, 'client: cannot call add_payment_request');

select is((select p.submitter_name from public.payments p where p.id = '00000000-0000-0000-0000-0000000000d1'), 'ana', 'client: submitter_name resolves through display_name');

-- ----------------------------------------------------------------- admin
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));

select throws_ok($$select public.review_payment('00000000-0000-0000-0000-0000000000d1', 'rejected', '   ')$$, '22023', null, 'admin: reject needs a note');
select lives_ok($$select public.review_payment('00000000-0000-0000-0000-0000000000d1', 'confirmed')$$, 'admin: confirms a pending payment');
select is(
  (select reviewed_by from public.payments where id = '00000000-0000-0000-0000-0000000000d1'),
  tests.get_user('admin@mileplan.test'), 'admin: confirm stamps reviewer');
select throws_ok($$select public.review_payment('00000000-0000-0000-0000-0000000000d1', 'rejected', 'late')$$, '22023', null, 'admin: reviewing a non-pending payment fails');

select lives_ok($$select public.record_payment('00000000-0000-0000-0000-0000000000c1', 250, current_date, 'cash')$$, 'admin: record_payment succeeds');
select is(
  (select count(*) from public.payments where request_id = '00000000-0000-0000-0000-0000000000c1' and status = 'confirmed' and amount = 250 and method = 'cash'),
  1::bigint, 'admin: record_payment inserts a confirmed payment');

-- activity: plan_change flag
select public.add_payment_request('00000000-0000-0000-0000-0000000000a1', 'Balance', 2000, current_date + 30);
select public.add_payment_request('00000000-0000-0000-0000-0000000000a3', 'Setup-time request', 100, current_date + 30);
select is(
  (select plan_change from public.activity where entity = 'payment_request' and action = 'created' and project_id = '00000000-0000-0000-0000-0000000000a1' order by created_at desc limit 1),
  true, 'activity: request insert on an active project is a plan change');
select is(
  (select plan_change from public.activity where entity = 'payment_request' and action = 'created' and project_id = '00000000-0000-0000-0000-0000000000a3'),
  false, 'activity: request insert on a setup project is not a plan change');

select public.update_payment_request('00000000-0000-0000-0000-0000000000c1', '{"amount": 1200}'::jsonb);
select public.update_payment_request('00000000-0000-0000-0000-0000000000c1', '{"title": "Deposit (renamed)"}'::jsonb);
select is(
  (select array_agg(plan_change order by created_at) from public.activity where entity = 'payment_request' and entity_id = '00000000-0000-0000-0000-0000000000c1' and action = 'updated'),
  array[true, false], 'activity: amount change is a plan change, title change is not');

select ok(
  (select count(*) = 2 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('payments', 'payment_requests')),
  'publication includes payments and payment_requests');

select * from finish();
rollback;
