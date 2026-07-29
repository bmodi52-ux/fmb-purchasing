-- Somewhere for failures to go.
--
-- Until now every failure was a console.error landing in the host's logs,
-- which nobody reads. If receipt extraction started choking on one vendor's
-- PDF layout, the first anyone would know is a person mentioning it days
-- later.
--
-- Kept in this database rather than sent to a third-party error tracker,
-- because the payloads can carry receipt contents, vendor names and email
-- addresses — accounting data that shouldn't leave the org's own infra to
-- solve a monitoring problem.

create table error_events (
  id uuid primary key default gen_random_uuid(),

  -- Which part of the app failed: 'receipt-extraction', 'expense-submit',
  -- 'password-reset'. Deliberately free text — a CHECK constraint here would
  -- mean a migration every time a new call site starts reporting.
  source text not null,
  message text not null,
  -- stack trace, or whatever context the call site could supply
  detail text,

  -- Who hit it and what they were working on, where known. Both null out
  -- rather than cascade-delete: the record of a failure outlives the row
  -- that happened to trigger it.
  user_id uuid references profiles (id) on delete set null,
  expense_id uuid references expenses (id) on delete set null,

  -- The same fault recurring is one problem, not fifty. Occurrences collapse
  -- onto one row so the list stays readable and admins are told once.
  fingerprint text not null,
  seen_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Set when someone decides it's dealt with; a later occurrence of the same
  -- fingerprint opens a fresh row rather than resurrecting this one, so the
  -- history of "fixed, then came back" is preserved.
  resolved_at timestamptz,
  resolved_by uuid references profiles (id) on delete set null
);

-- One open row per distinct fault. Partial, so resolved rows accumulate as
-- history without blocking the next occurrence from opening a new one.
create unique index error_events_open_fingerprint_idx
  on error_events (fingerprint) where resolved_at is null;

-- The admin list is "unresolved, most recently seen first".
create index error_events_unresolved_idx
  on error_events (last_seen_at desc) where resolved_at is null;

alter table error_events enable row level security;

-- ---------------------------------------------------------------------
-- Recording an occurrence
-- ---------------------------------------------------------------------

-- Insert-or-increment has to be atomic: two functions failing at once would
-- otherwise race between the read and the write and lose an occurrence, or
-- collide on the unique index. Returns true when this opened a new row,
-- which is the caller's signal to notify — telling admins about every
-- occurrence of a recurring fault is how a notification list gets ignored.
create or replace function public.record_error_event(
  p_source text,
  p_message text,
  p_detail text default null,
  p_user_id uuid default null,
  p_expense_id uuid default null
)
returns boolean as $$
declare
  v_fingerprint text;
  v_is_new boolean;
begin
  -- Digits stripped so that ids, sizes and timestamps inside a message don't
  -- each look like a different fault.
  v_fingerprint := p_source || ':' || regexp_replace(p_message, '\d+', 'N', 'g');

  insert into public.error_events (
    source, message, detail, user_id, expense_id, fingerprint
  )
  values (
    p_source, p_message, p_detail, p_user_id, p_expense_id, v_fingerprint
  )
  on conflict (fingerprint) where resolved_at is null
  do update set
    seen_count   = error_events.seen_count + 1,
    last_seen_at = now(),
    -- keep the most recent context, which is likelier to be reproducible
    message      = excluded.message,
    detail       = coalesce(excluded.detail, error_events.detail),
    user_id      = coalesce(excluded.user_id, error_events.user_id),
    expense_id   = coalesce(excluded.expense_id, error_events.expense_id)
  returning (xmax = 0) into v_is_new;

  return coalesce(v_is_new, false);
end;
$$ language plpgsql security definer set search_path = public;

-- ---------------------------------------------------------------------
-- Notifications gain a system kind
-- ---------------------------------------------------------------------

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (
  kind in (
    'expense_submitted', 'expense_to_review', 'expense_approved',
    'expense_declined', 'expense_paid',
    'system_error'
  )
);
