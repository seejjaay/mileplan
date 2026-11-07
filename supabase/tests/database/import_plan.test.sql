begin;
select plan(62);

-- Fixtures (as postgres) ---------------------------------------------------------------------------------
-- PS: an empty setup project.  PX: an active project that already has keyed rows and payments.
-- PC: a closed project.
insert into public.projects (id, title, status, currency) values
  ('00000000-0000-0000-0000-0000000000a1', 'PS', 'setup', 'PHP'),
  ('00000000-0000-0000-0000-0000000000a2', 'PX', 'active', 'PHP'),
  ('00000000-0000-0000-0000-0000000000a3', 'PC', 'completed', 'PHP');
update public.projects set closed_at = now() where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'));

insert into public.milestones (id, project_id, position, title, due_date, plan_key) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 1, 'K1', '2026-12-01', 'k1');
insert into public.payment_requests (id, project_id, milestone_id, title, amount, due_date, plan_key) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'R1', 1000, '2026-12-01', 'r1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', null, 'R2', 300, '2026-12-01', 'r2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a2', null, 'R3', 50, '2026-12-01', 'r3');
insert into public.payments (project_id, request_id, amount, status) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 400, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', 100, 'pending');

-- Plan builders (callable by the authenticated role; rolled back with the test).
create function public.t_base() returns jsonb language sql as $$ select $j$
{ "schema_version": 1,
  "project": { "title": "Imported", "currency": "PHP" },
  "milestones": [
    { "key": "m1", "title": "Discovery", "due_date": "2026-12-01", "amount": 1000,
      "acceptance_criteria": ["Wireframes approved"], "tasks": ["Kickoff", "Sitemap"] },
    { "key": "m2", "title": "Build", "due_date": "2026-12-15", "amount": 2000, "tasks": ["Build it"] } ],
  "payments": [ { "key": "p1", "title": "Deposit", "amount": 500, "due_date": "2026-11-30", "milestone": "m1" } ] }
$j$::jsonb $$;
create function public.t_with(p_path text[], p_value jsonb) returns jsonb language sql as $$
  select jsonb_set(public.t_base(), p_path, p_value) $$;
create function public.t_without(p_path text[]) returns jsonb language sql as $$
  select public.t_base() #- p_path $$;
-- Errors of a dry run against the empty setup project.
create function public.t_errs(p_plan jsonb) returns jsonb language sql as $$
  select public.import_plan('00000000-0000-0000-0000-0000000000a1', p_plan, true) -> 'errors' $$;
-- A revision of t_base: m2 dropped, m3 added, a task swapped, a due date moved, one amount changed, one payment added.
create function public.t_v1() returns jsonb language sql as $$ select $j$
{ "schema_version": 1,
  "project": { "title": "Imported v2" },
  "milestones": [
    { "key": "m1", "title": "Discovery", "due_date": "2026-12-02", "amount": 1000,
      "acceptance_criteria": ["Wireframes approved"], "tasks": ["Kickoff", "Wireframes"] },
    { "key": "m3", "title": "Launch", "due_date": "2027-01-10", "amount": 500, "tasks": ["Go live"] } ],
  "payments": [
    { "key": "p1", "title": "Deposit", "amount": 600, "due_date": "2026-11-30", "milestone": "m1" },
    { "key": "p2", "title": "Final", "amount": 900, "due_date": "2027-01-10", "milestone": "m3" } ] }
$j$::jsonb $$;
-- t_v1 with m3 moved ahead of m1.
create function public.t_v2() returns jsonb language sql as $$ select $j$
{ "schema_version": 1,
  "milestones": [
    { "key": "m3", "title": "Launch", "due_date": "2026-12-01", "amount": 500, "tasks": ["Go live"] },
    { "key": "m1", "title": "Discovery", "due_date": "2026-12-02", "amount": 1000,
      "acceptance_criteria": ["Wireframes approved"], "tasks": ["Kickoff", "Wireframes"] } ],
  "project": { "title": "Imported v2" },
  "payments": [
    { "key": "p1", "title": "Deposit", "amount": 600, "due_date": "2026-11-30", "milestone": "m1" },
    { "key": "p2", "title": "Final", "amount": 900, "due_date": "2027-01-10", "milestone": "m3" } ] }
$j$::jsonb $$;
-- PX plan that matches its rows; the state checks vary it.
create function public.t_px() returns jsonb language sql as $$ select $j$
{ "schema_version": 1,
  "project": { "title": "PX" },
  "milestones": [ { "key": "k1", "title": "K1", "due_date": "2026-12-01" } ],
  "payments": [
    { "key": "r1", "title": "R1", "amount": 1000, "due_date": "2026-12-01", "milestone": "k1" },
    { "key": "r2", "title": "R2", "amount": 300, "due_date": "2026-12-01" },
    { "key": "r3", "title": "R3", "amount": 50, "due_date": "2026-12-01" } ] }
$j$::jsonb $$;

create table public.t_counts (name text primary key, n bigint);
grant select, insert on public.t_counts to authenticated;

-- ---------------------------------------------------------------- client
select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select throws_ok(
  $$select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true)$$,
  '42501', null, 'import_plan: a client is denied a dry run');
select throws_ok(
  $$select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), false)$$,
  '42501', null, 'import_plan: a client is denied an apply');

-- ----------------------------------------------------------------- admin: validation
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));

select is(public.t_errs(public.t_with('{extra}', '1')),
  '[{"path":"extra","message":"is not a known field"}]'::jsonb, 'import_plan: unknown top-level key is reported');
select is(public.t_errs(public.t_without('{schema_version}')),
  '[{"path":"schema_version","message":"is required"}]'::jsonb, 'import_plan: schema_version is required');
select is(public.t_errs(public.t_without('{project,title}')),
  '[{"path":"project.title","message":"is required"}]'::jsonb, 'import_plan: project.title is required');
select is(public.t_errs(public.t_with('{project,currency}', '"php"')),
  '[{"path":"project.currency","message":"must be 3 uppercase letters, like PHP"}]'::jsonb, 'import_plan: lowercase currency is reported');
select is(public.t_errs(public.t_with('{project}', '{"title":"x","start_date":"2026-12-10","end_date":"2026-12-01"}')),
  '[{"path":"project.end_date","message":"is before project.start_date"}]'::jsonb, 'import_plan: project end before start is reported');
select is(public.t_errs(public.t_with('{milestones}', '[]') #- '{payments}'),
  '[{"path":"milestones","message":"needs at least 1 item"}]'::jsonb, 'import_plan: an empty milestones array is reported');
select is(public.t_errs(public.t_with('{milestones,0,key}', '"Bad Key"') #- '{payments}'),
  '[{"path":"milestones[0].key","message":"must be lowercase letters, digits, - or _ (1-40 characters)"}]'::jsonb, 'import_plan: a malformed key is reported');
select is(public.t_errs(public.t_with('{milestones,1,key}', '"m1"')),
  '[{"path":"milestones[1].key","message":"duplicates milestones[0].key"}]'::jsonb, 'import_plan: a duplicate key is reported');
select is(public.t_errs(public.t_with('{milestones,1,due_date}', '"2026-11-01"')),
  '[{"path":"milestones[1].due_date","message":"is before milestones[0].due_date"}]'::jsonb, 'import_plan: due dates out of order are reported');
select is(public.t_errs(public.t_without('{milestones,0,due_date}')),
  '[{"path":"milestones[0].due_date","message":"is required"}]'::jsonb, 'import_plan: a missing due_date is reported');
select is(public.t_errs(public.t_with('{milestones,0,due_date}', '"2026-02-30"')),
  '[{"path":"milestones[0].due_date","message":"is not a real date"}]'::jsonb, 'import_plan: an impossible date is reported');
select is(public.t_errs(public.t_with('{milestones,0,amount}', '-1')),
  '[{"path":"milestones[0].amount","message":"must be 0 or more"}]'::jsonb, 'import_plan: a negative amount is reported');
select is(public.t_errs(public.t_with('{milestones,0,amount}', '10.005')),
  '[{"path":"milestones[0].amount","message":"can have at most 2 decimals"}]'::jsonb, 'import_plan: a three-decimal amount is reported');
select is(public.t_errs(public.t_with('{milestones,0,tasks}', '["Kickoff", "Kickoff"]')),
  '[{"path":"milestones[0].tasks[1]","message":"duplicates milestones[0].tasks[0]"}]'::jsonb, 'import_plan: a duplicate task is reported');
select is(public.t_errs(public.t_with('{milestones,0,acceptance_criteria}', '["ok", " "]')),
  '[{"path":"milestones[0].acceptance_criteria[1]","message":"must not be empty"}]'::jsonb, 'import_plan: a blank criterion is reported');
select is(public.t_errs(public.t_with('{milestones,0,status}', '"approved"')),
  '[{"path":"milestones[0].status","message":"is not a known field"}]'::jsonb, 'import_plan: a plan cannot set milestone status');
select is(public.t_errs(public.t_with('{payments,0,milestone}', '"nope"')),
  '[{"path":"payments[0].milestone","message":"\"nope\" is not a milestone key in this plan"}]'::jsonb, 'import_plan: a payment naming a missing milestone is reported');
select is(public.t_errs(public.t_with('{payments,0,amount}', '0')),
  '[{"path":"payments[0].amount","message":"must be greater than 0"}]'::jsonb, 'import_plan: a zero payment amount is reported');
select is(public.t_errs('[1]'::jsonb),
  '[{"path":"$","message":"must be a JSON object"}]'::jsonb, 'import_plan: a non-object plan is reported');
select is(public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true) ->> 'valid',
  'true', 'import_plan: the base plan is valid');

-- ----------------------------------------------------------------- closed project
select is(public.import_plan('00000000-0000-0000-0000-0000000000a3', public.t_base(), true) -> 'errors' -> 0 ->> 'path',
  'project', 'import_plan: a dry run on a closed project reports it');
select throws_ok(
  $$select public.import_plan('00000000-0000-0000-0000-0000000000a3', public.t_base(), false)$$,
  'MP001', null, 'import_plan: an apply on a closed project is refused');

-- ----------------------------------------------------------------- dry run writes nothing
select is(
  jsonb_array_length(public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true) -> 'milestones' -> 'added'),
  2, 'import_plan: a dry run on an empty project lists both milestones as added');
select is(
  (select count(*) from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1')
  + (select count(*) from public.payment_requests where project_id = '00000000-0000-0000-0000-0000000000a1')
  + (select count(*) from public.tasks where project_id = '00000000-0000-0000-0000-0000000000a1')
  + (select count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1' and entity <> 'project'),
  0::bigint, 'import_plan: a dry run writes nothing');

-- ----------------------------------------------------------------- invalid apply rolls back
select throws_ok(
  format($f$select public.import_plan('00000000-0000-0000-0000-0000000000a1', %L::jsonb, false)$f$,
    public.t_with('{payments,0,milestone}', '"nope"')::text),
  '22023', null, 'import_plan: an invalid apply is refused when only the last rule fails');
select is(
  (select count(*) from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1')
  + (select count(*) from public.payment_requests where project_id = '00000000-0000-0000-0000-0000000000a1'),
  0::bigint, 'import_plan: a refused apply leaves nothing behind');

-- ----------------------------------------------------------------- setup import
select is(public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), false) ->> 'applied',
  'true', 'import_plan: a setup import applies');
select is(
  (select array_agg(plan_key order by position) from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1'),
  array['m1', 'm2'], 'import_plan: milestones are stored with their keys in plan order');
select is(
  (select array_agg(t.title order by t.position) from public.tasks t join public.milestones m on m.id = t.milestone_id
    where m.project_id = '00000000-0000-0000-0000-0000000000a1' and m.plan_key = 'm1'),
  array['Kickoff', 'Sitemap'], 'import_plan: tasks are stored in plan order');
select is(
  (select count(*) from public.payment_requests pr join public.milestones m on m.id = pr.milestone_id
    where pr.project_id = '00000000-0000-0000-0000-0000000000a1' and pr.plan_key = 'p1' and m.plan_key = 'm1' and pr.amount = 500),
  1::bigint, 'import_plan: the payment request is stored against its milestone');
select is(
  (select title from public.projects where id = '00000000-0000-0000-0000-0000000000a1'),
  'Imported', 'import_plan: project fields are applied');
select is(
  (select count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1' and plan_change),
  0::bigint, 'import_plan: a setup import logs no plan changes');

-- ----------------------------------------------------------------- identical re-import
select is(
  (select r -> 'milestones' -> 'added' || (r -> 'milestones' -> 'changed') || (r -> 'milestones' -> 'removed')
          || (r -> 'payments' -> 'added') || (r -> 'payments' -> 'changed') || (r -> 'payments' -> 'removed')
   from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true) r) x),
  '[]'::jsonb, 'import_plan: re-importing the same plan has an empty diff');
select is(
  (select r -> 'project' -> 'changes' from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true) r) x),
  '{}'::jsonb, 'import_plan: re-importing the same plan changes no project fields');
select is(
  (select r -> 'milestones' -> 'reordered' from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), true) r) x),
  'false'::jsonb, 'import_plan: re-importing the same plan is not a reorder');
insert into public.t_counts select 'activity', count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1';
select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_base(), false);
select is(
  (select count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1'),
  (select n from public.t_counts where name = 'activity'), 'import_plan: applying the same plan again logs no activity');

-- ----------------------------------------------------------------- re-import on an active project
-- A milestone added by hand has no key: an import never touches it.
select public.add_milestone('00000000-0000-0000-0000-0000000000a1', '{"title":"Manual milestone"}');
select public.activate_project('00000000-0000-0000-0000-0000000000a1');
-- Work that must survive: a Done task, and a milestone that is in progress and on hold.
update public.tasks set status = 'done'
  where title = 'Kickoff' and project_id = '00000000-0000-0000-0000-0000000000a1';
update public.milestones set status = 'in_progress', on_hold = true
  where plan_key = 'm1' and project_id = '00000000-0000-0000-0000-0000000000a1';

select is(
  (select r -> 'milestones' -> 'changed' -> 0 -> 'changes' -> 'due_date'
   from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), true) r) x),
  '["2026-12-01","2026-12-02"]'::jsonb, 'import_plan: the diff reports a changed due date as [old, new]');
select is(
  (select r -> 'milestones' -> 'changed' -> 0 -> 'tasks'
   from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), true) r) x),
  '{"added":["Wireframes"],"removed":["Sitemap"],"reordered":false}'::jsonb, 'import_plan: the diff reports tasks added and removed by title');
select is(
  (select r -> 'milestones' -> 'removed' from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), true) r) x),
  '[{"key":"m2","title":"Build"}]'::jsonb, 'import_plan: the diff reports a removed keyed milestone');
select is(
  (select r -> 'milestones' -> 'kept' from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), true) r) x),
  '[{"title":"Manual milestone"}]'::jsonb, 'import_plan: the diff lists an unkeyed milestone as kept');
select is(
  (select r -> 'payments' -> 'changed' -> 0 -> 'changes' -> 'amount'
   from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), true) r) x),
  '[500, 600]'::jsonb, 'import_plan: the diff reports a changed payment amount');

select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v1(), false, 'SOW revised');

select is(
  (select status::text from public.tasks where title = 'Kickoff' and project_id = '00000000-0000-0000-0000-0000000000a1'),
  'done', 'import_plan: a Done task with the same title keeps its status');
select is(
  (select status::text || on_hold::text from public.milestones where plan_key = 'm1' and project_id = '00000000-0000-0000-0000-0000000000a1'),
  'in_progresstrue', 'import_plan: milestone status and hold are untouched');
select is(
  (select array_agg(t.title order by t.position) from public.tasks t join public.milestones m on m.id = t.milestone_id
    where m.plan_key = 'm1' and m.project_id = '00000000-0000-0000-0000-0000000000a1'),
  array['Kickoff', 'Wireframes'], 'import_plan: tasks follow the plan after a re-import');
select is(
  (select array_agg(coalesce(plan_key, title) order by position) from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1'),
  array['m1', 'm3', 'Manual milestone'], 'import_plan: plan milestones come first, kept ones follow');
select is(
  (select count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1' and plan_change),
  5::bigint, 'import_plan: an active import logs one plan change per milestone or request change');
select is(
  (select count(*) from public.activity where project_id = '00000000-0000-0000-0000-0000000000a1' and plan_change and reason is distinct from 'SOW revised'),
  0::bigint, 'import_plan: every plan change carries the shared reason');
select is(
  (select r -> 'milestones' -> 'reordered' from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v2(), true) r) x),
  'true'::jsonb, 'import_plan: moving a milestone sets reordered');
select is(
  (select jsonb_array_length(r -> 'milestones' -> 'changed') from (select public.import_plan('00000000-0000-0000-0000-0000000000a1', public.t_v2(), true) r) x),
  1, 'import_plan: a reorder lists only the milestones whose fields differ');

-- ----------------------------------------------------------------- state checks (PX)
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2',
    (public.t_px() || '{"milestones":[{"key":"n1","title":"N1","due_date":"2026-12-01"}]}') #- '{payments,0,milestone}', true) -> 'errors' -> 0 ->> 'path',
  'milestones.k1', 'import_plan: removing a milestone with confirmed payments is blocked');
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', public.t_px() #- '{payments,1}', true) -> 'errors' -> 0 ->> 'path',
  'payments.r2', 'import_plan: removing a request with a pending payment is blocked');
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', jsonb_set(public.t_px(), '{payments,0,amount}', '300'), true) -> 'errors' -> 0 ->> 'path',
  'payments[0].amount', 'import_plan: dropping a request below its confirmed total is blocked');
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', jsonb_set(public.t_px(), '{project,currency}', '"USD"'), true) -> 'errors' -> 0 ->> 'path',
  'project.currency', 'import_plan: changing currency with payment requests is blocked');
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', public.t_px(), true) ->> 'valid',
  'true', 'import_plan: the matching PX plan is valid');
select throws_ok(
  format($f$select public.import_plan('00000000-0000-0000-0000-0000000000a2', %L::jsonb, false)$f$,
    (public.t_px() #- '{payments,1}')::text),
  '22023', null, 'import_plan: a blocked apply is refused');

-- Preview, then a proof arrives, then the apply: it re-validates and writes nothing.
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', public.t_px() #- '{payments,2}', true) ->> 'valid',
  'true', 'import_plan: removing an untouched request previews as valid');
select tests.clear_auth();
insert into public.payments (project_id, request_id, amount, status) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c3', 10, 'pending');
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select throws_ok(
  format($f$select public.import_plan('00000000-0000-0000-0000-0000000000a2', %L::jsonb, false)$f$,
    (public.t_px() #- '{payments,2}')::text),
  '22023', null, 'import_plan: an apply after a proof arrived is refused');
select is(
  (select count(*) from public.payment_requests where plan_key = 'r3' and project_id = '00000000-0000-0000-0000-0000000000a2'),
  1::bigint, 'import_plan: the refused apply left the request in place');

-- Removing a request with only a rejected payment, and a milestone with none, is allowed.
select tests.clear_auth();
update public.payments set status = 'rejected' where request_id = '00000000-0000-0000-0000-0000000000c3';
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select is(
  public.import_plan('00000000-0000-0000-0000-0000000000a2', public.t_px() #- '{payments,2}', false) ->> 'applied',
  'true', 'import_plan: a request with only a rejected payment can be removed');
select is(
  (select count(*) from public.payment_requests where plan_key = 'r3' and project_id = '00000000-0000-0000-0000-0000000000a2'),
  0::bigint, 'import_plan: the request is gone after the apply');

select * from finish();
rollback;
