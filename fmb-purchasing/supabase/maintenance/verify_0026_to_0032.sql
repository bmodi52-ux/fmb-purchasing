-- Run this in the Supabase SQL editor AFTER 2026-09-06_apply_0026_to_0032.sql.
--
-- Confirms the migration landed, and — more usefully — confirms the two things
-- that would be quietly wrong rather than loudly broken:
--
--   * expenses.receipt_file_path must still EXIST. Seven files still read it,
--     and Supabase queries name their columns in strings, so dropping it would
--     leave a database that applied cleanly and an application that fails at
--     runtime on pages nobody exercises until someone opens a receipt.
--
--   * the two new app_pages rows must have permission grants. Without them the
--     Needs attention and Budgets nav entries simply never appear, and the
--     pages look unbuilt rather than unpermissioned.

do $$
declare
  missing text := '';
  n int;
begin
  -- New tables
  foreach missing in array array[
    'payees', 'payment_runs', 'expense_attachments',
    'category_budgets', 'extraction_attempts', 'signin_attempts'
  ] loop
    if to_regclass('public.' || missing) is null then
      raise exception 'MISSING TABLE: %', missing;
    end if;
  end loop;
  raise notice 'tables            OK  (6 new tables present)';

  -- New columns
  select count(*) into n from information_schema.columns
  where (table_name, column_name) in (
    ('expense_line_items', 'kind'),
    ('expense_line_items', 'gst_applicable'),
    ('expenses', 'payee_id'),
    ('expenses', 'payment_run_id'),
    ('expense_status_history', 'is_reversal')
  );
  if n <> 5 then raise exception 'MISSING COLUMNS: expected 5, found %', n; end if;
  raise notice 'columns           OK  (5 new columns present)';

  -- The atomic write path
  select count(*) into n from pg_proc
  where proname in ('create_expense_with_lines', 'update_expense_with_lines', 'expense_lines_reconcile');
  if n < 3 then raise exception 'MISSING FUNCTIONS: expected 3, found %', n; end if;
  raise notice 'functions         OK  (atomic expense write present)';

  -- The deprecated column.
  --
  -- When this file was written it had to still exist, because seven readers
  -- named it in strings no type checker sees. Migration 0033 moved the last of
  -- those readers and dropped it, so both states are now correct and which one
  -- you see simply says how far the database has come. Verified by
  -- verify_0033.sql, not here.
  select count(*) into n from information_schema.columns
  where table_name = 'expenses' and column_name = 'receipt_file_path';
  if n = 1 then
    raise notice 'receipt_file_path present  (0033 not applied yet)';
  else
    raise notice 'receipt_file_path dropped  (0033 applied)';
  end if;

  select count(*) into n from expense_attachments;
  raise notice 'attachments       %  row(s)', n;

  -- New pages, and whether anyone can actually see them
  select count(*) into n from app_pages where key in ('review_queue', 'budgets');
  if n <> 2 then raise exception 'MISSING app_pages: expected 2, found %', n; end if;

  select count(*) into n from team_permissions where page_key in ('review_queue', 'budgets');
  if n = 0 then
    raise warning 'app_pages exist but NO team has been granted them — the nav entries will not appear. Grant them on the Teams & permissions page.';
  else
    raise notice 'permissions       OK  (% grant(s) on the new pages)', n;
  end if;

  -- The costing views, rebuilt by 0026 with the charge-line filter
  if to_regclass('public.item_paid_unit_costs') is null then
    raise exception 'item_paid_unit_costs is missing';
  end if;
  select count(*) into n from information_schema.columns
  where table_name = 'item_paid_unit_costs' and column_name = 'contents_confirmed';
  if n <> 1 then
    raise exception 'item_paid_unit_costs lost contents_confirmed — the view was rebuilt from the wrong definition';
  end if;
  raise notice 'costing views     OK  (rebuilt, 0014 columns intact)';

  raise notice '';
  raise notice 'All checks passed.';
end $$;
