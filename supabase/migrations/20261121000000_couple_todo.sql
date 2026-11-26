create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade default auth.uid(),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 20)
);
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  owner_id uuid not null references public.profiles,
  invite_expires_at timestamptz
);
create table public.space_members (
  space_id uuid not null references public.spaces on delete cascade,
  user_id uuid not null unique references public.profiles,
  seat smallint not null check (seat in (1, 2)),
  primary key (space_id, user_id),
  unique (space_id, seat)
);
create table public.tasks (
  id uuid primary key,
  scope text not null check (scope in ('shared', 'personal')),
  space_id uuid references public.spaces on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles,
  assignee_id uuid references public.profiles,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  due_on date,
  created_at timestamptz not null default now(),
  is_complete boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.profiles,
  version integer not null default 1,
  constraint valid_scope check (
    (scope = 'personal' and space_id is null and assignee_id is not null and assignee_id = created_by)
    or (scope = 'shared' and space_id is not null)
  ),
  foreign key (space_id, created_by) references public.space_members (space_id, user_id),
  foreign key (space_id, assignee_id) references public.space_members (space_id, user_id)
);
create index tasks_shared_scope_date on public.tasks (space_id, due_on) where scope = 'shared';
create index tasks_personal_scope_date on public.tasks (created_by, due_on) where scope = 'personal';
create table public.task_completion_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks on delete cascade,
  actor_id uuid not null references public.profiles,
  occurred_at timestamptz not null default now(),
  completed boolean not null
);
create index completion_events_task_id on public.task_completion_events (task_id);
create table private.invitations (
  space_id uuid primary key references public.spaces on delete cascade,
  code_hash bytea not null,
  expires_at timestamptz not null
);
create table private.invite_attempts (
  user_id uuid primary key references auth.users on delete cascade,
  window_start timestamptz not null,
  failures integer not null default 0
);

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completion_events enable row level security;
alter table private.invitations enable row level security;
alter table private.invite_attempts enable row level security;

revoke all on public.profiles, public.spaces, public.space_members, public.tasks, public.task_completion_events from public, anon, authenticated;
revoke all on private.invitations, private.invite_attempts from public, anon, authenticated;
grant select on public.profiles, public.spaces, public.space_members, public.tasks, public.task_completion_events to authenticated;
grant insert (display_name), update (display_name) on public.profiles to authenticated;
grant insert (id, scope, space_id, title, assignee_id, due_on),
  update (title, assignee_id, due_on, is_complete), delete on public.tasks to authenticated;

create function private.is_member(candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.space_members where space_id = candidate and user_id = (select auth.uid()));
$$;
create function private.can_read_profile(candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select candidate = (select auth.uid()) or exists (
    select 1 from public.space_members target join public.space_members viewer using (space_id)
    where target.user_id = candidate and viewer.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_member(uuid), private.can_read_profile(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid), private.can_read_profile(uuid) to authenticated;

create policy profiles_read on public.profiles for select to authenticated using (private.can_read_profile(id));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_edit on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy spaces_read on public.spaces for select to authenticated using (private.is_member(id));
create policy space_members_read on public.space_members for select to authenticated using (private.is_member(space_id));
create policy tasks_read on public.tasks for select to authenticated using (
  (scope = 'personal' and created_by = (select auth.uid())) or (scope = 'shared' and private.is_member(space_id))
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  created_by = (select auth.uid()) and (scope = 'personal' or private.is_member(space_id))
);
create policy tasks_edit on public.tasks for update to authenticated using (
  (scope = 'personal' and created_by = (select auth.uid())) or (scope = 'shared' and private.is_member(space_id))
) with check (
  (scope = 'personal' and created_by = (select auth.uid())) or (scope = 'shared' and private.is_member(space_id))
);
create policy tasks_delete on public.tasks for delete to authenticated using (
  (scope = 'personal' and created_by = (select auth.uid())) or (scope = 'shared' and private.is_member(space_id))
);
create policy history_read on public.task_completion_events for select to authenticated using (
  exists (select 1 from public.tasks where id = task_id)
);

create function public.create_space() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  new_space uuid;
begin
  if viewer is null or not exists (select 1 from public.profiles where id = viewer) then return false; end if;
  insert into public.spaces (owner_id) values (viewer)
    on conflict (singleton) do nothing returning id into new_space;
  if new_space is null then return false; end if;
  insert into public.space_members (space_id, user_id, seat) values (new_space, viewer, 1);
  return true;
end;
$$;

create function public.issue_invite() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target uuid;
  raw_code text;
  expires timestamptz := now() + interval '24 hours';
begin
  select id into target from public.spaces where owner_id = auth.uid() for update;
  if target is null or exists (select 1 from public.space_members where space_id = target and seat = 2)
    then return null; end if;
  raw_code := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  insert into private.invitations (space_id, code_hash, expires_at) values (
    target, extensions.digest(raw_code, 'sha256'), expires
  ) on conflict (space_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  update public.spaces set invite_expires_at = expires where id = target;
  return jsonb_build_object('code', regexp_replace(raw_code, '(.{4})(?=.)', '\1-', 'g'), 'expires_at', expires);
end;
$$;

create function public.revoke_invite() returns boolean
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  select id into target from public.spaces where owner_id = auth.uid() for update;
  if target is null then return false; end if;
  delete from private.invitations where space_id = target;
  update public.spaces set invite_expires_at = null where id = target;
  return true;
end;
$$;

create function public.join_space(code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  target uuid;
  normalized text;
  attempts integer;
begin
  if viewer is null or not exists (select 1 from public.profiles where id = viewer) then return 'invalid'; end if;
  if exists (select 1 from public.space_members where user_id = viewer) then return 'already_joined'; end if;

  insert into private.invite_attempts as existing (user_id, window_start) values (viewer, now())
    on conflict (user_id) do update set
      window_start = case when existing.window_start <= now() - interval '15 minutes' then now() else existing.window_start end,
      failures = case when existing.window_start <= now() - interval '15 minutes' then 0 else existing.failures end
    returning failures into attempts;
  if attempts >= 5 then return 'rate_limited'; end if;

  if char_length(code) <= 64 then
    normalized := regexp_replace(upper(code), '[-[:space:]]', '', 'g');
  end if;
  select id into target from public.spaces for update;
  if target is not null and normalized ~ '^[A-F0-9]{16}$'
    and not exists (select 1 from public.space_members where space_id = target and seat = 2)
    and exists (
      select 1 from private.invitations where space_id = target and expires_at > clock_timestamp()
        and code_hash = extensions.digest(normalized, 'sha256')
    )
  then
    insert into public.space_members (space_id, user_id, seat) values (target, viewer, 2);
    delete from private.invitations where space_id = target;
    delete from private.invite_attempts where user_id = viewer;
    update public.spaces set invite_expires_at = null where id = target;
    return 'joined';
  end if;
  update private.invite_attempts set failures = failures + 1 where user_id = viewer;
  return 'invalid';
end;
$$;

revoke all on function public.create_space(), public.issue_invite(), public.revoke_invite(), public.join_space(text) from public, anon, authenticated;
grant execute on function public.create_space(), public.issue_invite(), public.revoke_invite(), public.join_space(text) to authenticated;

create function private.version_task() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  if new.is_complete is distinct from old.is_complete then
    new.completed_at := case when new.is_complete then clock_timestamp() end;
    new.completed_by := case when new.is_complete then auth.uid() end;
  end if;
  return new;
end;
$$;
create trigger version_task before update on public.tasks for each row execute function private.version_task();

create function private.record_task_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_completion_events (task_id, actor_id, completed)
    values (new.id, auth.uid(), new.is_complete);
  return null;
end;
$$;
create trigger record_task_history after update on public.tasks for each row
  when (old.is_complete is distinct from new.is_complete) execute function private.record_task_history();

create policy receive_changes on realtime.messages for select to authenticated using (
  extension = 'broadcast' and topic = (select realtime.topic()) and (
    (select realtime.topic()) = ('user:' || (select auth.uid())::text)
    or exists (
      select 1 from public.space_members
      where user_id = (select auth.uid()) and (select realtime.topic()) = ('space:' || space_id::text)
    )
  )
);
create function private.broadcast_tasks() returns trigger
language plpgsql security definer set search_path = '' as $$
declare topic text;
begin
  if coalesce(new.scope, old.scope) = 'shared'
    then topic := 'space:' || coalesce(new.space_id, old.space_id)::text;
    else topic := 'user:' || coalesce(new.created_by, old.created_by)::text;
  end if;
  perform realtime.send('{}'::jsonb, 'changed', topic, true);
  return null;
end;
$$;
create trigger sync_tasks after insert or update or delete on public.tasks for each row execute function private.broadcast_tasks();

create function private.broadcast_space() returns trigger
language plpgsql security definer set search_path = '' as $$
declare topic_space uuid;
begin
  if tg_table_name = 'space_members' then
    topic_space := new.space_id;
    perform realtime.send('{}'::jsonb, 'changed', 'user:' || new.user_id::text, true);
  elsif tg_table_name = 'profiles' then
    select space_id into topic_space from public.space_members where user_id = new.id;
    perform realtime.send('{}'::jsonb, 'changed', 'user:' || new.id::text, true);
  else
    topic_space := new.id;
  end if;
  if topic_space is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'space:' || topic_space::text, true);
  end if;
  return null;
end;
$$;
create trigger sync_members after insert on public.space_members for each row execute function private.broadcast_space();
create trigger sync_spaces after update on public.spaces for each row execute function private.broadcast_space();
create trigger sync_profile after update on public.profiles for each row execute function private.broadcast_space();
revoke all on function private.version_task(), private.record_task_history(), private.broadcast_tasks(), private.broadcast_space()
  from public, anon, authenticated;
