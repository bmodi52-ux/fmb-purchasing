-- Paying, accounting and budgeting, closer to the books (scratchpad #37, #38, #39).

-- ---------------------------------------------------------------------
-- #37 Payments
-- ---------------------------------------------------------------------

-- Where a remittance advice goes when a payee is paid. A member's payee falls
-- back to their own login address; a vendor's has to be given.
alter table payees add column remittance_email text;

comment on column payees.remittance_email is
  'Where the remittance advice is emailed when this payee is paid. Null for a '
  'member means their login address; null for anyone else means none is sent.';

-- The bank's word that a payment left, from an imported statement.
alter table expenses add column bank_confirmed_on date;
alter table expenses add column bank_confirmed_by uuid references profiles (id) on delete set null;
alter table expenses add column bank_statement_text text;

comment on column expenses.bank_confirmed_on is
  'The statement date of the bank line this payment was matched to, when a '
  'statement has been imported. Null means paid in the app, not yet seen on a statement.';

-- ---------------------------------------------------------------------
-- #38 Accounting
-- ---------------------------------------------------------------------

-- The account in the accounting file each category's spend goes to, e.g. 400.
alter table categories add column account_code text;

-- A period whose GST return has been lodged. An expense dated inside one can
-- no longer have its decision reopened, its payment reversed or its lines
-- reclassified: those would change a figure already reported. A late receipt
-- dated inside one can still be submitted, approved and paid — it belongs in
-- the next return as an adjustment, and the GST summary lists it as one.
create table locked_periods (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  label text not null,
  note text,
  locked_by uuid references profiles (id) on delete set null,
  locked_at timestamptz not null default now(),
  unlocked_by uuid references profiles (id) on delete set null,
  unlocked_at timestamptz,
  constraint locked_periods_dates check (start_date <= end_date)
);

create or replace function expense_in_locked_period(p_expense_id uuid) returns boolean
language sql stable
as $$
  select exists (
    select 1
    from expenses e
    join locked_periods l
      on l.unlocked_at is null
     and coalesce(e.receipt_date, (e.created_at at time zone 'Australia/Sydney')::date) between l.start_date and l.end_date
    where e.id = p_expense_id
  );
$$;

-- reopen_expense and reverse_payment as 0042 left them, refusing inside a
-- locked period.

create or replace function reopen_expense(
  p_expense_id uuid,
  p_actor uuid,
  p_reason text
) returns boolean
language plpgsql
as $$
declare
  v_status expense_status;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Reopening a decision needs a reason' using errcode = 'check_violation';
  end if;

  select status into v_status from expenses where id = p_expense_id for update;

  if v_status is null or v_status not in ('approved', 'declined') then
    return false;
  end if;

  if expense_in_locked_period(p_expense_id) then
    raise exception 'This expense is dated in a period whose GST return has been lodged, so its decision cannot be reopened'
      using errcode = 'check_violation';
  end if;

  update expenses
  set status = 'submitted',
      decision_comment = null,
      decided_by = null,
      decided_at = null,
      updated_at = now()
  where id = p_expense_id;

  insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment, is_reversal)
  values (p_expense_id, v_status, 'submitted', p_actor, btrim(p_reason), true);

  return true;
end;
$$;

create or replace function reverse_payment(
  p_expense_id uuid,
  p_actor uuid,
  p_reason text
) returns boolean
language plpgsql
as $$
declare
  v_status expense_status;
  v_run uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Reversing a payment needs a reason' using errcode = 'check_violation';
  end if;

  select status, payment_run_id into v_status, v_run
  from expenses where id = p_expense_id for update;

  if v_status is null or v_status <> 'paid' then
    return false;
  end if;

  if expense_in_locked_period(p_expense_id) then
    raise exception 'This expense is dated in a period whose GST return has been lodged, so its payment cannot be reversed'
      using errcode = 'check_violation';
  end if;

  update expenses
  set status = 'approved',
      payment_reference = null,
      payment_date = null,
      paid_by = null,
      payment_run_id = null,
      bank_confirmed_on = null,
      bank_confirmed_by = null,
      bank_statement_text = null,
      updated_at = now()
  where id = p_expense_id;

  insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment, is_reversal)
  values (p_expense_id, 'paid', 'approved', p_actor, btrim(p_reason), true);

  if v_run is not null and not exists (select 1 from expenses where payment_run_id = v_run) then
    delete from payment_runs where id = v_run;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- #39 Budgets
-- ---------------------------------------------------------------------

-- Monthly phasing: what share of a budget each month of its year carries.
-- Ramadan spend is not a twelfth of the year's. Twelve rows summing to 100,
-- or none (spread evenly by day). Month 1 is the first month of the budget's
-- own year — Shawwal for a Hijri year, July for a financial year.
create table category_budget_phasing (
  budget_id uuid not null references category_budgets (id) on delete cascade,
  month_index int not null check (month_index between 1 and 12),
  percent numeric(6, 3) not null check (percent >= 0),
  primary key (budget_id, month_index)
);

-- The built-in 80% and 100% budget alerts fire once per category, year and
-- percentage.
create table budget_alert_firings (
  category_id uuid not null references categories (id) on delete cascade,
  period_code text not null,
  percent int not null,
  fired_at timestamptz not null default now(),
  primary key (category_id, period_code, percent)
);

alter table locked_periods enable row level security;
alter table category_budget_phasing enable row level security;
alter table budget_alert_firings enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function expense_in_locked_period, reopen_expense, reverse_payment from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function expense_in_locked_period, reopen_expense, reverse_payment from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0052_finance.sql')
on conflict do nothing;
