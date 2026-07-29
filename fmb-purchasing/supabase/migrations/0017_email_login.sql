-- Email address becomes the login identity — part 1 of 2 (additive).
--
-- Until now, login was by username and the auth identity was a synthetic
-- address (username@login.fmbpurchasing.internal) built in app code, with
-- the real contact address kept alongside in profiles.email. That made
-- password reset awkward: Supabase's recovery tokens are minted against
-- auth.users.email, a domain that doesn't exist.
--
-- Signing in with the real email removes the second identifier entirely.
--
-- This half is deliberately backwards compatible, so it can be applied to a
-- live database before the new build is deployed: it only adds things, and
-- the trigger still populates username for the currently-running code.
-- Migration 0018 drops the column, and must not run until the new build is
-- live. See the release notes for the full order of operations.

-- ---------------------------------------------------------------------
-- 1. Force a password change after an admin-issued temporary password
-- ---------------------------------------------------------------------

alter table profiles
  add column must_change_password boolean not null default false;

comment on column profiles.must_change_password is
  'Set when an admin creates the account or issues a new temporary password. The app layout redirects to /change-password until it is cleared.';

-- ---------------------------------------------------------------------
-- 2. The contact address is about to become an identifier
-- ---------------------------------------------------------------------

-- Normalised on write from here on, so settle the existing rows to match.
-- This is what lets the app look an account up with a plain equality filter
-- when someone asks for a password reset, rather than a pattern match.
update profiles set email = lower(trim(email)) where email <> lower(trim(email));

-- auth.users already enforces uniqueness on the login address itself. This
-- stops profiles drifting into a state the auth schema would reject, and is
-- case-insensitive because addresses are compared that way everywhere else.
create unique index profiles_email_unique on profiles (lower(email));

comment on column profiles.email is
  'Login identity and notification address. Kept in step with auth.users.email.';

-- ---------------------------------------------------------------------
-- 3. Teach the signup trigger the new column, without dropping the old one
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.profiles) into is_first_user;

  insert into public.profiles (id, username, full_name, email, must_change_password)
  values (
    new.id,
    -- The new build stops sending a username. Until 0018 removes the column
    -- it still has to be non-null and unique, and two people can share a
    -- local part across different domains (a@one.com, a@two.com) — so fall
    -- back to the id, which cannot collide. These values are never displayed.
    coalesce(new.raw_user_meta_data ->> 'username', new.id::text),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
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
