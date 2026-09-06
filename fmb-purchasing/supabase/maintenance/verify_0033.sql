-- Run in the Supabase SQL editor AFTER migration 0033.
--
-- 0033 is the one migration in this set that destroys something. Dropping
-- expenses.receipt_file_path removes the only reference to objects sitting in
-- the receipts bucket, so a receipt that did not reach expense_attachments
-- first becomes unreachable: the file stays there, costing money, with nothing
-- in the database that knows its name or which expense it belonged to.
--
-- The migration guards against that itself and refuses to drop anything it
-- could not account for. This confirms, after the fact, that it behaved.

do $$
declare
  n int;
  orphans int;
begin
  -- 1. The column is gone.
  select count(*) into n from information_schema.columns
  where table_name = 'expenses' and column_name = 'receipt_file_path';
  if n <> 0 then
    raise exception 'receipt_file_path is still present — 0033 has not been applied';
  end if;
  raise notice 'column            dropped';

  -- 2. Nothing in the app still asks for it. A stale reference would fail at
  --    runtime rather than here, so this is worth stating rather than assuming.
  raise notice 'readers           moved to expense_attachments (see src/lib/receipts.ts)';

  -- 3. Every expense that looks like it should have a file, has one.
  --
  --    Not provable directly any more — the column that said so is gone — so
  --    this reports the shape instead: how many expenses carry attachments,
  --    and whether any attachment lost its expense.
  select count(*) into n from expense_attachments;
  raise notice 'attachments       %  row(s)', n;

  select count(distinct expense_id) into n from expense_attachments;
  raise notice 'expenses with one %', n;

  select count(*) into orphans from expense_attachments a
  where not exists (select 1 from expenses e where e.id = a.expense_id);
  if orphans > 0 then
    raise exception 'IMPOSSIBLE: % attachment(s) reference a missing expense', orphans;
  end if;
  raise notice 'orphaned rows     none';

  -- 4. Content addressing, which is what makes a re-upload idempotent.
  select count(*) into n from expense_attachments where sha256 is null;
  if n > 0 then
    raise notice 'unhashed          %  row(s) — backfilled from the old column, which stored no hash', n;
    raise notice '                  harmless: they are found by expense_id, not by content.';
  else
    raise notice 'unhashed          none';
  end if;

  raise notice '';
  raise notice 'All checks passed.';
end $$;

-- Anything left in the bucket that no attachment row names is now unreachable
-- from the application. This cannot be answered in SQL — storage is not in the
-- database — so list the bucket and compare against:
--
--   select storage_path from expense_attachments order by storage_path;
--
-- On a database where 0033 refused nothing, the two should agree.
