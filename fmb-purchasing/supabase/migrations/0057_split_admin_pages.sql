-- Accounting, announcements, app settings and records become pages of their
-- own, so each can be granted without the grant that used to carry it.
--
-- Until now "Payments · Mark paid" also opened Accounting — the GST summary,
-- the Xero file, and locking a period once its return is lodged — and "Users ·
-- Manage users" also opened App settings, Announcements & alerts and Backups &
-- records. Both grants had grown well past their labels, and the Teams page
-- named none of it.
--
-- Nobody loses anything: every team holding the old grant is given the new
-- pages below, so today's access is exactly today's access until someone
-- changes it on purpose.

-- One action for "set this page up", for pages whose work is neither viewing
-- nor any of the expense verbs.
insert into app_actions (key, label) values ('manage', 'Manage')
on conflict (key) do nothing;

insert into app_pages (key, label, sort_order, is_permission_scope) values
  ('accounting', 'Accounting', 72, true),
  ('announcements', 'Announcements & alerts', 92, true),
  ('app_settings', 'App settings', 94, true),
  ('records', 'Backups & records', 96, true)
on conflict (key) do nothing;

-- Whoever can pay could already do all of this.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'accounting', granted.action
from team_permissions tp
cross join (values ('view'), ('export'), ('manage')) as granted (action)
where tp.page_key = 'payments' and tp.action_key = 'mark_paid'
on conflict do nothing;

-- And whoever administers accounts could already do all of this.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, page.key, granted.action
from team_permissions tp
cross join (values ('announcements'), ('app_settings'), ('records')) as page (key)
cross join (values ('view'), ('manage')) as granted (action)
where tp.page_key = 'admin_users' and tp.action_key = 'manage_users'
on conflict do nothing;

-- Granting or revoking a whole row or column of the permissions grid in one
-- go (the "all" toggles on Teams & permissions). One statement, so a row is
-- never half-granted, and the access-change triggers still record every cell.
create or replace function admin_set_permissions(
  p_actor uuid, p_team_id uuid, p_pages text[], p_actions text[], p_granted boolean
) returns void
language plpgsql
as $$
begin
  perform set_config('app.actor_id', p_actor::text, true);
  if p_granted then
    insert into team_permissions (team_id, page_key, action_key)
    select p_team_id, page_key, action_key
    from unnest(p_pages) as page_key
    cross join unnest(p_actions) as action_key
    on conflict do nothing;
  else
    delete from team_permissions
    where team_id = p_team_id
      and page_key = any (p_pages)
      and action_key = any (p_actions);
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function admin_set_permissions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function admin_set_permissions from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0057_split_admin_pages.sql')
on conflict do nothing;
