-- A client-submitted payment may only reference a milestone of the same project.
-- (The milestones subquery is RLS-filtered, so a milestone the client cannot see never matches.)

drop policy payments_client_insert on public.payments;
create policy payments_client_insert on public.payments for insert to authenticated
  with check (
    status = 'pending'
    and submitted_by = (select auth.uid())
    and reviewed_by is null and reviewed_at is null and review_note is null
    and public.can_see(project_id)
    and (
      milestone_id is null
      or exists (select 1 from public.milestones m where m.id = milestone_id and m.project_id = payments.project_id)
    )
  );
