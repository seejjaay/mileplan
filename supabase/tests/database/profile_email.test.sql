begin;
select plan(2);

do $$ begin perform tests.create_user('Mixed.Case@client-c.test'); end $$;

select is(
  (select email from public.profiles where id = tests.get_user('Mixed.Case@client-c.test')),
  'mixed.case@client-c.test',
  'profile email is stored lowercased'
);

update auth.users set email = 'changed@client-c.test' where id = tests.get_user('Mixed.Case@client-c.test');

select is(
  (select email from public.profiles where id = tests.get_user('changed@client-c.test')),
  'changed@client-c.test',
  'profile email follows auth email changes'
);

select * from finish();
rollback;
