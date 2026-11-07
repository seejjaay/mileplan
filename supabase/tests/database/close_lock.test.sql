begin;
select plan(25);

-- Fixtures (as postgres)
insert into public.projects (id, title, status, activated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active', now()),
  ('00000000-0000-0000-0000-0000000000a3', 'P3 setup', 'setup', null),
  ('00000000-0000-0000-0000-0000000000a4', 'P4 to delete', 'active', now());
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a4', tests.get_user('ana@client-a.test'));
insert into public.milestones (id, project_id, title, status, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'M1', 'in_review', 1),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4', 'M4', 'in_progress', 1);
insert into public.tasks (id, milestone_id, project_id, title, position) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'T1', 1);
insert into public.payment_requests (id, project_id, title, amount, due_date) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Deposit', 100, current_date + 1),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000a4', 'Deposit 4', 100, current_date + 1);
insert into public.payments (project_id, request_id, amount, submitted_by) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c4', 10, tests.get_user('ana@client-a.test'));

-- the lock is attached to every tracker table and to messages
select ok(
  (select count(distinct tgrelid::regclass::text) = 8 from pg_trigger
   where tgname like '%lock_closed%' and not tgisinternal),
  'lock: trigger attached to the seven tracker tables and messages');

-- ----------------------------------------------------------- client cannot close
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok($$select public.close_project('00000000-0000-0000-0000-0000000000a1', 'completed')$$, '42501', null, 'client cannot close');
select throws_ok($$select public.reopen_project('00000000-0000-0000-0000-0000000000a1')$$, '42501', null, 'client cannot reopen');

-- ---------------------------------------------------------------- close
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select throws_ok($$select public.close_project('00000000-0000-0000-0000-0000000000a3', 'completed')$$, '22023', null, 'close: only from active (setup refused)');
select throws_ok($$select public.close_project('00000000-0000-0000-0000-0000000000a1', 'paused')$$, '22023', null, 'close: outcome must be completed or terminated');

select lives_ok($$select public.close_project('00000000-0000-0000-0000-0000000000a1', 'completed', 'All delivered')$$, 'close: active project closes');
select is((select status::text from public.projects where id = '00000000-0000-0000-0000-0000000000a1'), 'completed', 'close: status is completed');
select ok((select closed_at is not null from public.projects where id = '00000000-0000-0000-0000-0000000000a1'), 'close: completed sets closed_at');
select throws_ok($$select public.close_project('00000000-0000-0000-0000-0000000000a1', 'terminated')$$, '22023', null, 'close: only from active (already closed refused)');

-- ------------------------------------------------------------------ lock
select throws_ok($$update public.milestones set title = 'renamed' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'MP001', null, 'lock: admin cannot update a milestone of a closed project');
select throws_ok($$delete from public.tasks where id = '00000000-0000-0000-0000-0000000000e1'$$, 'MP001', null, 'lock: admin cannot delete a task of a closed project');
select throws_ok($$select public.add_payment_request('00000000-0000-0000-0000-0000000000a1', 'Late', 5, current_date)$$, 'MP001', null, 'lock: admin cannot schedule a payment on a closed project');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok(
  format($f$insert into public.payments (project_id, request_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  'MP001', null, 'lock: client cannot submit proof to a closed project');
select throws_ok(
  format($f$insert into public.milestone_reviews (milestone_id, user_id, decision) values ('00000000-0000-0000-0000-0000000000b1', %L, 'approved')$f$, tests.get_user('ana@client-a.test')),
  'MP001', null, 'lock: client cannot review a milestone of a closed project');

-- messages: open for 30 days after close
select lives_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'thanks!')$f$, tests.get_user('ana@client-a.test')),
  'lock: message allowed right after close');
select tests.clear_auth();
update public.projects set closed_at = now() - interval '10 days' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select lives_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'still there')$f$, tests.get_user('ana@client-a.test')),
  'lock: message allowed 10 days after close');
select tests.clear_auth();
update public.projects set closed_at = now() - interval '29 days' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select lives_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'last week')$f$, tests.get_user('ana@client-a.test')),
  'lock: message allowed 29 days after close');
update public.messages set body = 'last week, edited' where body = 'last week';
select ok(
  (select edited_at is not null from public.messages where body = 'last week, edited'),
  'lock: the trigger still sets edited_at 29 days after close');
select tests.clear_auth();
update public.projects set closed_at = now() - interval '31 days' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, 'too late')$f$, tests.get_user('ana@client-a.test')),
  'MP001', null, 'lock: message refused 31 days after close');

-- --------------------------------------------------------------- reopen
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select lives_ok($$select public.reopen_project('00000000-0000-0000-0000-0000000000a1', 'Client wants one more change')$$, 'reopen: closed project reopens');
select is(
  (select status::text || ':' || (closed_at is null)::text from public.projects where id = '00000000-0000-0000-0000-0000000000a1'),
  'active:true', 'reopen: back to active with closed_at cleared');
select lives_ok($$update public.milestones set title = 'renamed' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'reopen: lock lifted');

-- ------------------------------------------------------------- activity
select is(
  (select array_agg(reason order by created_at) from public.activity
   where entity = 'project' and action = 'status_changed' and entity_id = '00000000-0000-0000-0000-0000000000a1'),
  array['All delivered', 'Client wants one more change'],
  'close and reopen are logged as status changes with the reason');

-- ------------------------------------------------------- cascade delete
select tests.authenticate_as(tests.get_user('admin@mileplan.test'));
select public.close_project('00000000-0000-0000-0000-0000000000a4', 'terminated');
select tests.clear_auth();
select lives_ok($$delete from public.projects where id = '00000000-0000-0000-0000-0000000000a4'$$, 'lock: deleting a closed project cascades fine');
select is(
  (select count(*) from public.milestones where project_id = '00000000-0000-0000-0000-0000000000a4')
  + (select count(*) from public.payments where project_id = '00000000-0000-0000-0000-0000000000a4'),
  0::bigint, 'lock: the cascade removed the children');

select * from finish();
rollback;
