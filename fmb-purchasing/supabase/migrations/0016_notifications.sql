-- Moves expense notifications from email into the app.
--
-- Every submission, decision and payment sent mail, which for anyone doing
-- several a day buried the useful ones. The same events are now recorded
-- here and shown in the app, where they can be scanned, marked read, and
-- ignored without cluttering an inbox.
--
-- Deliberately not a general-purpose event log: this table exists to be read
-- by a person, so it stores the rendered title and body rather than a payload
-- to be re-interpreted later. expense_status_history remains the audit trail.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  -- who should see it; one row per recipient, so read state is per person
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (
    kind in ('expense_submitted', 'expense_to_review', 'expense_approved', 'expense_declined', 'expense_paid')
  ),
  title text not null,
  body text,
  -- where clicking it should take you, e.g. /approvals
  link text,
  -- kept so a notification can be traced back, and so the row disappears with
  -- the expense rather than pointing at something deleted
  expense_id uuid references expenses (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- The unread badge and the list are both "this user, newest first", and the
-- badge runs on every page load, so it's worth the index.
create index notifications_user_created_idx on notifications (user_id, created_at desc);
create index notifications_user_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;
