-- One bank transfer, several expenses.
--
-- Today the Treasurer receives an email headed "Please pay Burhanuddin Modi
-- directly $1,819.21" carrying six separate receipts, and makes one transfer.
-- Once each of those receipts is submitted individually — which is what
-- happens when submissions come through the site — the same real payment
-- becomes six expenses, six approvals and six payment records, each needing
-- the same date and reference typed again.
--
-- A payment run is that one transfer: a payee, a date, a reference, and the
-- expenses it settles.
--
-- The per-expense payment_date / payment_reference / paid_by columns stay and
-- are stamped from the run. They are read by the expenses table, the exports
-- and the notifications, and an expense should still be able to answer "when
-- were you paid" without a join. The run is the grouping; the columns remain
-- the record.

create table payment_runs (
  id uuid primary key default gen_random_uuid(),
  payee_id uuid not null references payees (id),
  payment_date date not null,
  payment_reference text,
  -- What the transfer was actually for, when it needs saying.
  note text,
  paid_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create sequence payment_run_seq;

alter table payment_runs
  add column run_number text not null
  default 'PR-' || lpad(nextval('payment_run_seq')::text, 4, '0');

alter table payment_runs add constraint payment_runs_number_key unique (run_number);

create index payment_runs_payee_idx on payment_runs (payee_id, payment_date desc);

comment on table payment_runs is
  'One outgoing bank transfer, settling one or more approved expenses for a '
  'single payee. Grouping only — each expense still records its own payment '
  'date and reference, stamped from the run.';

alter table expenses add column payment_run_id uuid references payment_runs (id) on delete set null;

create index expenses_payment_run_idx on expenses (payment_run_id) where payment_run_id is not null;

-- ---------------------------------------------------------------------
-- Undoing a decision
-- ---------------------------------------------------------------------
--
-- Approve, decline and paid were all terminal, which meant the only way to
-- correct a mistake was to edit the row in the Supabase dashboard — off the
-- record, invisible to the audit trail, and available only to whoever holds
-- the database password.
--
-- No new statuses: a reversal moves the expense back to a status it already
-- has, and the history table (0001) records the transition like any other.
-- That table was designed for exactly this — "additional steps become
-- additional rows rather than a schema change".
--
-- What is new is that a reversal must say why. An approval can be silent
-- because the expense speaks for itself; an unwind cannot, because six months
-- later the only question anyone asks about it is what happened.
alter table expense_status_history
  add column is_reversal boolean not null default false;

comment on column expense_status_history.is_reversal is
  'True when this row moved the expense backwards — unpaid, un-approved, or a '
  'decline reopened. The comment on such a row is mandatory in application code.';

-- ---------------------------------------------------------------------
-- New pages
-- ---------------------------------------------------------------------
--
-- Seeded here rather than created by an admin, so a page can ship with the
-- code that implements it (see the note on app_pages in 0001).
insert into app_pages (key, label, sort_order) values
  ('review_queue', 'Needs attention', 75),
  ('budgets', 'Budgets', 85)
on conflict (key) do nothing;

-- Whoever already approves expenses is who should see what needs a human.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'review_queue', 'view'
from team_permissions tp
where tp.page_key = 'approvals' and tp.action_key = 'approve'
on conflict do nothing;

-- Budgets are set by whoever manages master data, and read by whoever reads
-- reports.
insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'budgets', 'view'
from team_permissions tp
where tp.page_key = 'reports' and tp.action_key = 'view'
on conflict do nothing;

insert into team_permissions (team_id, page_key, action_key)
select tp.team_id, 'budgets', 'edit_master_data'
from team_permissions tp
where tp.page_key = 'pricelist' and tp.action_key = 'edit_master_data'
on conflict do nothing;

alter table payment_runs enable row level security;
