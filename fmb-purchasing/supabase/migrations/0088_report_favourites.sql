-- The reports someone keeps to hand (Reports dashboard).
--
-- Reports are a row of links: Spending, Money out, Exceptions, Budgets, GST.
-- Which of them matter differs by who is looking — the treasurer lives in
-- Money out, a budget holder in Budgets — and nothing let a person say so.
-- A favourite is a star on a report: the dashboard lists a person's
-- favourites first, and each report's page shows whether it is one.
--
-- One row per person and report. The report is named by its key in the
-- registry (lib/reporting/registry), not by a foreign key: reports are
-- defined in code, and a key that is later retired is simply not shown.
--
-- Saved views (0053) are a different thing and stay as they are: a saved view
-- is a named set of filters on the Spending report, and can be shared; a
-- favourite is a person's own shortcut to a whole report.

create table report_favourites (
  user_id uuid not null references profiles (id) on delete cascade,
  report_key text not null check (report_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, report_key)
);

comment on table report_favourites is
  'Reports a person has starred, by registry key. The Reports dashboard lists them first.';

-- Written and read by the server alone, like every other table.
alter table report_favourites enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on report_favourites from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on report_favourites from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0088_report_favourites.sql')
on conflict do nothing;
