-- Who was given access to what, and by whom.
--
-- Expenses have a history, prices have a history, bank accounts have a
-- history. Access to money did not: someone could be put in the Treasurer's
-- team for a day and taken out again, and nothing anywhere would say it had
-- happened. For an audit, "who could mark things paid in Ramadan?" is as real
-- a question as "who marked this paid?".
--
-- Recorded by triggers, not by the application, so a change made in the
-- Supabase dashboard is caught too. The app says who is acting by setting
-- app.actor_id for the transaction, through the admin_* functions below; a
-- change with no actor was made outside the app, and is shown that way.
--
-- Names are copied onto each row, because the record has to stay readable
-- after a team is renamed or a person leaves.

create table access_changes (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),

  -- Null when the change was made outside the app.
  actor_id uuid references profiles (id) on delete set null,

  kind text not null,

  team_id uuid references teams (id) on delete set null,
  team_name text,

  -- The person whose access changed, for membership and account changes.
  subject_id uuid references profiles (id) on delete set null,
  subject_name text,

  page_key text,
  action_key text,

  -- Free text for kinds that need more, e.g. a stand-in's dates (#35).
  detail text,

  constraint access_changes_kind_check check (kind in (
    'permission_granted', 'permission_revoked',
    'member_added', 'member_removed',
    'team_created', 'team_renamed', 'team_deleted',
    'account_deactivated', 'account_reactivated'
  ))
);

create index access_changes_changed_at_idx on access_changes (changed_at desc);
create index access_changes_subject_idx on access_changes (subject_id, changed_at desc)
  where subject_id is not null;

comment on table access_changes is
  'Every change to teams, team membership, team permissions and account '
  'activation. Written by triggers; actor_id is null for changes made outside '
  'the app.';

-- ---------------------------------------------------------------------
-- The triggers
-- ---------------------------------------------------------------------

create or replace function access_actor() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid;
$$;

-- Ids are looked up rather than copied: when a team or a person is deleted,
-- their memberships and grants go with them by cascade, and by the time these
-- triggers run the parent row is already gone — a copied id would fail its
-- foreign key and block the deletion. The name survives either way.
create or replace function log_team_permission_change() returns trigger
language plpgsql
as $$
declare
  r team_permissions;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into access_changes (actor_id, kind, team_id, team_name, page_key, action_key)
  select access_actor(),
         case when tg_op = 'DELETE' then 'permission_revoked' else 'permission_granted' end,
         t.id, t.name, r.page_key, r.action_key
  from (select 1) one
  left join teams t on t.id = r.team_id;
  return null;
end;
$$;

create trigger team_permissions_logged
after insert or delete on team_permissions
for each row execute function log_team_permission_change();

create or replace function log_team_member_change() returns trigger
language plpgsql
as $$
declare
  r team_members;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into access_changes (actor_id, kind, team_id, team_name, subject_id, subject_name, detail)
  select access_actor(),
         case when tg_op = 'DELETE' then 'member_removed' else 'member_added' end,
         t.id, t.name,
         p.id, coalesce(nullif(p.full_name, ''), p.email),
         -- New accounts join the default team from handle_new_user (0003),
         -- inside the transaction that creates the profile. Said so, rather
         -- than reading as a change made outside the app.
         case when tg_op = 'INSERT' and p.created_at = now()
              then 'Automatically, when the account was created' end
  from (select 1) one
  left join teams t on t.id = r.team_id
  left join profiles p on p.id = r.user_id;
  return null;
end;
$$;

create trigger team_members_logged
after insert or delete on team_members
for each row execute function log_team_member_change();

create or replace function log_team_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into access_changes (actor_id, kind, team_id, team_name)
    values (access_actor(), 'team_created', new.id, new.name);
  elsif tg_op = 'DELETE' then
    insert into access_changes (actor_id, kind, team_id, team_name)
    values (access_actor(), 'team_deleted', null, old.name);
  elsif new.name is distinct from old.name then
    insert into access_changes (actor_id, kind, team_id, team_name, detail)
    values (access_actor(), 'team_renamed', new.id, new.name, 'Was ' || old.name);
  end if;
  return null;
end;
$$;

create trigger teams_logged
after insert or update or delete on teams
for each row execute function log_team_change();

create or replace function log_account_activation() returns trigger
language plpgsql
as $$
begin
  if new.is_active is distinct from old.is_active then
    insert into access_changes (actor_id, kind, subject_id, subject_name)
    values (
      access_actor(),
      case when new.is_active then 'account_reactivated' else 'account_deactivated' end,
      new.id, coalesce(nullif(new.full_name, ''), new.email)
    );
  end if;
  return null;
end;
$$;

create trigger profiles_activation_logged
after update of is_active on profiles
for each row execute function log_account_activation();

-- ---------------------------------------------------------------------
-- How the app makes these changes, so the trigger knows who acted
-- ---------------------------------------------------------------------
-- set_config(..., true) lasts for the transaction, and each PostgREST RPC call
-- is one transaction, so the actor cannot leak into anyone else's change.

create or replace function admin_create_team(p_actor uuid, p_name text) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform set_config('app.actor_id', p_actor::text, true);
  insert into teams (name) values (btrim(p_name)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_set_membership(
  p_actor uuid, p_team_id uuid, p_user_id uuid, p_member boolean
) returns void
language plpgsql
as $$
begin
  perform set_config('app.actor_id', p_actor::text, true);
  if p_member then
    insert into team_members (team_id, user_id) values (p_team_id, p_user_id)
    on conflict do nothing;
  else
    delete from team_members where team_id = p_team_id and user_id = p_user_id;
  end if;
end;
$$;

create or replace function admin_set_permission(
  p_actor uuid, p_team_id uuid, p_page_key text, p_action_key text, p_granted boolean
) returns void
language plpgsql
as $$
begin
  perform set_config('app.actor_id', p_actor::text, true);
  if p_granted then
    insert into team_permissions (team_id, page_key, action_key)
    values (p_team_id, p_page_key, p_action_key)
    on conflict do nothing;
  else
    delete from team_permissions
    where team_id = p_team_id and page_key = p_page_key and action_key = p_action_key;
  end if;
end;
$$;

create or replace function admin_set_active(
  p_actor uuid, p_user_ids uuid[], p_active boolean
) returns void
language plpgsql
as $$
begin
  perform set_config('app.actor_id', p_actor::text, true);
  update profiles set is_active = p_active where id = any (p_user_ids);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function admin_create_team, admin_set_membership, admin_set_permission, admin_set_active from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function admin_create_team, admin_set_membership, admin_set_permission, admin_set_active from authenticated';
  end if;
end $$;

alter table access_changes enable row level security;

insert into schema_migrations (filename) values ('0045_access_changes.sql')
on conflict do nothing;
