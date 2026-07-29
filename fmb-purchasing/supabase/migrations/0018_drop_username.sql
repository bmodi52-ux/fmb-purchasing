-- Email address becomes the login identity — part 2 of 2.
--
-- Run only once the build that signs in by email is live, and once every
-- auth.users.email has been repointed from its synthetic
-- @login.fmbpurchasing.internal address to the real one. Until then the
-- deployed code still reads profiles.username and this would break it.

-- Replaced before the drop so the trigger is never momentarily referencing a
-- column that no longer exists.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.profiles) into is_first_user;

  insert into public.profiles (id, full_name, email, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    -- The auth identity is now the real address, so it is the natural
    -- default; the metadata key stays as an override for any caller that
    -- wants notifications sent somewhere other than the login address.
    coalesce(new.raw_user_meta_data ->> 'contact_email', new.email),
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  );

  insert into public.team_members (team_id, user_id)
  select id, new.id from public.teams where is_default;

  -- Bootstrap: the very first account gets full access (see 0002) so there's
  -- always someone who can reach the permissions admin page.
  if is_first_user then
    insert into public.team_members (team_id, user_id)
    select id, new.id from public.teams where name = 'Admin';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

alter table profiles drop column username;
