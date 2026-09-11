-- Deciding, paying and undoing either happen completely or not at all.
--
-- 0031 moved writing an expense into one transaction, for a reason stated
-- there: an accounting record is the wrong place for a partial failure. The
-- four actions that move an expense through its life after that never got the
-- same treatment. Each was two or three separate PostgREST calls —
--
--   approve / decline   update expenses, then insert history
--   reopen              update expenses, then insert history
--   mark paid           insert payment_runs, update expenses, insert history
--   reverse payment     update expenses, insert history, maybe delete the run
--
-- — and none of the calls checked the error it got back. So a history insert
-- that failed after the status update left an expense Paid with nothing on the
-- record saying who paid it; an expense update that failed after the run
-- insert left an empty PR- number in the ledger; and in both cases the person
-- clicking saw the page refresh as though everything had worked.
--
-- Each is now one function. The caller checks for an error and says so.
-- Notifications stay in application code, after the function returns: they
-- are a courtesy, and a failure to send one must not undo a decision.

-- ---------------------------------------------------------------------
-- Approve or decline
-- ---------------------------------------------------------------------

create or replace function decide_expenses(
  p_expense_ids uuid[],
  p_actor uuid,
  p_decision text,
  p_comment text
) returns table (
  id uuid,
  expense_number text,
  vendor_name_raw text,
  total numeric,
  submitted_by uuid
)
language plpgsql
as $$
#variable_conflict use_column
begin
  if p_decision not in ('approved', 'declined') then
    raise exception 'A decision is approved or declined, not %', p_decision
      using errcode = 'check_violation';
  end if;

  -- status = 'submitted' in the WHERE makes this a compare-and-set: an expense
  -- decided by someone else a moment earlier is left alone, and is simply not
  -- among the rows returned.
  return query
  with decided as (
    update expenses e
    set status = p_decision::expense_status,
        decision_comment = p_comment,
        decided_by = p_actor,
        decided_at = now(),
        updated_at = now()
    where e.id = any (p_expense_ids)
      and e.status = 'submitted'
    returning e.id, e.expense_number, e.vendor_name_raw, e.total, e.submitted_by
  ),
  recorded as (
    insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment)
    select d.id, 'submitted', p_decision::expense_status, p_actor, p_comment
    from decided d
  )
  select d.id, d.expense_number, d.vendor_name_raw, d.total, d.submitted_by
  from decided d;
end;
$$;

-- ---------------------------------------------------------------------
-- Reopen a decision
-- ---------------------------------------------------------------------

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

  -- Paid expenses are reopened through reverse_payment, by whoever pays.
  if v_status is null or v_status not in ('approved', 'declined') then
    return false;
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

-- ---------------------------------------------------------------------
-- Mark paid
-- ---------------------------------------------------------------------

create or replace function pay_expenses(
  p_expense_ids uuid[],
  p_actor uuid,
  p_payment_date date,
  p_payment_reference text,
  p_note text
) returns table (
  run_id uuid,
  id uuid,
  expense_number text,
  vendor_name_raw text,
  total numeric,
  submitted_by uuid,
  payee_id uuid
)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_payees uuid[];
  v_run uuid;
begin
  if p_payment_date is null then
    raise exception 'A payment needs a date' using errcode = 'check_violation';
  end if;

  -- Lock first, so two people paying overlapping selections cannot both
  -- create a run for the same expenses.
  perform 1 from expenses x
  where x.id = any (p_expense_ids) and x.status = 'approved'
  for update;

  if not found then
    return;
  end if;

  select array_agg(distinct x.payee_id) filter (where x.payee_id is not null)
  into v_payees
  from expenses x
  where x.id = any (p_expense_ids) and x.status = 'approved';

  -- A run is one transfer, so it needs one payee. A mixed selection is still
  -- paid — the Treasurer may be clearing several people at once — it is just
  -- not one transfer, so it gets no run. (Unchanged from the app code this
  -- replaces.)
  if coalesce(array_length(v_payees, 1), 0) = 1 then
    insert into payment_runs (payee_id, payment_date, payment_reference, note, paid_by)
    values (v_payees[1], p_payment_date, p_payment_reference, p_note, p_actor)
    returning payment_runs.id into v_run;
  end if;

  return query
  with paid as (
    update expenses e
    set status = 'paid',
        payment_reference = p_payment_reference,
        payment_date = p_payment_date,
        paid_by = p_actor,
        payment_run_id = v_run,
        updated_at = now()
    where e.id = any (p_expense_ids)
      and e.status = 'approved'
    returning e.id, e.expense_number, e.vendor_name_raw, e.total, e.submitted_by, e.payee_id
  ),
  recorded as (
    insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment)
    select p.id, 'approved', 'paid', p_actor,
           case when p_payment_reference is not null
                then 'Payment reference: ' || p_payment_reference end
    from paid p
  )
  select v_run, p.id, p.expense_number, p.vendor_name_raw, p.total, p.submitted_by, p.payee_id
  from paid p;
end;
$$;

-- ---------------------------------------------------------------------
-- Reverse a payment
-- ---------------------------------------------------------------------

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

  update expenses
  set status = 'approved',
      payment_reference = null,
      payment_date = null,
      paid_by = null,
      payment_run_id = null,
      updated_at = now()
  where id = p_expense_id;

  insert into expense_status_history (expense_id, from_status, to_status, actor_id, comment, is_reversal)
  values (p_expense_id, 'paid', 'approved', p_actor, btrim(p_reason), true);

  -- A run that no longer settles anything is noise in the ledger. One that
  -- still covers other expenses stays, smaller — which is what happened.
  if v_run is not null and not exists (select 1 from expenses where payment_run_id = v_run) then
    delete from payment_runs where id = v_run;
  end if;

  return true;
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function decide_expenses, reopen_expense, pay_expenses, reverse_payment from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function decide_expenses, reopen_expense, pay_expenses, reverse_payment from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0042_atomic_decisions_and_payments.sql')
on conflict do nothing;
