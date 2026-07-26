-- Seed pages, actions, and the default "Member" team.
-- Additional teams (Purchasing Team, Procurement Head, Accounts, etc.) and
-- their permission grants are created by an admin from within the app, not
-- hardcoded here — see spec §2.

insert into app_pages (key, label, sort_order) values
  ('submit_expense', 'Submit expense', 10),
  ('my_submissions', 'My submissions', 20),
  ('all_expenses', 'All expenses', 30),
  ('pricelist', 'Pricelist', 40),
  ('vendors', 'Vendors', 50),
  ('approvals', 'Approvals', 60),
  ('payments', 'Payments', 70),
  ('reports', 'Reports', 80),
  ('admin_users', 'Users', 90),
  ('admin_teams', 'Teams & permissions', 100);

insert into app_actions (key, label) values
  ('view', 'View'),
  ('submit', 'Submit'),
  ('edit_own', 'Edit/delete own (pre-decision)'),
  ('approve', 'Approve / decline'),
  ('mark_paid', 'Mark paid'),
  ('edit_master_data', 'Edit master data'),
  ('approve_master_data', 'Approve pending vendors/items'),
  ('manage_users', 'Manage users'),
  ('manage_teams', 'Manage teams & permissions'),
  ('export', 'Export/download');

insert into teams (name, is_default) values ('Member', true);

-- Default tier per §2: submit expenses and track only their own submissions.
insert into team_permissions (team_id, page_key, action_key)
select id, 'submit_expense', 'submit' from teams where is_default
union all
select id, 'submit_expense', 'edit_own' from teams where is_default
union all
select id, 'my_submissions', 'view' from teams where is_default;

-- Full-access bootstrap team ("Developer / super user" per §2). The very
-- first account ever created is auto-enrolled here (see 0003), so there's
-- always a way to reach the Teams & permissions admin page without a
-- chicken-and-egg problem. Admins can rename/reshape this team afterwards.
insert into teams (name) values ('Admin');

insert into team_permissions (team_id, page_key, action_key)
select t.id, p.key, a.key
from teams t
cross join app_pages p
cross join app_actions a
where t.name = 'Admin';
