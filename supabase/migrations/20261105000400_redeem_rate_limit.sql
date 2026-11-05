-- Rate limiting for the public redeem-setup function, plus an email lookup for Edge Functions.

create table public.redeem_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  at timestamptz not null default now()
);
create index redeem_attempts_ip_at_idx on public.redeem_attempts (ip, at);
alter table public.redeem_attempts enable row level security; -- no policies: service role only
revoke all on public.redeem_attempts from anon, authenticated;

-- Records an attempt and returns false once an IP has made 10 attempts in 15 minutes.
create function public.check_redeem_rate(p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_ip));
  delete from public.redeem_attempts where at < now() - interval '1 hour';
  select count(*) into v_count from public.redeem_attempts where ip = p_ip and at > now() - interval '15 minutes';
  if v_count >= 10 then
    return false;
  end if;
  insert into public.redeem_attempts (ip) values (p_ip);
  return true;
end;
$$;

create function public.user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.check_redeem_rate(text), public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.check_redeem_rate(text), public.user_id_by_email(text) to service_role;
