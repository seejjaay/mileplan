begin;
select plan(33);

do $$ begin perform tests.create_user('cara@client-c.test'); end $$;

-- Fixtures (as postgres) ---------------------------------------------------------------------------------
-- P1 is built while still in setup, so none of this notifies anyone, then activated. P2 stays in setup.
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'setup'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'setup');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('cara@client-c.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.milestones (id, project_id, title, status, due_date) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Discovery', 'in_progress', '2027-01-01'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Build', 'in_progress', '2027-02-01');
insert into public.payment_requests (id, project_id, title, amount, due_date) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Deposit', 35000, '2027-01-01'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Final', 35000, '2027-03-01');
update public.projects set status = 'active' where id = '00000000-0000-0000-0000-0000000000a1';
delete from public.notifications;

-- ------------------------------------------------------------------------------------ milestone in review
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
update public.milestones set status = 'in_review' where id = '00000000-0000-0000-0000-0000000000b1';
select tests.clear_auth();
select is(
  (select count(*)::int from public.notifications
   where kind = 'milestone_in_review' and needs_action and read_at is null
     and recipient_id in (tests.get_user('ana@client-a.test'), tests.get_user('cara@client-c.test'))),
  2, 'in_review notifies every client member, needs action');
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('admin@mileplan.test')), 0,
  'the admin who moved the milestone is not notified');

-- ------------------------------------------------------------------------------------------- updates
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'), E'\n\n' || repeat('x', 120) || E'\nsecond');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'update_posted' and recipient_id = tests.get_user('admin@mileplan.test')), 0,
  'actor is never notified');
select is((select count(*)::int from public.notifications where kind = 'update_posted' and recipient_id = tests.get_user('ana@client-a.test')), 1,
  'the client is told about the update');
select is((select data ->> 'snippet' from public.notifications where kind = 'update_posted' and recipient_id = tests.get_user('ana@client-a.test')),
  repeat('x', 80), 'update snippet is the first line cut to 80');
select is((select data ->> 'actor_name' from public.notifications where kind = 'update_posted' and recipient_id = tests.get_user('ana@client-a.test')),
  'admin', 'update carries the author''s name');

-- ----------------------------------------------------------------------------------------- approval
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.milestone_reviews (milestone_id, user_id, decision, comment) values
  ('00000000-0000-0000-0000-0000000000b1', tests.get_user('ana@client-a.test'), 'approved', 'Looks good');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'milestone_in_review' and read_at is null), 0,
  'one member''s approval clears in_review for every member');
select is(
  (select data ->> 'client_name' from public.notifications
   where kind = 'milestone_approved' and recipient_id = tests.get_user('admin@mileplan.test') and not needs_action),
  'ana', 'the admin is told the client approved');

-- ------------------------------------------------------------------------------- changes requested
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
update public.milestones set status = 'in_review' where id = '00000000-0000-0000-0000-0000000000b2';
select tests.authenticate_as(tests.get_user('cara@client-c.test'));
insert into public.milestone_reviews (milestone_id, user_id, decision, comment) values
  ('00000000-0000-0000-0000-0000000000b2', tests.get_user('cara@client-c.test'), 'changes_requested', 'Fix the header');
select tests.clear_auth();
select is(
  (select count(*)::int from public.notifications
   where kind = 'changes_requested' and needs_action and read_at is null and recipient_id = tests.get_user('admin@mileplan.test')),
  1, 'changes requested stays open through the client''s own status change');
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
update public.milestones set status = 'in_review' where id = '00000000-0000-0000-0000-0000000000b2';
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'changes_requested' and read_at is null), 0,
  'changes requested clears when the admin moves the milestone');

-- ---------------------------------------------------------------------------------------- payments
delete from public.notifications;
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.payments (project_id, request_id, amount, status, submitted_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 35000, 'pending', tests.get_user('ana@client-a.test'));
select tests.clear_auth();
select is(
  (select count(*)::int from public.notifications
   where kind = 'payment_proof' and needs_action and read_at is null and recipient_id = tests.get_user('admin@mileplan.test')),
  1, 'a payment proof asks the admin to confirm it');
select is(
  (select data ->> 'request_title' || ' / ' || (data ->> 'client_name') from public.notifications where kind = 'payment_proof'),
  'Deposit / ana', 'the proof names the request and the client');
select is((select count(*)::int from public.notifications where kind = 'payment_proof' and recipient_id <> tests.get_user('admin@mileplan.test')), 0,
  'clients are not told about proofs');
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select public.review_payment((select id from public.payments where request_id = '00000000-0000-0000-0000-0000000000c1'), 'confirmed');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'payment_proof' and read_at is null), 0,
  'confirming the payment clears the admin''s proof notification');
select is((select count(*)::int from public.notifications where kind = 'payment_confirmed' and not needs_action and read_at is null), 2,
  'every client member is told the payment was confirmed');

delete from public.notifications;
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.payments (project_id, request_id, amount, status, submitted_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 35000, 'pending', tests.get_user('ana@client-a.test'));
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select public.review_payment((select id from public.payments where request_id = '00000000-0000-0000-0000-0000000000c2' and status = 'pending'), 'rejected', 'wrong amount');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'payment_rejected' and needs_action and read_at is null), 2,
  'a rejected proof needs action from every client member');
select is((select data ->> 'note' from public.notifications where kind = 'payment_rejected' and recipient_id = tests.get_user('ana@client-a.test')),
  'wrong amount', 'the rejection carries its note');
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.payments (project_id, request_id, amount, status, submitted_by) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 35000, 'pending', tests.get_user('ana@client-a.test'));
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'payment_rejected' and read_at is null), 0,
  'a new proof for that request clears the rejection');

-- ---------------------------------------------------------------------------------------- plan changes
delete from public.notifications;
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'Extra 1');
insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'Extra 2');
insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'Extra 3');
select tests.clear_auth();
select is(
  (select count from public.notifications where kind = 'plan_change' and read_at is null and recipient_id = tests.get_user('ana@client-a.test')),
  3, 'plan changes collapse into one row with a count');
select is((select count(*)::int from public.notifications where kind = 'plan_change' and recipient_id = tests.get_user('ana@client-a.test')), 1,
  'there is only one plan_change row per client');

delete from public.notifications;
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select public.add_payment_request('00000000-0000-0000-0000-0000000000a1', 'Extra', 1000, '2027-04-01');
select tests.clear_auth();
select is((select array_agg(distinct kind::text) from public.notifications where recipient_id = tests.get_user('ana@client-a.test')),
  array['plan_change'], 'a new payment request is only a plan change');

-- ------------------------------------------------------------------------------------------- acks
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.plan_change_acks (activity_id, user_id)
  select id, tests.get_user('ana@client-a.test') from public.activity
  where project_id = '00000000-0000-0000-0000-0000000000a1' and plan_change;
select tests.clear_auth();
select is((select count(*)::int from public.notifications where kind = 'plan_change_acked' and recipient_id = tests.get_user('admin@mileplan.test')), 1,
  'acks collapse into one row per client');
select is(
  (select count from public.notifications where kind = 'plan_change_acked'),
  (select count(*)::int from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1' and plan_change),
  'the ack row counts every change acknowledged');
select is((select read_at is not null from public.notifications where kind = 'plan_change' and recipient_id = tests.get_user('ana@client-a.test')), true,
  'acknowledging everything clears the client''s plan_change');
select is((select read_at is null from public.notifications where kind = 'plan_change' and recipient_id = tests.get_user('cara@client-c.test')), true,
  'another member''s plan_change stays open');

-- -------------------------------------------------------------------------- who is skipped, new rows
delete from public.notifications;
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('admin@mileplan.test'), 'Setup note');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('ben@client-b.test')), 0,
  'setup projects notify nobody');

update public.profiles set active = false where id = tests.get_user('cara@client-c.test');
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'), 'First');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('cara@client-c.test')), 0,
  'inactive clients are skipped');
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('ana@client-a.test') and kind = 'update_posted'), 1,
  'active clients still get the update');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select public.mark_all_notifications_read();
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.updates (project_id, author_id, body) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('admin@mileplan.test'), 'Second');
select tests.clear_auth();
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('ana@client-a.test') and kind = 'update_posted'), 2,
  'a read row starts a new one for the next event');
select is((select count(*)::int from public.notifications where recipient_id = tests.get_user('ana@client-a.test') and kind = 'update_posted' and read_at is null), 1,
  'only the new row is unread');

-- ------------------------------------------------------------------ one client, two projects (plan changes)
-- plan_change and plan_change_acked are per project: a change in one project must not merge into, or be cleared
-- by, another project's row.
delete from public.notifications;
insert into public.projects (id, title, status) values ('00000000-0000-0000-0000-0000000000a3', 'P3', 'setup');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test'));
update public.projects set status = 'active' where id = '00000000-0000-0000-0000-0000000000a3';
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'Cross 1');
insert into public.milestones (project_id, title) values ('00000000-0000-0000-0000-0000000000a3', 'Cross 3');
select tests.clear_auth();
select is(
  (select array_agg(project_id order by project_id) from public.notifications where kind = 'plan_change' and read_at is null and recipient_id = tests.get_user('ana@client-a.test')),
  array['00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000a3'::uuid],
  'a client in two projects gets one plan_change row per project');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.plan_change_acks (activity_id, user_id)
  select a.id, tests.get_user('ana@client-a.test') from public.activity a
  where a.project_id = '00000000-0000-0000-0000-0000000000a1' and a.plan_change
    and not exists (select 1 from public.plan_change_acks k where k.activity_id = a.id and k.user_id = tests.get_user('ana@client-a.test'));
select tests.clear_auth();
select is(
  (select array_agg(project_id) from public.notifications where kind = 'plan_change' and read_at is null and recipient_id = tests.get_user('ana@client-a.test')),
  array['00000000-0000-0000-0000-0000000000a3'::uuid],
  'acknowledging one project clears only that project''s plan_change');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
insert into public.plan_change_acks (activity_id, user_id)
  select a.id, tests.get_user('ana@client-a.test') from public.activity a
  where a.project_id = '00000000-0000-0000-0000-0000000000a3' and a.plan_change
    and not exists (select 1 from public.plan_change_acks k where k.activity_id = a.id and k.user_id = tests.get_user('ana@client-a.test'));
select tests.clear_auth();
select is(
  (select array_agg(project_id order by project_id) from public.notifications where kind = 'plan_change_acked' and recipient_id = tests.get_user('admin@mileplan.test')),
  array['00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-0000000000a3'::uuid],
  'acks in two projects give the admin one row per project');

select * from finish();
rollback;
