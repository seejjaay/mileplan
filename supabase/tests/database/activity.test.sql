begin;
select plan(15);

-- Fixtures (as postgres)
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1 active', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'P3 setup', 'setup'),
  ('00000000-0000-0000-0000-0000000000a4', 'P4 to delete', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'));
insert into public.milestones (id, project_id, title, due_date, status, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'M1', '2026-12-01', 'planned', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'M2 in review', '2026-12-10', 'in_review', 2),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3', 'M3 setup', '2026-12-01', 'planned', 1),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4', 'M4 doomed', '2026-12-01', 'planned', 1);
insert into public.tasks (id, milestone_id, title) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'T1');

select tests.authenticate_as(tests.get_user('admin@mileplan.test'));

-- 1. due date change: diff, reason, plan_change, actor
select set_config('mileplan.reason', 'client asked', true);
update public.milestones set due_date = '2026-12-15' where id = '00000000-0000-0000-0000-0000000000b1';

select is(
  (select changes -> 'due_date' from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  '["2026-12-01", "2026-12-15"]'::jsonb, 'milestone due_date change logs the diff');
select is(
  (select reason from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  'client asked', 'milestone due_date change logs the reason');
select is(
  (select plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  true, 'due_date change on an active project is a plan change');
select is(
  (select actor_id from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  tests.get_user('admin@mileplan.test'), 'activity records the acting user');

-- 2. setup project: not a plan change
update public.milestones set due_date = '2026-12-20' where id = '00000000-0000-0000-0000-0000000000b3';
select is(
  (select plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b3' and action = 'updated' order by created_at desc limit 1),
  false, 'setup project change is not a plan change');

-- 3. insert and delete on an active project are plan changes
insert into public.milestones (id, project_id, title) values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000a1', 'M9 new');
select is(
  (select plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b9' and action = 'created'),
  true, 'milestone insert is a plan change');
delete from public.milestones where id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b9' and action = 'deleted'),
  true, 'milestone delete is a plan change');

-- 4. task status change
update public.tasks set status = 'done' where id = '00000000-0000-0000-0000-0000000000e1';
select results_eq(
  $$select action::text, plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000e1' and action = 'status_changed'$$,
  $$values ('status_changed', false)$$, 'task status change logs status_changed, not plan_change');

-- 5. position-only update is not logged
select set_config('t.cnt', (select count(*) from public.activity)::text, true);
update public.milestones set position = 5 where id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select count(*) from public.activity)::text, current_setting('t.cnt'),
  'position-only update is not logged');

-- 6. reason does not leak into the next edit
select set_config('mileplan.reason', '', true);
update public.milestones set title = 'M1 renamed' where id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select reason from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  null, 'reason does not leak to next edit');

-- 7. approval only from in_review
select throws_ok(
  $$update public.milestones set status = 'approved' where id = '00000000-0000-0000-0000-0000000000b1'$$,
  'P0001', null, 'approve is rejected from planned');
select lives_ok(
  $$update public.milestones set status = 'approved' where id = '00000000-0000-0000-0000-0000000000b2'$$,
  'approve is allowed from in_review');
select is(
  (select approved_by from public.milestones where id = '00000000-0000-0000-0000-0000000000b2'),
  tests.get_user('admin@mileplan.test'), 'approval stamps approved_by');

-- 8. clients still cannot write activity
select tests.clear_auth();
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok(
  $$insert into public.activity (project_id, actor_id, entity, entity_id, action) values ('00000000-0000-0000-0000-0000000000a1', null, 'project', gen_random_uuid(), 'created')$$,
  '42501', null, 'client still cannot insert activity');

-- 9. deleting a project (cascade) must not fail on the audit FK
select tests.clear_auth();
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select lives_ok($$delete from public.projects where id = '00000000-0000-0000-0000-0000000000a4'$$, 'deleting a project with milestones does not fail');

select * from finish();
rollback;
