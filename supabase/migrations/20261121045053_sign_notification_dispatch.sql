-- Hosted pg_net can expose queued headers to database roles. Pass a short-lived
-- signature so the worker's reusable signing key never enters that queue.
create or replace function private.kick_notification_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_url text;
  dispatch_key text;
  challenge text;
  signature text;
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

  challenge := floor(extract(epoch from clock_timestamp()))::bigint::text || '.' || gen_random_uuid()::text;
  signature := encode(extensions.hmac(challenge, dispatch_key, 'sha256'), 'hex');

  perform net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-notification-signature', challenge || '.' || signature),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
exception
  when others then
    raise warning 'Could not enqueue notification dispatch';
end;
$$;
