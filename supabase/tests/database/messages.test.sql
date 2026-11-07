begin;
select plan(30);

do $$ begin perform tests.create_user('cara@client-c.test'); end $$;

-- Fixtures (as postgres) ---------------------------------------------------------------------------------
-- P1: ana + cara (rules).  P2: ben.  P3: ana + cara (unread counts).
insert into public.projects (id, title, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'P1', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', 'P3', 'active');
insert into public.project_members (project_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a1', tests.get_user('cara@client-c.test')),
  ('00000000-0000-0000-0000-0000000000a2', tests.get_user('ben@client-b.test')),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test')),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('cara@client-c.test'));

-- ------------------------------------------------------------------------------------------------- body
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, '')$f$, tests.get_user('ana@client-a.test')),
  '23514', null, 'messages: an empty body is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, '   ')$f$, tests.get_user('ana@client-a.test')),
  '23514', null, 'messages: a body of spaces is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, E'\n\n')$f$, tests.get_user('ana@client-a.test')),
  '23514', null, 'messages: a body of newlines is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, repeat('x', 4001))$f$, tests.get_user('ana@client-a.test')),
  '23514', null, 'messages: a body of 4001 characters is refused');
select lives_ok(
  format($f$insert into public.messages (project_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, repeat('x', 4000))$f$, tests.get_user('ana@client-a.test')),
  'messages: a body of 4000 characters is accepted');

-- ------------------------------------------------------------------------------------------- attachments
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    (select jsonb_agg(jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/f' || n, 'name', 'f', 'size', 1, 'mime', 'text/plain')) from generate_series(1, 6) n))$f$,
    tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: 6 attachments are refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    '[{"path":"00000000-0000-0000-0000-0000000000a1/f","name":"f","size":1}]')$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment missing a key is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    '[{"path":"00000000-0000-0000-0000-0000000000a1/f","name":"f","size":1,"mime":"text/plain","extra":true}]')$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment with an extra key is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    '[{"path":"00000000-0000-0000-0000-0000000000a1/f","name":"f","size":10485761,"mime":"text/plain"}]')$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment over 10 MB is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    jsonb_build_array(jsonb_build_object('path', '00000000-0000-0000-0000-0000000000a1/f', 'name', repeat('n', 201), 'size', 1, 'mime', 'text/plain')))$f$,
    tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment name of 201 characters is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    '[{"path":"00000000-0000-0000-0000-0000000000a2/f","name":"f","size":1,"mime":"text/plain"}]')$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment path under another project is refused');
select throws_ok(
  format($f$insert into public.messages (project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000a1', %L, 'hi',
    '[{"path":"00000000-0000-0000-0000-0000000000a1/../x","name":"f","size":1,"mime":"text/plain"}]')$f$, tests.get_user('ana@client-a.test')),
  '22023', null, 'messages: an attachment path with a .. segment is refused');
select lives_ok(
  format($f$insert into public.messages (id, project_id, sender_id, body, attachments) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', %L, 'with file',
    '[{"path":"00000000-0000-0000-0000-0000000000a1/f.pdf","name":"f.pdf","size":10485760,"mime":"application/pdf"}]')$f$, tests.get_user('ana@client-a.test')),
  'messages: one valid attachment is accepted');

-- ------------------------------------------------------------------------------------------- edited_at
select ok(
  (select edited_at is null from public.messages where id = '00000000-0000-0000-0000-0000000000d1'),
  'messages: edited_at is null on insert');
update public.messages set body = 'changed' where id = '00000000-0000-0000-0000-0000000000d1';
select ok(
  (select edited_at is not null from public.messages where id = '00000000-0000-0000-0000-0000000000d1'),
  'messages: a body change sets edited_at');

insert into public.messages (id, project_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'), 'same');
update public.messages set body = body where id = '00000000-0000-0000-0000-0000000000d2';
select ok(
  (select edited_at is null from public.messages where id = '00000000-0000-0000-0000-0000000000d2'),
  'messages: update body = body leaves edited_at alone');
select throws_ok($$update public.messages set edited_at = now() where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '42501', null, 'messages: a client cannot write edited_at');
select throws_ok($$update public.messages set attachments = '[]' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '42501', null, 'messages: attachments cannot change after insert');

-- ------------------------------------------------------------------------------------------ edit window
insert into public.messages (id, project_id, sender_id, body) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', tests.get_user('ana@client-a.test'), 'old');
select tests.clear_auth();
update public.messages set created_at = now() - interval '16 minutes' where id = '00000000-0000-0000-0000-0000000000d3';
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
update public.messages set body = 'too late' where id = '00000000-0000-0000-0000-0000000000d3';
select is((select body from public.messages where id = '00000000-0000-0000-0000-0000000000d3'), 'old',
  'messages: the sender cannot edit after 15 minutes');

select tests.authenticate_as(tests.get_user('cara@client-c.test'));
update public.messages set body = 'hijacked' where id = '00000000-0000-0000-0000-0000000000d2';
select is((select body from public.messages where id = '00000000-0000-0000-0000-0000000000d2'), 'same',
  'messages: another member cannot edit the message');

-- ------------------------------------------------------------------------------------------ unread
-- P3: ana wrote at -60 and -30 minutes; cara wrote at -50, -40 and -10 minutes.
select tests.clear_auth();
insert into public.messages (project_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test'), 'a1', now() - interval '60 minutes'),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('cara@client-c.test'), 'c1', now() - interval '50 minutes'),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('cara@client-c.test'), 'c2', now() - interval '40 minutes'),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test'), 'a2', now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('cara@client-c.test'), 'c3', now() - interval '10 minutes');

select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select unread from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 3,
  'unread: never read counts every message, and own messages are excluded');

select tests.authenticate_as(tests.get_user('cara@client-c.test'));
select is((select unread from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 2,
  'unread: a second member counts the other side''s messages');

select tests.authenticate_as(tests.get_user('ben@client-b.test'));
select is((select count(*) from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 0::bigint,
  'unread: a client gets no row for another client''s project');
select throws_ok($$select public.mark_messages_read('00000000-0000-0000-0000-0000000000a3')$$, '42501', null,
  'mark_messages_read: a client cannot mark another client''s project');

-- ana read the thread 45 minutes ago: only c2 and c3 are newer
select tests.clear_auth();
insert into public.message_reads (project_id, user_id, last_read_at) values
  ('00000000-0000-0000-0000-0000000000a3', tests.get_user('ana@client-a.test'), now() - interval '45 minutes');
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select unread from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 2,
  'unread: after a read only newer messages count');

select lives_ok($$select public.mark_messages_read('00000000-0000-0000-0000-0000000000a3')$$, 'mark_messages_read: a member can mark the thread read');
select tests.clear_auth();
select ok(
  (select last_read_at = now() from public.message_reads
   where project_id = '00000000-0000-0000-0000-0000000000a3' and user_id = tests.get_user('ana@client-a.test')),
  'mark_messages_read: writes last_read_at = now() for the caller');
select tests.authenticate_as(tests.get_user('ana@client-a.test'));
select is((select count(*) from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 0::bigint,
  'unread: a zero count omits the row');

select tests.authenticate_as(tests.get_user('cara@client-c.test'));
select is((select unread from public.unread_message_counts() where project_id = '00000000-0000-0000-0000-0000000000a3'), 2,
  'unread: another member''s read does not change my count');

-- ---------------------------------------------------------------------------------------------- realtime
select tests.clear_auth();
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'),
  'messages: public.messages is in the supabase_realtime publication');

select * from finish();
rollback;
