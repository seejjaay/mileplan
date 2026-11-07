-- Phase 4: plan import.
-- import_plan(project, plan, dry_run, reason) validates a plan.json, returns a diff against the project, and
-- applies it in one transaction when dry_run is false. A dry run never writes.
-- Rules live here and only here: the app parses the file and renders the result.

-- 1. Requests get a stable key, like milestones, so a re-import can tell "changed" from "removed and added".
alter table public.payment_requests add column plan_key text;
alter table public.payment_requests add constraint payment_requests_project_plan_key_key unique (project_id, plan_key);

-- 2. Shape validation. These collect { path, message } errors instead of raising, so the admin sees every
-- problem at once. All pure functions of the plan (stable, not immutable: format() and date casts are stable).
create function public.plan_err(p_path text, p_message text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_array(jsonb_build_object('path', p_path, 'message', p_message))
$$;

create function public.plan_join(p_path text, p_field text) returns text
language sql immutable set search_path = '' as $$
  select case when p_path = '' then p_field else p_path || '.' || p_field end
$$;

create function public.plan_date(p_val jsonb) returns date
language plpgsql stable set search_path = '' as $$
begin
  if jsonb_typeof(p_val) <> 'string' or (p_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return (p_val #>> '{}')::date;
exception when others then
  return null;
end;
$$;

create function public.plan_unknown_keys(p_obj jsonb, p_path text, p_allowed text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('path', public.plan_join(p_path, k), 'message', 'is not a known field') order by k),
    '[]')
  from jsonb_object_keys(p_obj) k
  where k <> all (p_allowed)
$$;

create function public.plan_check_text(
  p_obj jsonb, p_field text, p_path text, p_required boolean, p_nonempty boolean, p_max int
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb := p_obj -> p_field;
  v_path text := public.plan_join(p_path, p_field);
begin
  if v is null then
    return case when p_required then public.plan_err(v_path, 'is required') else '[]'::jsonb end;
  end if;
  if jsonb_typeof(v) <> 'string' then
    return public.plan_err(v_path, 'must be text');
  end if;
  if p_nonempty and btrim(v #>> '{}') = '' then
    return public.plan_err(v_path, 'must not be empty');
  end if;
  if char_length(v #>> '{}') > p_max then
    return public.plan_err(v_path, format('must be at most %s characters', p_max));
  end if;
  return '[]'::jsonb;
end;
$$;

create function public.plan_check_date(p_obj jsonb, p_field text, p_path text, p_required boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb := p_obj -> p_field;
  v_path text := public.plan_join(p_path, p_field);
begin
  if v is null then
    return case when p_required then public.plan_err(v_path, 'is required') else '[]'::jsonb end;
  end if;
  if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return public.plan_err(v_path, 'must be a date like 2026-11-24');
  end if;
  if public.plan_date(v) is null then
    return public.plan_err(v_path, 'is not a real date');
  end if;
  return '[]'::jsonb;
end;
$$;

create function public.plan_check_amount(
  p_obj jsonb, p_field text, p_path text, p_required boolean, p_positive boolean
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb := p_obj -> p_field;
  v_path text := public.plan_join(p_path, p_field);
  v_n numeric;
begin
  if v is null then
    return case when p_required then public.plan_err(v_path, 'is required') else '[]'::jsonb end;
  end if;
  if jsonb_typeof(v) <> 'number' then
    return public.plan_err(v_path, 'must be a number');
  end if;
  begin
    v_n := v::numeric;
  exception when others then
    return public.plan_err(v_path, 'must be a number');
  end;
  if p_positive and v_n <= 0 then
    return public.plan_err(v_path, 'must be greater than 0');
  elsif v_n < 0 then
    return public.plan_err(v_path, 'must be 0 or more');
  elsif v_n > 9999999999.99 then
    return public.plan_err(v_path, 'must be at most 9999999999.99');
  elsif v_n <> round(v_n, 2) then
    return public.plan_err(v_path, 'can have at most 2 decimals');
  end if;
  return '[]'::jsonb;
end;
$$;

-- p_coll names the collection ("milestones"), p_seen holds the keys of the items before this one.
create function public.plan_check_key(p_obj jsonb, p_path text, p_coll text, p_seen text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb := p_obj -> 'key';
  v_path text := public.plan_join(p_path, 'key');
  v_key text;
begin
  if v is null then
    return public.plan_err(v_path, 'is required');
  end if;
  v_key := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
    return public.plan_err(v_path, 'must be lowercase letters, digits, - or _ (1-40 characters)');
  end if;
  if v_key = any (p_seen) then
    return public.plan_err(v_path, format('duplicates %s[%s].key', p_coll, array_position(p_seen, v_key) - 1));
  end if;
  return '[]'::jsonb;
end;
$$;

-- The whole plan. Returns '[]' when the shape is valid.
create function public.validate_plan(p_plan jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_errs jsonb := '[]';
  v_proj jsonb;
  v_ms jsonb;
  v_pays jsonb;
  v_m jsonb;
  v_p jsonb;
  v_x jsonb;
  v_path text;
  v_tpath text;
  v_d date;
  v_d2 date;
  v_prev_due date;
  v_prev_i int;
  v_mkeys text[] := '{}';
  v_pkeys text[] := '{}';
  v_tasks text[];
  v_title text;
  v_key text;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    return public.plan_err('$', 'must be a JSON object');
  end if;
  v_errs := public.plan_unknown_keys(p_plan, '', array['schema_version', 'project', 'milestones', 'payments']);

  if not p_plan ? 'schema_version' then
    v_errs := v_errs || public.plan_err('schema_version', 'is required');
  elsif p_plan -> 'schema_version' is distinct from to_jsonb(1) then
    v_errs := v_errs || public.plan_err('schema_version', 'must be 1');
  end if;

  -- project
  v_proj := p_plan -> 'project';
  if v_proj is null then
    v_errs := v_errs || public.plan_err('project', 'is required');
  elsif jsonb_typeof(v_proj) <> 'object' then
    v_errs := v_errs || public.plan_err('project', 'must be an object');
  else
    v_errs := v_errs
      || public.plan_unknown_keys(v_proj, 'project', array['title', 'summary', 'currency', 'start_date', 'end_date'])
      || public.plan_check_text(v_proj, 'title', 'project', true, true, 200)
      || public.plan_check_text(v_proj, 'summary', 'project', false, false, 2000)
      || public.plan_check_date(v_proj, 'start_date', 'project', false)
      || public.plan_check_date(v_proj, 'end_date', 'project', false);
    if v_proj ? 'currency'
       and (jsonb_typeof(v_proj -> 'currency') <> 'string' or (v_proj ->> 'currency') !~ '^[A-Z]{3}$') then
      v_errs := v_errs || public.plan_err('project.currency', 'must be 3 uppercase letters, like PHP');
    end if;
    v_d := public.plan_date(v_proj -> 'start_date');
    v_d2 := public.plan_date(v_proj -> 'end_date');
    if v_d is not null and v_d2 is not null and v_d2 < v_d then
      v_errs := v_errs || public.plan_err('project.end_date', 'is before project.start_date');
    end if;
  end if;

  -- milestones
  v_ms := p_plan -> 'milestones';
  if v_ms is null then
    v_errs := v_errs || public.plan_err('milestones', 'is required');
  elsif jsonb_typeof(v_ms) <> 'array' then
    v_errs := v_errs || public.plan_err('milestones', 'must be an array');
  else
    if jsonb_array_length(v_ms) = 0 then
      v_errs := v_errs || public.plan_err('milestones', 'needs at least 1 item');
    elsif jsonb_array_length(v_ms) > 100 then
      v_errs := v_errs || public.plan_err('milestones', 'can have at most 100 items');
    end if;
    for v_i in 0 .. jsonb_array_length(v_ms) - 1 loop
      v_m := v_ms -> v_i;
      v_path := format('milestones[%s]', v_i);
      if jsonb_typeof(v_m) <> 'object' then
        v_errs := v_errs || public.plan_err(v_path, 'must be an object');
        v_mkeys := v_mkeys || ''::text;
        continue;
      end if;
      v_errs := v_errs
        || public.plan_unknown_keys(v_m, v_path,
             array['key', 'title', 'description', 'acceptance_criteria', 'due_date', 'amount', 'tasks'])
        || public.plan_check_key(v_m, v_path, 'milestones', v_mkeys)
        || public.plan_check_text(v_m, 'title', v_path, true, true, 200)
        || public.plan_check_text(v_m, 'description', v_path, false, false, 5000)
        || public.plan_check_date(v_m, 'due_date', v_path, true)
        || public.plan_check_amount(v_m, 'amount', v_path, false, false);
      v_mkeys := v_mkeys || case
        when jsonb_typeof(v_m -> 'key') = 'string' and (v_m ->> 'key') ~ '^[a-z0-9][a-z0-9_-]{0,39}$' then v_m ->> 'key'
        else '' end;

      -- due dates never go backwards in plan order
      v_d := public.plan_date(v_m -> 'due_date');
      if v_d is not null then
        if v_prev_due is not null and v_d < v_prev_due then
          v_errs := v_errs || public.plan_err(v_path || '.due_date', format('is before milestones[%s].due_date', v_prev_i));
        end if;
        v_prev_due := v_d;
        v_prev_i := v_i;
      end if;

      -- acceptance criteria
      v_x := v_m -> 'acceptance_criteria';
      if v_x is not null then
        if jsonb_typeof(v_x) <> 'array' then
          v_errs := v_errs || public.plan_err(v_path || '.acceptance_criteria', 'must be an array');
        else
          if jsonb_array_length(v_x) > 50 then
            v_errs := v_errs || public.plan_err(v_path || '.acceptance_criteria', 'can have at most 50 items');
          end if;
          for v_j in 0 .. jsonb_array_length(v_x) - 1 loop
            if jsonb_typeof(v_x -> v_j) <> 'string' then
              v_errs := v_errs || public.plan_err(format('%s.acceptance_criteria[%s]', v_path, v_j), 'must be text');
            elsif btrim((v_x -> v_j) #>> '{}') = '' then
              v_errs := v_errs || public.plan_err(format('%s.acceptance_criteria[%s]', v_path, v_j), 'must not be empty');
            end if;
          end loop;
        end if;
      end if;

      -- tasks
      v_x := v_m -> 'tasks';
      if v_x is not null then
        if jsonb_typeof(v_x) <> 'array' then
          v_errs := v_errs || public.plan_err(v_path || '.tasks', 'must be an array');
        else
          if jsonb_array_length(v_x) > 100 then
            v_errs := v_errs || public.plan_err(v_path || '.tasks', 'can have at most 100 items');
          end if;
          v_tasks := '{}';
          for v_j in 0 .. jsonb_array_length(v_x) - 1 loop
            v_tpath := format('%s.tasks[%s]', v_path, v_j);
            if jsonb_typeof(v_x -> v_j) <> 'string' then
              v_errs := v_errs || public.plan_err(v_tpath, 'must be text');
              v_tasks := v_tasks || ''::text;
              continue;
            end if;
            v_title := btrim((v_x -> v_j) #>> '{}');
            if v_title = '' then
              v_errs := v_errs || public.plan_err(v_tpath, 'must not be empty');
            elsif char_length(v_title) > 200 then
              v_errs := v_errs || public.plan_err(v_tpath, 'must be at most 200 characters');
            elsif v_title = any (v_tasks) then
              v_errs := v_errs || public.plan_err(v_tpath, format('duplicates %s.tasks[%s]', v_path, array_position(v_tasks, v_title) - 1));
            end if;
            v_tasks := v_tasks || v_title;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  -- payments (optional)
  v_pays := p_plan -> 'payments';
  if v_pays is not null then
    if jsonb_typeof(v_pays) <> 'array' then
      v_errs := v_errs || public.plan_err('payments', 'must be an array');
    else
      if jsonb_array_length(v_pays) > 100 then
        v_errs := v_errs || public.plan_err('payments', 'can have at most 100 items');
      end if;
      for v_i in 0 .. jsonb_array_length(v_pays) - 1 loop
        v_p := v_pays -> v_i;
        v_path := format('payments[%s]', v_i);
        if jsonb_typeof(v_p) <> 'object' then
          v_errs := v_errs || public.plan_err(v_path, 'must be an object');
          v_pkeys := v_pkeys || ''::text;
          continue;
        end if;
        v_errs := v_errs
          || public.plan_unknown_keys(v_p, v_path, array['key', 'title', 'amount', 'due_date', 'milestone'])
          || public.plan_check_key(v_p, v_path, 'payments', v_pkeys)
          || public.plan_check_text(v_p, 'title', v_path, true, true, 200)
          || public.plan_check_amount(v_p, 'amount', v_path, true, true)
          || public.plan_check_date(v_p, 'due_date', v_path, true);
        v_pkeys := v_pkeys || case
          when jsonb_typeof(v_p -> 'key') = 'string' and (v_p ->> 'key') ~ '^[a-z0-9][a-z0-9_-]{0,39}$' then v_p ->> 'key'
          else '' end;
        if v_p ? 'milestone' then
          if jsonb_typeof(v_p -> 'milestone') <> 'string' then
            v_errs := v_errs || public.plan_err(v_path || '.milestone', 'must be a milestone key');
          else
            v_key := v_p ->> 'milestone';
            if v_key = '' or not v_key = any (v_mkeys) then
              v_errs := v_errs || public.plan_err(v_path || '.milestone', format('"%s" is not a milestone key in this plan', v_key));
            end if;
          end if;
        end if;
      end loop;
    end if;
  end if;

  return v_errs;
end;
$$;

-- 3. import_plan. security INVOKER (RLS still applies); begin_admin_edit refuses non-admins with 42501 and records
-- the shared reason for the activity triggers. Those triggers turn milestone and request changes on an active
-- project into plan changes, so nothing here logs by hand.
--
-- Rules, all decided in the plan: unkeyed rows are never touched; tasks match by title within a milestone;
-- an omitted optional field is left unchanged; status, on_hold and approvals are never written.
create function public.import_plan(
  p_project_id uuid, p_plan jsonb, p_dry_run boolean default true, p_reason text default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_proj public.projects;
  v_errs jsonb;
  v_pj jsonb;
  v_pnew jsonb;
  v_pc jsonb;
  v_ms jsonb;
  v_pays jsonb;
  v_m jsonb;
  v_p jsonb;
  v_ex public.milestones;
  v_rq public.payment_requests;
  v_r record;
  v_found boolean;
  v_key text;
  v_title text;
  v_ac text[];
  v_chg jsonb;
  v_id uuid;
  v_idmap jsonb := '{}';
  v_ids uuid[] := '{}';
  v_plan_keys text[];
  v_cur uuid[];
  v_fin uuid[];
  v_reordered boolean;
  v_tt text[];
  v_et text[];
  v_tadd text[];
  v_trem text[];
  v_treorder boolean;
  v_old_key text;
  v_m_added jsonb := '[]';
  v_m_changed jsonb := '[]';
  v_m_removed jsonb := '[]';
  v_m_kept jsonb := '[]';
  v_p_added jsonb := '[]';
  v_p_changed jsonb := '[]';
  v_p_removed jsonb := '[]';
  v_p_kept jsonb := '[]';
begin
  perform public.begin_admin_edit(p_reason);

  if p_dry_run then
    select * into v_proj from public.projects where id = p_project_id;
  else
    select * into v_proj from public.projects where id = p_project_id for update; -- serialises concurrent imports
  end if;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- 1. Validate: shape first, then the checks that need the project's rows.
  v_errs := public.validate_plan(p_plan);
  if v_proj.status not in ('setup', 'active') then
    if not p_dry_run then
      raise exception 'project is closed' using errcode = 'MP001';
    end if;
    v_errs := public.plan_err('project', 'is closed, so its plan can''t be changed') || v_errs;
  end if;

  if jsonb_array_length(v_errs) = 0 then
    v_pj := p_plan -> 'project';
    v_ms := p_plan -> 'milestones';
    v_pays := coalesce(p_plan -> 'payments', '[]');

    if v_pj ? 'currency' and (v_pj ->> 'currency') <> v_proj.currency
       and exists (select 1 from public.payment_requests where project_id = p_project_id) then
      v_errs := v_errs || public.plan_err('project.currency', 'can''t change while the project has payment requests');
    end if;

    for v_r in
      select m.id, m.plan_key, m.title from public.milestones m
      where m.project_id = p_project_id and m.plan_key is not null
        and not exists (select 1 from jsonb_array_elements(v_ms) e where e ->> 'key' = m.plan_key)
    loop
      if exists (select 1 from public.payments where milestone_id = v_r.id and status = 'confirmed') then
        v_errs := v_errs || public.plan_err('milestones.' || v_r.plan_key,
          format('"%s" can''t be removed: it has confirmed payments', v_r.title));
      end if;
    end loop;

    for v_r in
      select q.id, q.plan_key, q.title from public.payment_requests q
      where q.project_id = p_project_id and q.plan_key is not null
        and not exists (select 1 from jsonb_array_elements(v_pays) e where e ->> 'key' = q.plan_key)
    loop
      if exists (select 1 from public.payments where request_id = v_r.id and status in ('pending', 'confirmed')) then
        v_errs := v_errs || public.plan_err('payments.' || v_r.plan_key,
          format('"%s" can''t be removed: it has pending or confirmed payments', v_r.title));
      end if;
    end loop;

    for v_r in
      select e.ord - 1 as i, c.total
      from jsonb_array_elements(v_pays) with ordinality e(v, ord)
      join public.payment_requests q on q.project_id = p_project_id and q.plan_key = e.v ->> 'key'
      cross join lateral (
        select coalesce(sum(p.amount), 0) as total from public.payments p where p.request_id = q.id and p.status = 'confirmed'
      ) c
      where (e.v ->> 'amount')::numeric < c.total
    loop
      v_errs := v_errs || public.plan_err(format('payments[%s].amount', v_r.i),
        format('is below the %s already confirmed', v_r.total));
    end loop;
  end if;

  if jsonb_array_length(v_errs) > 0 then
    if not p_dry_run then
      raise exception '% %', v_errs -> 0 ->> 'path', v_errs -> 0 ->> 'message' using errcode = '22023';
    end if;
    return jsonb_build_object('valid', false, 'applied', false, 'errors', v_errs);
  end if;

  -- 2. Project fields. Only the fields the plan names are compared; the rest are left unchanged.
  v_pnew := v_pj || jsonb_build_object('title', btrim(v_pj ->> 'title'));
  select coalesce(jsonb_object_agg(k, jsonb_build_array(to_jsonb(v_proj) -> k, v_pnew -> k)), '{}') into v_pc
  from jsonb_object_keys(v_pnew) k
  where (to_jsonb(v_proj) -> k) is distinct from (v_pnew -> k);

  if not p_dry_run and v_pc <> '{}' then
    update public.projects set
      title = case when v_pc ? 'title' then v_pnew ->> 'title' else title end,
      summary = case when v_pc ? 'summary' then v_pnew ->> 'summary' else summary end,
      currency = case when v_pc ? 'currency' then v_pnew ->> 'currency' else currency end,
      start_date = case when v_pc ? 'start_date' then (v_pnew ->> 'start_date')::date else start_date end,
      end_date = case when v_pc ? 'end_date' then (v_pnew ->> 'end_date')::date else end_date end
    where id = p_project_id;
  end if;

  -- 3. Milestones: what is removed, what is kept, and whether surviving rows change order.
  v_plan_keys := array(select e ->> 'key' from jsonb_array_elements(v_ms) e);

  select coalesce(jsonb_agg(jsonb_build_object('key', m.plan_key, 'title', m.title) order by m.position, m.created_at), '[]')
    into v_m_removed
  from public.milestones m
  where m.project_id = p_project_id and m.plan_key is not null and m.plan_key <> all (v_plan_keys);

  select coalesce(jsonb_agg(jsonb_build_object('title', m.title) order by m.position, m.created_at), '[]')
    into v_m_kept
  from public.milestones m
  where m.project_id = p_project_id and m.plan_key is null;

  select array_agg(m.id order by m.position, m.created_at) into v_cur
  from public.milestones m
  where m.project_id = p_project_id and (m.plan_key is null or m.plan_key = any (v_plan_keys));
  select array_agg(m.id order by coalesce(pk.ord, 1000000), m.position, m.created_at) into v_fin
  from public.milestones m
  left join (select e ->> 'key' as k, ord from jsonb_array_elements(v_ms) with ordinality t(e, ord)) pk on pk.k = m.plan_key
  where m.project_id = p_project_id and (m.plan_key is null or m.plan_key = any (v_plan_keys));
  v_reordered := v_cur is distinct from v_fin;

  if not p_dry_run then
    delete from public.milestones where project_id = p_project_id and plan_key is not null and plan_key <> all (v_plan_keys);
  end if;

  for v_i in 0 .. jsonb_array_length(v_ms) - 1 loop
    v_m := v_ms -> v_i;
    v_key := v_m ->> 'key';
    v_title := btrim(v_m ->> 'title');
    v_ac := array(select btrim(x) from jsonb_array_elements_text(coalesce(v_m -> 'acceptance_criteria', '[]')) with ordinality t(x, o) order by o);
    v_tt := array(select btrim(x) from jsonb_array_elements_text(coalesce(v_m -> 'tasks', '[]')) with ordinality t(x, o) order by o);

    select * into v_ex from public.milestones where project_id = p_project_id and plan_key = v_key;
    v_found := found;

    if not v_found then
      v_m_added := v_m_added || jsonb_build_object(
        'key', v_key, 'title', v_title, 'due_date', v_m -> 'due_date',
        'amount', coalesce((v_m ->> 'amount')::numeric, 0), 'tasks', to_jsonb(v_tt));
      v_id := null;
      if not p_dry_run then
        insert into public.milestones (project_id, position, title, description, acceptance_criteria, due_date, amount, plan_key)
        values (p_project_id, 0, v_title, v_m ->> 'description', v_ac, (v_m ->> 'due_date')::date,
                coalesce((v_m ->> 'amount')::numeric, 0), v_key)
        returning id into v_id;
        insert into public.tasks (milestone_id, project_id, position, title)
        select v_id, p_project_id, t.o::int, t.x from unnest(v_tt) with ordinality t(x, o);
      end if;
    else
      v_id := v_ex.id;
      v_chg := '{}';
      if v_ex.title is distinct from v_title then
        v_chg := v_chg || jsonb_build_object('title', jsonb_build_array(v_ex.title, v_title));
      end if;
      if v_m ? 'description' and v_ex.description is distinct from (v_m ->> 'description') then
        v_chg := v_chg || jsonb_build_object('description', jsonb_build_array(v_ex.description, v_m ->> 'description'));
      end if;
      if v_m ? 'acceptance_criteria' and v_ex.acceptance_criteria is distinct from v_ac then
        v_chg := v_chg || jsonb_build_object('acceptance_criteria', jsonb_build_array(to_jsonb(v_ex.acceptance_criteria), to_jsonb(v_ac)));
      end if;
      if v_ex.due_date is distinct from (v_m ->> 'due_date')::date then
        v_chg := v_chg || jsonb_build_object('due_date', jsonb_build_array(to_jsonb(v_ex.due_date), v_m -> 'due_date'));
      end if;
      if v_m ? 'amount' and v_ex.amount is distinct from (v_m ->> 'amount')::numeric then
        v_chg := v_chg || jsonb_build_object('amount', jsonb_build_array(v_ex.amount, (v_m ->> 'amount')::numeric));
      end if;

      v_tadd := '{}'; v_trem := '{}'; v_treorder := false;
      if v_m ? 'tasks' then
        v_et := array(select btrim(t.title) from public.tasks t where t.milestone_id = v_ex.id order by t.position, t.created_at);
        v_tadd := array(select distinct x from unnest(v_tt) x where x <> all (v_et));
        v_trem := array(select distinct x from unnest(v_et) x where x <> all (v_tt));
        v_treorder := array(select x from unnest(v_et) x where x = any (v_tt))
                      is distinct from array(select x from unnest(v_tt) with ordinality t(x, o) where x = any (v_et) order by o);
      end if;

      if v_chg <> '{}' or cardinality(v_tadd) > 0 or cardinality(v_trem) > 0 or v_treorder then
        v_m_changed := v_m_changed || jsonb_build_object(
          'key', v_key, 'title', v_title, 'changes', v_chg,
          'tasks', jsonb_build_object('added', to_jsonb(v_tadd), 'removed', to_jsonb(v_trem), 'reordered', v_treorder));
      end if;

      if not p_dry_run then
        if v_chg <> '{}' then
          update public.milestones set
            title = v_title,
            description = case when v_m ? 'description' then v_m ->> 'description' else description end,
            acceptance_criteria = case when v_m ? 'acceptance_criteria' then v_ac else acceptance_criteria end,
            due_date = (v_m ->> 'due_date')::date,
            amount = case when v_m ? 'amount' then (v_m ->> 'amount')::numeric else amount end
          where id = v_ex.id;
        end if;
        if v_m ? 'tasks' then
          delete from public.tasks where milestone_id = v_ex.id and btrim(title) <> all (v_tt);
          insert into public.tasks (milestone_id, project_id, position, title)
          select v_ex.id, p_project_id, t.o::int, t.x from unnest(v_tt) with ordinality t(x, o) where t.x = any (v_tadd);
          update public.tasks set position = array_position(v_tt, btrim(title))
            where milestone_id = v_ex.id and position is distinct from array_position(v_tt, btrim(title));
          perform public.renumber_tasks(v_ex.id);
        end if;
      end if;
    end if;

    if v_id is not null then
      v_ids := v_ids || v_id;
      v_idmap := v_idmap || jsonb_build_object(v_key, v_id);
    end if;
  end loop;

  -- 4. Payment requests.
  select coalesce(jsonb_agg(jsonb_build_object('key', q.plan_key, 'title', q.title) order by q.due_date, q.created_at), '[]')
    into v_p_removed
  from public.payment_requests q
  where q.project_id = p_project_id and q.plan_key is not null
    and q.plan_key <> all (array(select e ->> 'key' from jsonb_array_elements(v_pays) e));

  select coalesce(jsonb_agg(jsonb_build_object('title', q.title) order by q.due_date, q.created_at), '[]')
    into v_p_kept
  from public.payment_requests q
  where q.project_id = p_project_id and q.plan_key is null;

  if not p_dry_run then
    delete from public.payment_requests
    where project_id = p_project_id and plan_key is not null
      and plan_key <> all (array(select e ->> 'key' from jsonb_array_elements(v_pays) e));
  end if;

  for v_i in 0 .. jsonb_array_length(v_pays) - 1 loop
    v_p := v_pays -> v_i;
    v_key := v_p ->> 'key';
    v_title := btrim(v_p ->> 'title');

    select * into v_rq from public.payment_requests where project_id = p_project_id and plan_key = v_key;
    v_found := found;

    if not v_found then
      v_p_added := v_p_added || jsonb_build_object(
        'key', v_key, 'title', v_title, 'amount', (v_p ->> 'amount')::numeric,
        'due_date', v_p -> 'due_date', 'milestone', v_p -> 'milestone');
      if not p_dry_run then
        insert into public.payment_requests (project_id, milestone_id, title, amount, due_date, plan_key, created_by)
        values (p_project_id, (v_idmap ->> (v_p ->> 'milestone'))::uuid, v_title, (v_p ->> 'amount')::numeric,
                (v_p ->> 'due_date')::date, v_key, (select auth.uid()));
      end if;
    else
      v_chg := '{}';
      if v_rq.title is distinct from v_title then
        v_chg := v_chg || jsonb_build_object('title', jsonb_build_array(v_rq.title, v_title));
      end if;
      if v_rq.amount is distinct from (v_p ->> 'amount')::numeric then
        v_chg := v_chg || jsonb_build_object('amount', jsonb_build_array(v_rq.amount, (v_p ->> 'amount')::numeric));
      end if;
      if v_rq.due_date is distinct from (v_p ->> 'due_date')::date then
        v_chg := v_chg || jsonb_build_object('due_date', jsonb_build_array(to_jsonb(v_rq.due_date), v_p -> 'due_date'));
      end if;
      if v_p ? 'milestone' then
        select m.plan_key into v_old_key from public.milestones m where m.id = v_rq.milestone_id;
        if v_old_key is distinct from (v_p ->> 'milestone') then
          v_chg := v_chg || jsonb_build_object('milestone', jsonb_build_array(to_jsonb(v_old_key), v_p -> 'milestone'));
        end if;
      end if;

      if v_chg <> '{}' then
        v_p_changed := v_p_changed || jsonb_build_object('key', v_key, 'title', v_title, 'changes', v_chg);
        if not p_dry_run then
          update public.payment_requests set
            title = v_title,
            amount = (v_p ->> 'amount')::numeric,
            due_date = (v_p ->> 'due_date')::date,
            milestone_id = case when v_p ? 'milestone' then (v_idmap ->> (v_p ->> 'milestone'))::uuid else milestone_id end
          where id = v_rq.id;
        end if;
      end if;
    end if;
  end loop;

  -- 5. Order. Plan milestones take positions 1..n in plan order; kept (unkeyed) rows follow in their old order.
  if not p_dry_run then
    update public.milestones m set position = r.rn
    from (
      select id, row_number() over (
               order by coalesce(array_position(v_ids, id), 1000000), position, created_at)::int as rn
      from public.milestones where project_id = p_project_id
    ) r
    where m.id = r.id and m.position <> r.rn;
  end if;

  return jsonb_build_object(
    'valid', true,
    'applied', not p_dry_run,
    'errors', '[]'::jsonb,
    'project', jsonb_build_object('changes', v_pc),
    'milestones', jsonb_build_object(
      'added', v_m_added, 'changed', v_m_changed, 'removed', v_m_removed, 'kept', v_m_kept, 'reordered', v_reordered),
    'payments', jsonb_build_object(
      'added', v_p_added, 'changed', v_p_changed, 'removed', v_p_removed, 'kept', v_p_kept));
end;
$$;

revoke all on function
  public.plan_err(text, text), public.plan_join(text, text), public.plan_date(jsonb),
  public.plan_unknown_keys(jsonb, text, text[]), public.plan_check_text(jsonb, text, text, boolean, boolean, int),
  public.plan_check_date(jsonb, text, text, boolean), public.plan_check_amount(jsonb, text, text, boolean, boolean),
  public.plan_check_key(jsonb, text, text, text[]), public.validate_plan(jsonb),
  public.import_plan(uuid, jsonb, boolean, text)
from public, anon;
grant execute on function
  public.plan_err(text, text), public.plan_join(text, text), public.plan_date(jsonb),
  public.plan_unknown_keys(jsonb, text, text[]), public.plan_check_text(jsonb, text, text, boolean, boolean, int),
  public.plan_check_date(jsonb, text, text, boolean), public.plan_check_amount(jsonb, text, text, boolean, boolean),
  public.plan_check_key(jsonb, text, text, text[]), public.validate_plan(jsonb),
  public.import_plan(uuid, jsonb, boolean, text)
to authenticated, service_role;
