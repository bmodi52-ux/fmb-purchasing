-- One day an expense belongs to, worked out once, in Sydney (reports audit,
-- finding 2a-3).
--
-- An expense counts on the date of its receipt, or on the day it was
-- submitted when the receipt carried none. "The day it was submitted" was
-- being worked out two ways. The app read the first ten characters of
-- created_at, which is the day in UTC; expense_in_locked_period (0052)
-- converted to Sydney time first. From midnight until 10 or 11 in the morning
-- in Sydney those are different days, so an undated receipt submitted on the
-- morning of 1 July was June's in Reports and Accounting and July's to the
-- lock on a lodged quarter.
--
-- The day is now stored, in Sydney time, and everything that dates an expense
-- for a period reads it: Reports, Budgets, Accounting, All expenses and the
-- lock check. A column rather than a filter expression also lets a period's
-- expenses be found through an index, where the old filter was an OR across
-- two columns.
--
-- A trigger keeps it rather than a generated column: converting to a named
-- time zone is not immutable in Postgres (the zone's rules can change), and a
-- generated column's expression must be. It fires on every insert and update,
-- so the column cannot be written to anything else.

alter table expenses add column report_date date;

comment on column expenses.report_date is
  'The day this expense counts on: its receipt date, or the day it was submitted '
  'in Sydney when the receipt carried none. Kept by a trigger; read it rather '
  'than working the date out again.';

create or replace function set_expense_report_date() returns trigger
language plpgsql
as $$
begin
  new.report_date := coalesce(new.receipt_date, (new.created_at at time zone 'Australia/Sydney')::date);
  return new;
end;
$$;

create trigger expenses_report_date
  before insert or update on expenses
  for each row execute function set_expense_report_date();

-- The trigger works each row's value out; the assignment only gives the
-- update something to do. No other trigger on expenses fires on update, and
-- nothing stamps updated_at, so this changes no row's history.
update expenses set report_date = coalesce(receipt_date, (created_at at time zone 'Australia/Sydney')::date);

alter table expenses alter column report_date set not null;

create index expenses_report_date_idx on expenses (report_date);

-- 0052's lock check, reading the stored day instead of working it out again.
create or replace function expense_in_locked_period(p_expense_id uuid) returns boolean
language sql stable
as $$
  select exists (
    select 1
    from expenses e
    join locked_periods l
      on l.unlocked_at is null
     and e.report_date between l.start_date and l.end_date
    where e.id = p_expense_id
  );
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function set_expense_report_date, expense_in_locked_period from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function set_expense_report_date, expense_in_locked_period from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0083_expense_report_date.sql')
on conflict do nothing;
