begin;
select plan(39);

-- Fixtures (as postgres)
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1 crud', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2 other', 'active'),
  ('00000000-0000-0000-0000-0000000000a5', 'P5 setup', 'setup'),
  ('00000000-0000-0000-0000-0000000000a6', 'P6 completed', 'completed'),
  ('00000000-0000-0000-0000-0000000000a7', 'P7 split', 'active'),
  ('00000000-0000-0000-0000-0000000000a8', 'P8 merge', 'active'),
  ('00000000-0000-0000-0000-0000000000a9', 'P9 nonadjacent', 'active');
insert into public.milestones (id, project_id, title, position, amount) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'M1', 1, 1000),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'M2', 2, 500),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'M3', 3, 200),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a7', 'S1', 1, 1000),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a7', 'S2', 2, 100),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a8', 'G1', 1, 100),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a8', 'G2', 2, 50),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a8', 'G3', 3, 10),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a9', 'N1', 1, 1),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a9', 'N2', 2, 1),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a9', 'N3', 3, 1),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'X1', 1, 1);
insert into public.tasks (id, milestone_id, title, position) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000b1', 'T1', 1),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000b1', 'T2', 2),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-0000000000b2', 'T3', 1),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000c1', 'S-a', 1),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-0000000000c1', 'S-b', 2),
  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-0000000000c1', 'S-c', 3),
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000000d1', 'G-a', 1),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000000d2', 'G-b', 1);

-- Clients get 42501 from every RPC
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok($$select public.activate_project('00000000-0000-0000-0000-0000000000a5')$$, '42501', null, 'client: activate_project denied');
select throws_ok($$select public.add_milestone('00000000-0000-0000-0000-0000000000a1', '{"title":"x"}')$$, '42501', null, 'client: add_milestone denied');
select throws_ok($$select public.update_milestone('00000000-0000-0000-0000-0000000000b1', '{"title":"x"}')$$, '42501', null, 'client: update_milestone denied');
select throws_ok($$select public.delete_milestone('00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'client: delete_milestone denied');
select throws_ok($$select public.reorder_milestones('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, '42501', null, 'client: reorder_milestones denied');
select throws_ok($$select public.reorder_tasks('00000000-0000-0000-0000-0000000000b1', array['00000000-0000-0000-0000-00000000aa01']::uuid[])$$, '42501', null, 'client: reorder_tasks denied');
select throws_ok($$select public.split_milestone('00000000-0000-0000-0000-0000000000c1', array[]::uuid[], 'x', 1)$$, '42501', null, 'client: split_milestone denied');
select throws_ok($$select public.merge_milestones('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')$$, '42501', null, 'client: merge_milestones denied');

select tests.clear_auth();
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));

-- activate_project
select public.activate_project('00000000-0000-0000-0000-0000000000a5');
select is((select status::text from public.projects where id = '00000000-0000-0000-0000-0000000000a5'), 'active', 'activate: setup becomes active');
select isnt((select activated_at from public.projects where id = '00000000-0000-0000-0000-0000000000a5'), null, 'activate: stamps activated_at');
select lives_ok($$select public.activate_project('00000000-0000-0000-0000-0000000000a5')$$, 'activate: twice is a no-op');
select throws_ok($$select public.activate_project('00000000-0000-0000-0000-0000000000a6')$$, '22023', null, 'activate: completed project rejected');

-- add_milestone
select public.add_milestone('00000000-0000-0000-0000-0000000000a1', '{"title":"M-new","amount":300,"acceptance_criteria":["a","b"]}', 'scope added');
select is((select position from public.milestones where title = 'M-new'), 4, 'add_milestone: appended after the last position');
select throws_ok($$select public.add_milestone('00000000-0000-0000-0000-0000000000a1', '{"amount":1}')$$, '22023', null, 'add_milestone: title required');
select throws_ok($$select public.add_milestone('00000000-0000-0000-0000-0000000000a1', '{"title":"x","status":"paid"}')$$, '22023', null, 'add_milestone: unknown key rejected');

-- update_milestone
select throws_ok($$select public.update_milestone('00000000-0000-0000-0000-0000000000b1', '{"project_id":"00000000-0000-0000-0000-0000000000a2"}')$$, '22023', null, 'update_milestone: unknown key rejected');
select lives_ok($$select public.update_milestone('00000000-0000-0000-0000-0000000000b1', '{"amount":1500}', 'bumped scope')$$, 'update_milestone: valid patch applies');
select is((select amount from public.milestones where id = '00000000-0000-0000-0000-0000000000b1'), 1500.00, 'update_milestone: amount changed');
select is(
  (select reason from public.activity where entity_id = '00000000-0000-0000-0000-0000000000b1' and action = 'updated' order by created_at desc limit 1),
  'bumped scope', 'update_milestone: reason lands on the activity row');

-- delete_milestone closes the gap
select public.delete_milestone('00000000-0000-0000-0000-0000000000b2');
select is((select position from public.milestones where id = '00000000-0000-0000-0000-0000000000b3'), 2, 'delete_milestone: later positions shift down');

-- reorder_milestones (P1 now: M1=1, M3=2, M-new=3)
select public.reorder_milestones('00000000-0000-0000-0000-0000000000a1', array[
  (select id from public.milestones where title = 'M-new'),
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b3']::uuid[]);
select results_eq(
  $$select title from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1' order by position$$,
  $$values ('M-new'::text), ('M1'), ('M3')$$, 'reorder_milestones: positions follow the id list');
select throws_ok($$select public.reorder_milestones('00000000-0000-0000-0000-0000000000a1', array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b3']::uuid[])$$, '22023', null, 'reorder_milestones: stale id list rejected');
select results_eq(
  $$select title from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a1' order by position$$,
  $$values ('M-new'::text), ('M1'), ('M3')$$, 'reorder_milestones: positions unchanged after rejection');

-- reorder_tasks
select public.reorder_tasks('00000000-0000-0000-0000-0000000000b1', array['00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-00000000aa01']::uuid[]);
select results_eq(
  $$select title from public.tasks where milestone_id = '00000000-0000-0000-0000-0000000000b1' order by position$$,
  $$values ('T2'::text), ('T1')$$, 'reorder_tasks: positions follow the id list');

-- split_milestone (S1 1000 with 3 tasks; S2 follows)
select throws_ok($$select public.split_milestone('00000000-0000-0000-0000-0000000000c1', array['00000000-0000-0000-0000-00000000bb01']::uuid[], 'S1b', 1000.01)$$, '22023', null, 'split: amount over original rejected');
select is((select amount from public.milestones where id = '00000000-0000-0000-0000-0000000000c1'), 1000.00, 'split: nothing changed after rejection');
select throws_ok($$select public.split_milestone('00000000-0000-0000-0000-0000000000c1', array['00000000-0000-0000-0000-00000000aa01']::uuid[], 'S1b', 100)$$, '22023', null, 'split: foreign task rejected');
select public.split_milestone('00000000-0000-0000-0000-0000000000c1', array['00000000-0000-0000-0000-00000000bb02','00000000-0000-0000-0000-00000000bb03']::uuid[], 'S1b', 400, 'split for phasing');
select is((select position from public.milestones where title = 'S1b'), 2, 'split: new milestone sits right after the original');
select is((select amount from public.milestones where id = '00000000-0000-0000-0000-0000000000c1'), 600.00, 'split: original keeps the remainder');
select is((select count(*) from public.tasks where milestone_id = (select id from public.milestones where title = 'S1b')), 2::bigint, 'split: chosen tasks moved');
select is((select position from public.milestones where id = '00000000-0000-0000-0000-0000000000c2'), 3, 'split: later milestones shift down');

-- merge_milestones
select public.merge_milestones('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'combined');
select is((select amount from public.milestones where id = '00000000-0000-0000-0000-0000000000d1'), 150.00, 'merge: amounts summed');
select is((select count(*) from public.tasks where milestone_id = '00000000-0000-0000-0000-0000000000d1'), 2::bigint, 'merge: tasks concatenated');
select is((select count(*) from public.milestones where id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint, 'merge: second milestone removed');
select is((select position from public.milestones where id = '00000000-0000-0000-0000-0000000000d3'), 2, 'merge: later positions close the gap');
select throws_ok($$select public.merge_milestones('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3')$$, '22023', null, 'merge: non-adjacent rejected');
select throws_ok($$select public.merge_milestones('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1')$$, '22023', null, 'merge: cross-project rejected');

-- split and merge are plan changes on an active project
select is(
  (select plan_change from public.activity where entity_id = (select id from public.milestones where title = 'S1b') and action = 'created'),
  true, 'split logs a plan change');
select is(
  (select plan_change from public.activity where entity_id = '00000000-0000-0000-0000-0000000000d2' and action = 'deleted'),
  true, 'merge logs a plan change');

select * from finish();
rollback;
