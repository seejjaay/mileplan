-- Computed field so the admin Timeline can say "Acknowledged by Ana" (same rules as the other display names).
create function public.acker_name(public.plan_change_acks) returns text
language sql stable security definer set search_path = '' as $$ select public.display_name($1.user_id) $$;

revoke all on function public.acker_name(public.plan_change_acks) from public, anon;
grant execute on function public.acker_name(public.plan_change_acks) to authenticated, service_role;
