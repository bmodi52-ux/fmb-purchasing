-- Notifications people choose, push to their phone, announcements and alert
-- rules (scratchpad #28), and the reminders built on them (#27).
--
-- Until now every notification was an in-app row and nothing else: an approver
-- who did not open the app never heard about anything. Each kind of
-- notification can now arrive in the app, as a push notification, or by
-- email, and each person turns those on and off for themselves. Admins set
-- what a team starts with, and can make a kind required for a team — the
-- Treasurer's team cannot turn off an account change. How the three layers
-- combine is in src/lib/notification-kinds.ts.

-- ---------------------------------------------------------------------
-- The kinds there now are
-- ---------------------------------------------------------------------

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in (
    'expense_submitted', 'expense_to_review', 'expense_approved',
    'expense_declined', 'expense_paid',
    'system_error',
    'reminder', 'escalation', 'announcement', 'alert', 'stand_in'
  )
);

-- ---------------------------------------------------------------------
-- Who wants what, how
-- ---------------------------------------------------------------------

create table notification_preferences (
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('in_app', 'push', 'email')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

comment on table notification_preferences is
  'A person''s own choice for one kind of notification on one channel. No row '
  'means they have not chosen, and their teams'' starting choice applies.';

create table team_notification_defaults (
  team_id uuid not null references teams (id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('in_app', 'push', 'email')),
  -- What members start with.
  enabled boolean not null,
  -- Members cannot turn it off.
  required boolean not null default false,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, kind, channel),
  constraint team_notification_defaults_required_enabled check (not required or enabled)
);

-- ---------------------------------------------------------------------
-- Push
-- ---------------------------------------------------------------------
-- One row per device a person has allowed. The endpoint is the device's
-- address with its browser's push service; p256dh and auth are the keys the
-- message is encrypted to. A subscription the push service reports gone is
-- deleted on the next send.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- "iPhone Safari", "Chrome on Windows" — so a person can tell their devices apart.
  device_label text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- ---------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  body text,
  link text,
  -- { "everyone": true } or { "teamIds": [...], "userIds": [...] }
  audience jsonb not null,
  recipient_count int not null default 0,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Alert rules
-- ---------------------------------------------------------------------
-- An alert an admin builds from set parts: when something happens, only if
-- it matches, tell these people. Evaluated in src/lib/alert-rules.ts.

create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  event text not null check (event in (
    'expense_submitted', 'expense_approved', 'expense_paid', 'vendor_added', 'budget_threshold'
  )),
  -- { minAmount?, categoryIds?, vendorIds?, budgetPercent?, calendar? }
  conditions jsonb not null default '{}'::jsonb,
  -- { teamIds: [...], userIds: [...] }
  recipients jsonb not null,
  active boolean not null default true,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Budget alerts fire once per rule, category and threshold crossing per
-- period, not on every expense after the line is crossed.
create table alert_rule_firings (
  rule_id uuid not null references alert_rules (id) on delete cascade,
  fired_key text not null,
  fired_at timestamptz not null default now(),
  primary key (rule_id, fired_key)
);

-- ---------------------------------------------------------------------
-- The daily job
-- ---------------------------------------------------------------------
-- Reminders run once a day. Vercel's scheduler works in UTC and Sydney moves
-- an hour twice a year, so the job is asked twice and does its work on the
-- first call at or after 8am Sydney time; this row is how it knows it already
-- has today.

create table scheduled_runs (
  job text primary key,
  last_run_on date not null,
  last_run_at timestamptz not null default now(),
  summary jsonb
);

alter table notification_preferences enable row level security;
alter table team_notification_defaults enable row level security;
alter table push_subscriptions enable row level security;
alter table announcements enable row level security;
alter table alert_rules enable row level security;
alter table alert_rule_firings enable row level security;
alter table scheduled_runs enable row level security;

insert into schema_migrations (filename) values ('0050_notification_channels.sql')
on conflict do nothing;
