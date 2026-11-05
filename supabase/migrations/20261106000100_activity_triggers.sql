-- Audit log: AFTER triggers write `activity` (security definer, so `authenticated` never needs write access),
-- plus the plan_change flag and the milestone approval guard.

create function public.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_entity public.activity_entity;
  v_project uuid;
  v_status public.project_status;
  v_changes jsonb;
  v_action public.activity_action;
  v_plan boolean := false;
begin
  v_entity := case tg_table_name
    when 'projects' then 'project'
    when 'milestones' then 'milestone'
    when 'tasks' then 'task'
    when 'documents' then 'document'
    when 'payments' then 'payment'
    when 'updates' then 'update'
    when 'milestone_reviews' then 'review'
  end;

  v_project := case tg_table_name
    when 'projects' then (v_row ->> 'id')::uuid
    when 'milestone_reviews' then (select m.project_id from public.milestones m where m.id = (v_row ->> 'milestone_id')::uuid)
    else (v_row ->> 'project_id')::uuid
  end;

  -- A cascade delete removes the parent first; there is nothing left to attach the log row to.
  select p.status into v_status from public.projects p where p.id = v_project;
  if v_status is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(v_old -> k, v_new -> k)) into v_changes
    from jsonb_object_keys(v_new) as k
    where k not in ('id', 'created_at') and (v_old -> k) is distinct from (v_new -> k);

    if v_changes is null then
      return null; -- no-op update
    end if;
    -- Reordering is noise: don't log updates that only moved `position`.
    if not exists (select 1 from jsonb_object_keys(v_changes) k where k <> 'position') then
      return null;
    end if;
    v_action := case when v_changes ? 'status' then 'status_changed' else 'updated' end;
  else
    v_action := case when tg_op = 'INSERT' then 'created' else 'deleted' end;
  end if;

  v_plan := v_entity = 'milestone'
    and v_status = 'active'
    and (tg_op in ('INSERT', 'DELETE')
         or v_changes ?| array['amount', 'due_date', 'title', 'description', 'acceptance_criteria']);

  insert into public.activity (created_at, project_id, actor_id, entity, entity_id, action, changes, reason, plan_change)
  values (
    clock_timestamp(), v_project, (select auth.uid()), v_entity, (v_row ->> 'id')::uuid, v_action,
    v_changes, nullif(current_setting('mileplan.reason', true), ''), v_plan
  );
  return null;
end;
$$;

create trigger projects_activity after insert or update or delete on public.projects
  for each row execute function public.log_activity();
create trigger milestones_activity after insert or update or delete on public.milestones
  for each row execute function public.log_activity();
create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function public.log_activity();
create trigger documents_activity after insert or update or delete on public.documents
  for each row execute function public.log_activity();
create trigger updates_activity after insert or update or delete on public.updates
  for each row execute function public.log_activity();
create trigger milestone_reviews_activity after insert or update or delete on public.milestone_reviews
  for each row execute function public.log_activity();
create trigger payments_activity after insert or update or delete on public.payments
  for each row execute function public.log_activity();

-- A milestone becomes `approved` only from `in_review`, and the approval is stamped.
create function public.milestones_guard_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if old.status <> 'in_review' then
      raise exception 'a milestone can only be approved from in_review' using errcode = 'P0001';
    end if;
    new.approved_at := now();
    new.approved_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger milestones_guard_status before update of status on public.milestones
  for each row execute function public.milestones_guard_status();
