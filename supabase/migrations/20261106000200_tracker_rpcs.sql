-- Admin tracker RPCs. All are security INVOKER (RLS still applies) and refuse non-admins with 42501.
-- Each sets the transaction-local edit reason first, so the activity triggers can record it
-- and a previous edit's reason can never leak into this one.

create function public.begin_admin_edit(p_reason text) returns void
language plpgsql set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform set_config('mileplan.reason', coalesce(p_reason, ''), true);
end;
$$;

create function public.assert_keys(p_obj jsonb, p_allowed text[]) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    raise exception 'expected a JSON object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_obj) loop
    if v_key <> all (p_allowed) then
      raise exception 'field % is not editable', v_key using errcode = '22023';
    end if;
  end loop;
end;
$$;

create function public.renumber_milestones(p_project_id uuid) returns void
language sql set search_path = '' as $$
  update public.milestones m set position = r.rn
  from (select id, row_number() over (order by position, created_at)::int as rn
        from public.milestones where project_id = p_project_id) r
  where m.id = r.id and m.position <> r.rn;
$$;

create function public.renumber_tasks(p_milestone_id uuid) returns void
language sql set search_path = '' as $$
  update public.tasks t set position = r.rn
  from (select id, row_number() over (order by position, created_at)::int as rn
        from public.tasks where milestone_id = p_milestone_id) r
  where t.id = r.id and t.position <> r.rn;
$$;

create function public.activate_project(p_project_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_status public.project_status;
begin
  perform public.begin_admin_edit(null);
  select status into v_status from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_status = 'active' then
    return; -- double-click safe
  end if;
  if v_status <> 'setup' then
    raise exception 'a % project cannot be activated', v_status using errcode = '22023';
  end if;
  update public.projects set status = 'active', activated_at = now() where id = p_project_id;
end;
$$;

create function public.add_milestone(p_project_id uuid, p_fields jsonb, p_reason text default null) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.begin_admin_edit(p_reason);
  perform public.assert_keys(p_fields, array['title', 'description', 'acceptance_criteria', 'due_date', 'amount']);
  if coalesce(trim(p_fields ->> 'title'), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  perform 1 from public.projects where id = p_project_id for update; -- serialises position assignment
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  insert into public.milestones (project_id, position, title, description, acceptance_criteria, due_date, amount)
  values (
    p_project_id,
    coalesce((select max(position) from public.milestones where project_id = p_project_id), 0) + 1,
    trim(p_fields ->> 'title'),
    p_fields ->> 'description',
    coalesce(array(select jsonb_array_elements_text(p_fields -> 'acceptance_criteria')), '{}'),
    (p_fields ->> 'due_date')::date,
    coalesce((p_fields ->> 'amount')::numeric, 0)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.update_milestone(p_id uuid, p_patch jsonb, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.begin_admin_edit(p_reason);
  perform public.assert_keys(p_patch, array['title', 'description', 'acceptance_criteria', 'due_date', 'amount', 'on_hold', 'status']);
  update public.milestones m set
    title = case when p_patch ? 'title' then r.title else m.title end,
    description = case when p_patch ? 'description' then r.description else m.description end,
    acceptance_criteria = case when p_patch ? 'acceptance_criteria' then r.acceptance_criteria else m.acceptance_criteria end,
    due_date = case when p_patch ? 'due_date' then r.due_date else m.due_date end,
    amount = case when p_patch ? 'amount' then r.amount else m.amount end,
    on_hold = case when p_patch ? 'on_hold' then r.on_hold else m.on_hold end,
    status = case when p_patch ? 'status' then r.status else m.status end
  from jsonb_populate_record(null::public.milestones, p_patch) r
  where m.id = p_id;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.delete_milestone(p_id uuid, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_project uuid;
begin
  perform public.begin_admin_edit(p_reason);
  delete from public.milestones where id = p_id returning project_id into v_project;
  if v_project is null then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;
  perform public.renumber_milestones(v_project);
end;
$$;

create function public.reorder_milestones(p_project_id uuid, p_ids uuid[]) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.begin_admin_edit(null);
  perform 1 from public.projects where id = p_project_id for update;
  if (select coalesce(array_agg(id order by id), '{}') from public.milestones where project_id = p_project_id)
     is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'the milestone list is out of date' using errcode = '22023';
  end if;
  update public.milestones m set position = o.ord::int
  from unnest(p_ids) with ordinality as o(id, ord)
  where m.id = o.id and m.position <> o.ord;
end;
$$;

create function public.reorder_tasks(p_milestone_id uuid, p_ids uuid[]) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.begin_admin_edit(null);
  perform 1 from public.milestones where id = p_milestone_id for update;
  if (select coalesce(array_agg(id order by id), '{}') from public.tasks where milestone_id = p_milestone_id)
     is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'the task list is out of date' using errcode = '22023';
  end if;
  update public.tasks t set position = o.ord::int
  from unnest(p_ids) with ordinality as o(id, ord)
  where t.id = o.id and t.position <> o.ord;
end;
$$;

create function public.split_milestone(
  p_id uuid, p_task_ids uuid[], p_title text, p_amount numeric, p_reason text default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_orig public.milestones;
  v_new uuid;
begin
  perform public.begin_admin_edit(p_reason);
  select * into v_orig from public.milestones where id = p_id for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > v_orig.amount then
    raise exception 'amount must be between 0 and %', v_orig.amount using errcode = '22023';
  end if;
  if (select count(*) from public.tasks where milestone_id = p_id and id = any (p_task_ids))
     <> (select count(distinct x) from unnest(p_task_ids) x) then
    raise exception 'every task must belong to the milestone being split' using errcode = '22023';
  end if;

  update public.milestones set position = position + 1
  where project_id = v_orig.project_id and position > v_orig.position;

  insert into public.milestones (project_id, position, title, due_date, amount)
  values (v_orig.project_id, v_orig.position + 1, trim(p_title), v_orig.due_date, p_amount)
  returning id into v_new;

  update public.milestones set amount = v_orig.amount - p_amount where id = p_id;
  update public.tasks set milestone_id = v_new where milestone_id = p_id and id = any (p_task_ids);
  perform public.renumber_tasks(p_id);
  perform public.renumber_tasks(v_new);
  return v_new;
end;
$$;

create function public.merge_milestones(p_first uuid, p_second uuid, p_reason text default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_a public.milestones;
  v_b public.milestones;
  v_offset int;
begin
  perform public.begin_admin_edit(p_reason);
  select * into v_a from public.milestones where id = p_first for update;
  select * into v_b from public.milestones where id = p_second for update;
  if v_a.id is null or v_b.id is null then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;
  if v_a.project_id <> v_b.project_id then
    raise exception 'milestones belong to different projects' using errcode = '22023';
  end if;
  if v_b.position <> v_a.position + 1 then
    raise exception 'only adjacent milestones can be merged' using errcode = '22023';
  end if;

  select coalesce(max(position), 0) into v_offset from public.tasks where milestone_id = p_first;
  update public.tasks set milestone_id = p_first, position = position + v_offset where milestone_id = p_second;
  update public.updates set milestone_id = p_first where milestone_id = p_second;
  update public.payments set milestone_id = p_first where milestone_id = p_second;
  update public.milestone_reviews set milestone_id = p_first where milestone_id = p_second;

  update public.milestones
  set amount = v_a.amount + v_b.amount, acceptance_criteria = v_a.acceptance_criteria || v_b.acceptance_criteria
  where id = p_first;
  delete from public.milestones where id = p_second;
  perform public.renumber_milestones(v_a.project_id);
end;
$$;

revoke all on function
  public.begin_admin_edit(text), public.assert_keys(jsonb, text[]), public.renumber_milestones(uuid), public.renumber_tasks(uuid),
  public.activate_project(uuid), public.add_milestone(uuid, jsonb, text), public.update_milestone(uuid, jsonb, text),
  public.delete_milestone(uuid, text), public.reorder_milestones(uuid, uuid[]), public.reorder_tasks(uuid, uuid[]),
  public.split_milestone(uuid, uuid[], text, numeric, text), public.merge_milestones(uuid, uuid, text)
from public, anon;
grant execute on function
  public.begin_admin_edit(text), public.assert_keys(jsonb, text[]), public.renumber_milestones(uuid), public.renumber_tasks(uuid),
  public.activate_project(uuid), public.add_milestone(uuid, jsonb, text), public.update_milestone(uuid, jsonb, text),
  public.delete_milestone(uuid, text), public.reorder_milestones(uuid, uuid[]), public.reorder_tasks(uuid, uuid[]),
  public.split_milestone(uuid, uuid[], text, numeric, text), public.merge_milestones(uuid, uuid, text)
to authenticated;
