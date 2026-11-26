create table public.notification_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  task_added boolean not null default true,
  task_completed boolean not null default true,
  task_changed boolean not null default true,
  quiet_enabled boolean not null default false,
  quiet_start time not null default '22:00',
  quiet_end time not null default '08:00',
  check (quiet_start < time '24:00' and quiet_end < time '24:00'),
  check (not quiet_enabled or quiet_start <> quiet_end)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('added', 'completed', 'changed')),
  change_kind text,
  task_title text not null check (char_length(task_title) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  check (
    (kind = 'changed' and change_kind is not null
      and change_kind in ('deadline', 'assignee', 'deadline_and_assignee', 'deleted'))
    or (kind <> 'changed' and change_kind is null)
  )
);
create index notifications_inbox on public.notifications (recipient_id, created_at desc, id desc);
create index notifications_unread on public.notifications (recipient_id) where read_at is null;

create table private.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  revision uuid not null default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null
);
create index notification_subscriptions_user on private.notification_subscriptions (user_id);

create table private.notification_push_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications on delete cascade,
  subscription_id uuid not null references private.notification_subscriptions on delete cascade,
  subscription_revision uuid not null,
  available_at timestamptz not null default clock_timestamp(),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  claim_token uuid,
  unique (notification_id, subscription_id)
);
create index notification_push_jobs_ready on private.notification_push_jobs (available_at, id);
create index notification_push_jobs_subscription on private.notification_push_jobs (subscription_id);

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table private.notification_subscriptions enable row level security;
alter table private.notification_push_jobs enable row level security;

revoke all on public.notification_preferences, public.notifications,
  private.notification_subscriptions, private.notification_push_jobs
  from public, anon, authenticated, service_role;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, update (read_at) on public.notifications to authenticated;

create policy notification_preferences_read on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

create function public.register_notification_subscription(endpoint text, p256dh text, auth_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null or not coalesce(
    octet_length(endpoint) between 1 and 2000
    and endpoint collate "C" ~ $url$\Ahttps://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]dev[.]apple[.]com|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+push[.]apple[.]com)/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]+\Z$url$
    and p256dh collate "C" ~ $key$\AB[A-P][A-Za-z0-9_-]{84}[AEIMQUYcgkosw048]\Z$key$
    and auth_key collate "C" ~ $key$\A[A-Za-z0-9_-]{21}[AQgw]\Z$key$,
    false
  ) then
    return false;
  end if;

  insert into private.notification_subscriptions as current (user_id, endpoint, p256dh, auth_key)
  values (viewer, endpoint, p256dh, auth_key)
  on conflict on constraint notification_subscriptions_endpoint_key do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth_key = excluded.auth_key,
    revision = case
      when (current.user_id, current.p256dh, current.auth_key)
        is distinct from (excluded.user_id, excluded.p256dh, excluded.auth_key) then gen_random_uuid()
      else current.revision
    end
  where current.user_id = viewer
    or (current.p256dh = excluded.p256dh and current.auth_key = excluded.auth_key);
  return found;
end;
$$;

create function public.has_notification_subscription(endpoint text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.notification_subscriptions s
    where s.endpoint = $1 and s.user_id = (select auth.uid())
  );
$$;

create function public.unregister_notification_subscription(endpoint text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from private.notification_subscriptions s
  where s.endpoint = $1 and s.user_id = (select auth.uid());
  return found;
end;
$$;

revoke all on function public.register_notification_subscription(text, text, text),
  public.has_notification_subscription(text), public.unregister_notification_subscription(text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_notification_subscription(text, text, text),
  public.has_notification_subscription(text), public.unregister_notification_subscription(text)
  to authenticated;

create function private.notification_type_enabled(kind text, prefs public.notification_preferences)
returns boolean language sql immutable set search_path = '' as $$
  select case kind
    when 'added' then coalesce((prefs).task_added, true)
    when 'completed' then coalesce((prefs).task_completed, true)
    when 'changed' then coalesce((prefs).task_changed, true)
    else false
  end;
$$;

create function private.notification_is_quiet(prefs public.notification_preferences, local_time time)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((prefs).quiet_enabled and case
    when (prefs).quiet_start < (prefs).quiet_end then
      local_time >= (prefs).quiet_start and local_time < (prefs).quiet_end
    else local_time >= (prefs).quiet_start or local_time < (prefs).quiet_end
  end, false);
$$;

create function private.notify_shared_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  partner uuid;
  prefs public.notification_preferences;
  event_kind text;
  event_change text;
  deadline_changed boolean;
  assignee_changed boolean;
  inbox_id uuid;
  local_time time := (clock_timestamp() at time zone 'Asia/Seoul')::time;
begin
  task := case when tg_op = 'DELETE' then old else new end;
  if task.scope <> 'shared' or actor is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    event_kind := 'added';
  elsif tg_op = 'DELETE' then
    event_kind := 'changed';
    event_change := 'deleted';
  elsif new.is_complete and not old.is_complete then
    event_kind := 'completed';
  else
    deadline_changed := new.due_on is distinct from old.due_on;
    assignee_changed := new.assignee_id is distinct from old.assignee_id;
    if not (deadline_changed or assignee_changed) then
      return null;
    end if;
    event_kind := 'changed';
    event_change := case
      when deadline_changed and assignee_changed then 'deadline_and_assignee'
      when deadline_changed then 'deadline'
      else 'assignee'
    end;
  end if;

  select recipient.user_id into partner
  from public.space_members recipient
  join public.space_members author using (space_id)
  where recipient.space_id = task.space_id and author.user_id = actor and recipient.user_id <> actor;
  if not found then
    return null;
  end if;
  select * into prefs from public.notification_preferences where user_id = partner;
  if not private.notification_type_enabled(event_kind, prefs) then
    return null;
  end if;

  insert into public.notifications (recipient_id, kind, change_kind, task_title)
  values (partner, event_kind, event_change, task.title)
  returning id into inbox_id;

  if not private.notification_is_quiet(prefs, local_time) then
    insert into private.notification_push_jobs (notification_id, subscription_id, subscription_revision)
    select inbox_id, s.id, s.revision from private.notification_subscriptions s where s.user_id = partner;
  end if;
  return null;
end;
$$;

create function private.broadcast_notifications() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.read_at is distinct from old.read_at then
    perform realtime.send('{}'::jsonb, 'changed', 'user:' || new.recipient_id::text, true);
  end if;
  return null;
end;
$$;

create trigger notify_shared_task after insert or update or delete on public.tasks
  for each row execute function private.notify_shared_task();
create trigger sync_notifications after insert or update of read_at on public.notifications
  for each row execute function private.broadcast_notifications();

create function public.claim_notification_push_jobs()
returns table (
  id uuid, claim_token uuid, notification_id uuid, kind text, change_kind text,
  task_title text, endpoint text, p256dh text, auth_key text
)
language sql security definer set search_path = '' as $$
  with run as materialized (
    select clock_timestamp() as started_at
  ), ready as materialized (
    select j.id, run.started_at,
      j.attempt_count < 5 and n.created_at > run.started_at - interval '1 hour'
      and s.user_id = n.recipient_id and s.revision = j.subscription_revision
      and private.notification_type_enabled(n.kind, p)
      and not private.notification_is_quiet(p, (run.started_at at time zone 'Asia/Seoul')::time) as eligible
    from private.notification_push_jobs j
    join public.notifications n on n.id = j.notification_id
    join private.notification_subscriptions s on s.id = j.subscription_id
    left join public.notification_preferences p on p.user_id = n.recipient_id
    cross join run
    where j.available_at <= run.started_at
    order by j.available_at, j.id
    limit 20 for update of j skip locked
  ), discarded as (
    delete from private.notification_push_jobs j using ready
    where j.id = ready.id and not ready.eligible
  ), claimed as (
    update private.notification_push_jobs j set
      available_at = ready.started_at + interval '2 minutes',
      claim_token = gen_random_uuid(),
      attempt_count = j.attempt_count + 1
    from ready where j.id = ready.id and ready.eligible
    returning j.id, j.claim_token, j.notification_id, j.subscription_id
  )
  select c.id, c.claim_token, c.notification_id, n.kind, n.change_kind, n.task_title, s.endpoint, s.p256dh, s.auth_key
  from claimed c
  join public.notifications n on n.id = c.notification_id
  join private.notification_subscriptions s on s.id = c.subscription_id;
$$;

create function public.finish_notification_push_job(job_id uuid, lease_token uuid, outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job private.notification_push_jobs;
  finished_at timestamptz;
begin
  if outcome is null or outcome not in ('sent', 'retry', 'expired', 'failed') then
    return false;
  end if;

  if outcome = 'expired' then
    -- Take the subscription lock first, matching the lock order of device removal.
    perform 1 from private.notification_subscriptions s
    join private.notification_push_jobs j on j.subscription_id = s.id and j.subscription_revision = s.revision
    where j.id = job_id and j.claim_token = lease_token and j.available_at > clock_timestamp()
    for update of s;
  end if;

  finished_at := clock_timestamp();
  select * into job from private.notification_push_jobs
  where id = job_id and claim_token = lease_token and available_at > finished_at for update;
  if not found then
    return false;
  end if;

  if outcome = 'expired' then
    delete from private.notification_subscriptions
    where id = job.subscription_id and revision = job.subscription_revision;
    if found then
      return true;
    end if;
  end if;

  if outcome = 'retry' and job.attempt_count < 5 then
    update private.notification_push_jobs set
      available_at = finished_at + interval '1 minute' * (2 ^ (job.attempt_count - 1)),
      claim_token = null
    where id = job_id;
  else
    delete from private.notification_push_jobs where id = job_id;
  end if;
  return true;
end;
$$;

revoke all on function private.notification_type_enabled(text, public.notification_preferences),
  private.notification_is_quiet(public.notification_preferences, time),
  private.notify_shared_task(), private.broadcast_notifications(),
  public.claim_notification_push_jobs(), public.finish_notification_push_job(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_notification_push_jobs(), public.finish_notification_push_job(uuid, uuid, text)
  to service_role;
