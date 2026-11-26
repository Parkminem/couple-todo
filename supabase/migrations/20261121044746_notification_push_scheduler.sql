create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

create function private.kick_notification_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_url text;
  dispatch_key text;
begin
  if not exists (
    select 1 from private.notification_push_jobs where available_at <= clock_timestamp()
  ) then
    return;
  end if;

  select decrypted_secret into dispatch_url
    from vault.decrypted_secrets where name = 'couple_todo_notification_dispatch_url';
  select decrypted_secret into dispatch_key
    from vault.decrypted_secrets where name = 'couple_todo_notification_dispatch_key';

  if dispatch_url is null or dispatch_key is null or
    dispatch_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/dispatch-notifications$' then
    return;
  end if;

  perform net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-notification-key', dispatch_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
exception
  when others then
    -- Task changes and inbox inserts can succeed while the network queue recovers.
    raise warning 'Could not enqueue notification dispatch';
end;
$$;

create function private.wake_notification_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.kick_notification_dispatch();
  return null;
end;
$$;

revoke all on function private.kick_notification_dispatch() from public, anon, authenticated;
revoke all on function private.wake_notification_dispatch() from public, anon, authenticated;
revoke all on net.http_request_queue from public, anon, authenticated;

create trigger dispatch_notification_job
after insert on private.notification_push_jobs
for each statement execute function private.wake_notification_dispatch();

select cron.schedule(
  'couple-todo-push-retry', '* * * * *', 'select private.kick_notification_dispatch()'
);
