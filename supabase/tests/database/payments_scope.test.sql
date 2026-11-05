begin;
select plan(3);

insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test'));
insert into public.milestones (id, project_id, title) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'P1 milestone'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'P2 milestone');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));

select lives_ok(
  format($f$insert into public.payments (project_id, milestone_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  'payment against own project milestone is allowed');
select lives_ok(
  format($f$insert into public.payments (project_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  'payment with no milestone is allowed');
select throws_ok(
  format($f$insert into public.payments (project_id, milestone_id, amount, submitted_by) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 10, %L)$f$, tests.get_user('ana@client-a.test')),
  '42501', null, 'payment cannot point at another project''s milestone');

select * from finish();
rollback;
