-- Auto-provision a profile + default team membership whenever a new
-- auth.users row is created (admin-created accounts, §2). Metadata is
-- passed in at auth.admin.createUser() time from the "Users" admin page.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  is_first_user boolean;
begin
  select not exists (select 1 from public.profiles) into is_first_user;

  insert into public.profiles (id, username, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'contact_email', new.email)
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
