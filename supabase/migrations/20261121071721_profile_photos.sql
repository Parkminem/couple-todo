alter table public.profiles add column photo_version uuid;

-- Keep the existing service-role profile grants scoped to the original columns.
revoke insert, update on public.profiles from service_role;
grant insert (id, display_name), update (id, display_name) on public.profiles to service_role;

create function private.is_valid_profile_jpeg(jpeg text) returns boolean
language plpgsql immutable strict set search_path = '' as $$
declare
  decoded bytea;
  byte_count integer;
begin
  if octet_length(jpeg) not between 8 and 87384 then return false; end if;

  decoded := decode(jpeg, 'base64');
  byte_count := octet_length(decoded);
  return byte_count between 5 and 65536
    and substr(decoded, 1, 2) = '\xffd8'::bytea
    and substr(decoded, byte_count - 1, 2) = '\xffd9'::bytea
    and jpeg = replace(encode(decoded, 'base64'), E'\n', '');
exception when invalid_parameter_value then
  return false;
end;
$$;
revoke all on function private.is_valid_profile_jpeg(text) from public, anon, authenticated, service_role;

create table public.profile_photos (
  profile_id uuid primary key references public.profiles on delete cascade,
  version uuid not null,
  jpeg text not null constraint profile_photos_valid_jpeg check (private.is_valid_profile_jpeg(jpeg))
);
alter table public.profile_photos enable row level security;
revoke all on public.profile_photos from public, anon, authenticated, service_role;
grant select on public.profile_photos to authenticated;
create policy profile_photos_read on public.profile_photos for select to authenticated
  using (private.can_read_profile(profile_id));

create function public.set_profile_photo(photo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  next_version uuid;
begin
  -- Set and remove take the same row lock before writing either table.
  perform 1 from public.profiles where id = viewer for update;
  if not found then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  if photo is null then
    delete from public.profile_photos where profile_id = viewer;
  else
    next_version := gen_random_uuid();
    insert into public.profile_photos (profile_id, version, jpeg)
      values (viewer, next_version, photo)
    on conflict (profile_id) do update set version = excluded.version, jpeg = excluded.jpeg;
  end if;

  update public.profiles set photo_version = next_version
    where id = viewer and photo_version is distinct from next_version;
  return next_version;
end;
$$;
revoke all on function public.set_profile_photo(text) from public, anon, authenticated, service_role;
grant execute on function public.set_profile_photo(text) to authenticated;
