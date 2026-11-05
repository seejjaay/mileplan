begin;
select plan(12);

-- Fixtures (as postgres)
insert into public.projects (id, title, status) values ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'));
insert into public.milestones (id, project_id, title, status, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'M1', 'in_review', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'M2', 'in_review', 2),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a1', 'M4', 'in_review', 4);

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

-- approve
select set_config('mileplan.reason', 'leaked from somewhere else', true);
select lives_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b1', %L, 'approved')$f$, tests.get_user('ana@client-a.test')),
  'client can approve an in-review milestone');
select is((select status::text from public.milestones where id = '00000000-0000-0000-0000-0000000000b1'), 'approved', 'approval moves the milestone to approved');
select is((select approved_by from public.milestones where id = '00000000-0000-0000-0000-0000000000b1'), tests.get_user('ana@client-a.test'), 'approved_by is the client');

-- request changes
select lives_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision, comment) values ('00000000-0000-0000-0000-0000000000b2', %L, 'changes_requested', 'Logo too small')$f$, tests.get_user('ana@client-a.test')),
  'client can request changes on an in-review milestone');
select is((select status::text from public.milestones where id = '00000000-0000-0000-0000-0000000000b2'), 'in_progress', 'request changes sends the milestone back to in_progress');
select throws_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision, comment) values ('00000000-0000-0000-0000-0000000000b2', %L, 'changes_requested', 'again')$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'a review after the milestone left in_review is denied');
select throws_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision, comment) values ('00000000-0000-0000-0000-0000000000b4', %L, 'changes_requested', '   ')$f$, tests.get_user('ana@client-a.test')),
  '23514', null, 'request changes without a comment fails');

-- audit trail: review and status change, both by the client, no stale reason
select is(
  (select count(*) from public.activity where entity = 'review' and actor_id = tests.get_user('ana@client-a.test')),
  2::bigint, 'both reviews are in activity with the client as actor');
select is(
  (select count(*) from public.activity where entity = 'milestone' and action = 'status_changed' and actor_id = tests.get_user('ana@client-a.test')),
  2::bigint, 'both status changes are in activity with the client as actor');
select is(
  (select reason from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'status_changed'),
  null, 'the status change carries no leaked edit reason');

select throws_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b1', %L, 'approved')$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'a second approval is denied');

-- the trigger itself refuses a review of a milestone that is no longer in_review (concurrent reviewers)
select tests.clear_auth();
select throws_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b1', %L, 'approved')$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'trigger refuses to apply a review to a milestone that is not in review');

select * from finish();
rollback;
