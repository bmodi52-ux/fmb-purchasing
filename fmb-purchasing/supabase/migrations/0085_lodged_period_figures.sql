-- What was lodged, kept; and a cash-basis payment in a lodged period held
-- (reports audit, finding 2a-10).
--
-- 1. THE FIGURES AS LODGED
--
-- Locking a period (0052) stops its expenses being reopened, reversed or
-- reclassified, but kept no record of what was lodged. An expense dated in
-- the period and approved after it was locked is still counted in the
-- period's figures, so reopening a lodged quarter showed a G11 and a 1B that
-- were not the ones on the return, and nothing carried that expense into the
-- next return as the adjustment it is.
--
-- A lock now keeps the basis it was lodged on, the three figures, and which
-- expenses they counted. Anything dated in the period that they did not count
-- is an adjustment, owed to a later return; when that later period is locked,
-- the adjustments it took are recorded against it, so each is taken once.
--
-- Locks made before this migration have none of this, and are shown as they
-- were: their late approvals are still flagged by approval date.
--
-- 2. A PAYMENT DATED IN A LODGED PERIOD
--
-- reverse_payment refused only when the *expense* was dated in a lodged
-- period. On the cash basis a period's figures are its payments, so a payment
-- made inside a lodged quarter for an expense dated outside it could still be
-- reversed, changing a lodged figure. It now refuses when the payment date is
-- in a lodged period too.

alter table locked_periods
  add column lodged_basis text check (lodged_basis in ('receipt', 'paid')),
  add column lodged_g10 numeric(14, 2),
  add column lodged_g11 numeric(14, 2),
  add column lodged_1b numeric(14, 2),
  add column lodged_expense_ids uuid[] not null default '{}',
  add column adjustment_expense_ids uuid[] not null default '{}';

comment on column locked_periods.lodged_basis is
  'receipt (accruals) or paid (cash): which expenses the lodged figures counted. '
  'Null on locks made before 0085, which kept no figures.';
comment on column locked_periods.lodged_expense_ids is
  'The expenses the lodged figures counted. One dated in the period but not '
  'listed here is an adjustment for a later return.';
comment on column locked_periods.adjustment_expense_ids is
  'Expenses from earlier lodged periods this lodgement took as adjustments, '
  'so a later return does not take them again.';

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
  v_paid_on date;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Reversing a payment needs a reason' using errcode = 'check_violation';
  end if;

  select status, payment_run_id, payment_date into v_status, v_run, v_paid_on
  from expenses where id = p_expense_id for update;

  if v_status is null or v_status <> 'paid' then
    return false;
  end if;

  if expense_in_locked_period(p_expense_id) then
    raise exception 'This expense is dated in a period whose GST return has been lodged, so its payment cannot be reversed'
      using errcode = 'check_violation';
  end if;

  if v_paid_on is not null and exists (
    select 1 from locked_periods l
    where l.unlocked_at is null and v_paid_on between l.start_date and l.end_date
  ) then
    raise exception 'This payment was made in a period whose GST return has been lodged, so it cannot be reversed'
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function reverse_payment from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function reverse_payment from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0085_lodged_period_figures.sql')
on conflict do nothing;
