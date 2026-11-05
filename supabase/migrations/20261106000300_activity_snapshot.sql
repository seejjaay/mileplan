-- Created / deleted activity rows now carry the identifying fields (title, amount, decision) as
-- {field: [old, new]}, so the Timeline and the plan-change banner can say WHAT was added or removed.
-- Everything else in log_activity is unchanged from 20261106000100.

create or replace function public.log_activity() returns trigger
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
    select jsonb_object_agg(
             k,
             case when tg_op = 'INSERT' then jsonb_build_array(null::jsonb, v_row -> k) else jsonb_build_array(v_row -> k, null::jsonb) end
           ) into v_changes
    from unnest(array['title', 'amount', 'decision']) as k
    where v_row ? k;
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
