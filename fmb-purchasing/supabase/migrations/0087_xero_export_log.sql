-- A record of every Xero bills file downloaded (reports overhaul, P3).
--
-- The Accounting page makes a bills file for Xero's purchases import — one
-- draft bill per expense (#38). Nothing remembered that it had: download a
-- quarter's file, import it, download the quarter again a month later after
-- more approvals, and every bill from the first file is in the second, and
-- imports into Xero a second time. The file gave no warning, and nobody could
-- tell afterwards which expenses had gone to Xero and which had not.
--
-- Each download now records itself — who, when, which period and basis, and
-- the totals — and which expenses it held, at what total. The next download
-- can then say which of its bills went in an earlier file, offer to leave
-- them out, and point out any whose total has changed since it was sent.
--
-- A record of downloads, not of imports: the app cannot see Xero, and a file
-- downloaded may never be imported. It is what was handed over.

create table xero_exports (
  id uuid primary key default gen_random_uuid(),
  exported_by uuid references profiles (id) on delete set null,
  exported_at timestamptz not null default now(),
  period_code text not null,
  period_label text not null,
  start_date date not null,
  end_date date not null,
  basis text not null check (basis in ('receipt', 'paid')),
  -- Whether bills already in an earlier file were left out of this one.
  new_only boolean not null default false,
  bill_count int not null,
  line_count int not null,
  total numeric(14, 2) not null,
  gst numeric(14, 2) not null,
  missing_account_codes int not null default 0,
  constraint xero_exports_dates check (start_date <= end_date)
);

comment on table xero_exports is
  'Each Xero bills file downloaded from Accounting: who, when, which period and basis, '
  'and its totals. The expenses in it are in xero_export_expenses.';

create index xero_exports_exported_at_idx on xero_exports (exported_at desc);

create table xero_export_expenses (
  export_id uuid not null references xero_exports (id) on delete cascade,
  expense_id uuid not null references expenses (id) on delete cascade,
  -- The bill as it went: a later change to the expense shows against it.
  total numeric(12, 2) not null,
  gst numeric(12, 2) not null,
  primary key (export_id, expense_id)
);

comment on table xero_export_expenses is
  'Which expenses each Xero bills file held, as bills, at the total and GST they had then.';

create index xero_export_expenses_expense_idx on xero_export_expenses (expense_id);

-- Written and read by the server alone, like the other finance tables.
alter table xero_exports enable row level security;
alter table xero_export_expenses enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on xero_exports, xero_export_expenses from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on xero_exports, xero_export_expenses from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0087_xero_export_log.sql')
on conflict do nothing;
