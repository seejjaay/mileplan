-- Phase 5: messages.
-- The thread's rules live here: body shape, attachment shape, a server-owned edited_at, and the read/unread RPCs.
-- The 15-minute edit window (RLS) and the 30-day post-close window (lock trigger) already exist.

-- 1. Body: at least one non-whitespace character, at most 4000. btrim only strips spaces, so a body of
-- newlines would pass it; \S does not.
alter table public.messages
  add constraint messages_body_check check (body ~ '\S' and char_length(body) <= 4000);

-- 2. Attachments: at most 5, each exactly { path, name, size, mime }. Checked on insert only; the update grant
-- below leaves no way to change them afterwards. Raises 22023 naming the rule.
create function public.messages_validate_attachments() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_i int;
  v_at text;
  v_path text;
  v_name text;
  v_size jsonb;
begin
  if jsonb_typeof(new.attachments) <> 'array' then
    raise exception 'attachments must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(new.attachments) > 5 then
    raise exception 'attachments can hold at most 5 items' using errcode = '22023';
  end if;

  for v_item, v_i in select e.value, (e.ordinality - 1)::int from jsonb_array_elements(new.attachments) with ordinality e loop
    v_at := format('attachments[%s]', v_i);
    if jsonb_typeof(v_item) <> 'object' then
      raise exception '% must be an object', v_at using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('path', 'name', 'size', 'mime')) then
      raise exception '% has a key that is not allowed', v_at using errcode = '22023';
    end if;
    if not (v_item ? 'path' and v_item ? 'name' and v_item ? 'size' and v_item ? 'mime') then
      raise exception '% needs path, name, size and mime', v_at using errcode = '22023';
    end if;

    if jsonb_typeof(v_item -> 'path') <> 'string' or jsonb_typeof(v_item -> 'name') <> 'string'
       or jsonb_typeof(v_item -> 'mime') <> 'string' then
      raise exception '% path, name and mime must be strings', v_at using errcode = '22023';
    end if;
    v_path := v_item ->> 'path';
    v_name := v_item ->> 'name';
    if char_length(v_name) < 1 or char_length(v_name) > 200 then
      raise exception '%.name must be 1 to 200 characters', v_at using errcode = '22023';
    end if;
    v_size := v_item -> 'size';
    if jsonb_typeof(v_size) <> 'number' or (v_size #>> '{}')::numeric <> trunc((v_size #>> '{}')::numeric)
       or (v_size #>> '{}')::numeric < 1 or (v_size #>> '{}')::numeric > 10485760 then
      raise exception '%.size must be a whole number from 1 to 10485760', v_at using errcode = '22023';
    end if;
    if left(v_path, 37) <> new.project_id::text || '/' or '..' = any (string_to_array(v_path, '/')) then
      raise exception '%.path is outside this project', v_at using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;

create trigger messages_validate_attachments before insert on public.messages
  for each row execute function public.messages_validate_attachments();

-- 3. edited_at belongs to the server: set when the body changes, otherwise carried over.
create function public.messages_set_edited_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  return new;
end;
$$;

create trigger messages_set_edited_at before update on public.messages
  for each row execute function public.messages_set_edited_at();

-- Only the body is editable by a client; edited_at and attachments are not.
revoke update on public.messages from authenticated;
grant update (body) on public.messages to authenticated;

-- 4. Read state. security INVOKER: message_reads and messages RLS apply, can_see is the gate.
create function public.mark_messages_read(p_project_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not public.can_see(p_project_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.message_reads (project_id, user_id, last_read_at)
  values (p_project_id, (select auth.uid()), now())
  on conflict (project_id, user_id) do update set last_read_at = now();
end;
$$;

-- One row per project with unread messages from other people; a zero count has no row.
create function public.unread_message_counts() returns table (project_id uuid, unread int)
language sql stable set search_path = '' as $$
  select m.project_id, count(*)::int
  from public.messages m
  left join public.message_reads r on r.project_id = m.project_id and r.user_id = (select auth.uid())
  where m.sender_id <> (select auth.uid())
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.project_id
$$;

revoke all on function public.messages_validate_attachments(), public.messages_set_edited_at(),
  public.mark_messages_read(uuid), public.unread_message_counts() from public, anon;
grant execute on function public.mark_messages_read(uuid), public.unread_message_counts() to authenticated, service_role;

-- 5. Realtime, unless an earlier migration already added it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
