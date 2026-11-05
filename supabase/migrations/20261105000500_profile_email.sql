-- Mirror auth.users.email onto profiles so the admin Clients page can list it.
-- (Clients cannot update it: profiles UPDATE is column-limited to full_name, avatar_path.)

alter table public.profiles add column email text;
update public.profiles p set email = lower(u.email) from auth.users u where u.id = p.id;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (new.id, 'client', new.raw_user_meta_data ->> 'full_name', lower(new.email));
  return new;
end;
$$;

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();
