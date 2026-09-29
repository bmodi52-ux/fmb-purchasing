-- Receipt dates that can't be right (reports audit, finding 2a-11).
--
-- A receipt date is read off the receipt, and sometimes misread. Live today:
-- one expense is dated 11 September 1994 and was submitted in 2026, and one
-- is dated 8 October 2026 but was submitted on 27 September, eleven days
-- before its own receipt, which looks like 10/08 read the wrong way round.
-- Nothing questioned either. The first stretched every year list in the app
-- back to 1994; both sit in reports under the wrong month.
--
-- The test is against the day the expense was submitted, in Sydney:
--
--   after submission   dated more than a day after it was submitted. A day
--                      of slack for a vendor in another time zone; nothing
--                      is bought after it is claimed for.
--   a year before      dated more than a year before it was submitted.
--                      Receipts do arrive late — live, up to 135 days — but
--                      not years late.
--
-- A view rather than a stored flag, because the rule is worth being able to
-- change without rewriting rows, and because it is read by two things only:
-- the year lists, which start from the earliest believable date, and Needs
-- attention, which lists the rest for someone to correct.

create view expense_date_checks
with (security_invoker = on) as
select
  e.id as expense_id,
  e.expense_number,
  e.status,
  e.vendor_name_raw,
  e.total,
  e.receipt_date,
  e.report_date,
  (e.created_at at time zone 'Australia/Sydney')::date as submitted_on,
  case
    when e.receipt_date is null then null
    when e.receipt_date > (e.created_at at time zone 'Australia/Sydney')::date + 1 then 'after_submission'
    when e.receipt_date < (e.created_at at time zone 'Australia/Sydney')::date - 365 then 'year_before_submission'
  end as concern
from expenses e;

comment on view expense_date_checks is
  'Each expense with a concern about its receipt date, if it has one: after_submission '
  '(dated more than a day after it was submitted) or year_before_submission (more than '
  'a year before). Null concern means the date is believable, or there is none.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on expense_date_checks from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on expense_date_checks from authenticated';
  end if;
end $$;

insert into schema_migrations (filename) values ('0084_expense_date_checks.sql')
on conflict do nothing;
