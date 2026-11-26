create function private.is_valid_profile_jpeg(jpeg text, max_bytes integer) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  decoded bytea;
  byte_count integer;
begin
  if octet_length(jpeg) not between 8 and 4 * ((max_bytes + 2) / 3) then return false; end if;

  decoded := decode(jpeg, 'base64');
  byte_count := octet_length(decoded);
  return byte_count between 5 and max_bytes
    and substr(decoded, 1, 2) = '\xffd8'::bytea
    and substr(decoded, byte_count - 1, 2) = '\xffd9'::bytea
    and jpeg = replace(encode(decoded, 'base64'), E'\n', '');
exception when invalid_parameter_value then
  return false;
end;
$$;
revoke all on function private.is_valid_profile_jpeg(text, integer) from public, anon, authenticated, service_role;

create or replace function private.is_valid_profile_jpeg(jpeg text) returns boolean
language sql immutable strict set search_path = '' as $$
  select private.is_valid_profile_jpeg(jpeg, 65536);
$$;

alter table public.profile_photos add column full_jpeg text
  constraint profile_photos_valid_full_jpeg check (private.is_valid_profile_jpeg(full_jpeg, 786432));

create function public.set_profile_photo(photo text, full_photo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  next_version uuid;
begin
  -- Keep both photo sizes and their shared version in the same transaction.
  perform 1 from public.profiles where id = viewer for update;
  if not found then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  if photo is null then
    if full_photo is not null then
      raise exception 'Profile thumbnail required' using errcode = '23514';
    end if;
    delete from public.profile_photos where profile_id = viewer;
  else
    next_version := gen_random_uuid();
    insert into public.profile_photos (profile_id, version, jpeg, full_jpeg)
      values (viewer, next_version, photo, full_photo)
    on conflict (profile_id) do update set
      version = excluded.version, jpeg = excluded.jpeg, full_jpeg = excluded.full_jpeg;
  end if;

  update public.profiles set photo_version = next_version
    where id = viewer and photo_version is distinct from next_version;
  return next_version;
end;
$$;
revoke all on function public.set_profile_photo(text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_profile_photo(text, text) to authenticated;

-- Older app versions can still save a thumbnail or remove a photo.
create or replace function public.set_profile_photo(photo text) returns uuid
language sql security invoker set search_path = '' as $$
  select public.set_profile_photo(photo, null::text);
$$;
