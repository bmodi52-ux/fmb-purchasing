-- A stand-in for a date range (scratchpad #35).
--
-- Approving and paying each rest on a few people, and when one of them is away
-- — travelling for Ashara, unwell — expenses wait until they are back. The
-- person going away now names who covers for them, which duty, and between
-- which dates. For those days the stand-in holds that duty and nothing else;
-- src/lib/permissions.ts reads active rows alongside team grants.
--
-- A nomination is a temporary grant of access, so it is recorded with the
-- other access changes (0045), and admins are told.

create table stand_ins (
  id uuid primary key default gen_random_uuid(),
  -- The person going away.
  user_id uuid not null references profiles (id) on delete cascade,
  stand_in_id uuid not null references profiles (id) on delete cascade,
  duty text not null check (duty in ('approve', 'pay')),
  starts_on date not null,
  ends_on date not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id) on delete set null,

  constraint stand_ins_dates check (starts_on <= ends_on),
  constraint stand_ins_not_self check (user_id <> stand_in_id)
);

create index stand_ins_active_idx on stand_ins (stand_in_id, starts_on, ends_on) where cancelled_at is null;
create index stand_ins_user_idx on stand_ins (user_id, starts_on desc);

alter table stand_ins enable row level security;

-- The access-change record gains the two things a nomination can do.
alter table access_changes drop constraint access_changes_kind_check;
alter table access_changes add constraint access_changes_kind_check check (kind in (
  'permission_granted', 'permission_revoked',
  'member_added', 'member_removed',
  'team_created', 'team_renamed', 'team_deleted',
  'account_deactivated', 'account_reactivated',
  'stand_in_nominated', 'stand_in_cancelled'
));

insert into schema_migrations (filename) values ('0051_stand_ins.sql')
on conflict do nothing;
