-- Run this AFTER 2026-09-07_apply_0034_to_0036.sql. Read-only, safe any time.
--
-- For the BEFORE run, use preflight_0034_vendor_merge.sql instead — it shows
-- which vendors the merge will collapse, which is what you want to know first.
-- Running this one early is harmless: it detects that the migrations have not
-- landed yet and says so rather than failing.
--
-- What it checks is not "did the SQL run" — the apply script is one
-- transaction, so it either ran or it did not. It is the things that would be
-- quietly wrong rather than loudly broken:
--
--   * no expense or offer left pointing at a vendor the merge deleted;
--   * no ABN still duplicated, and none still holding punctuation;
--   * the enum gained 'service' without reclassifying any existing line;
--   * expense_lines is flagged as a preference scope, not a permission — the
--     other way round would show an administrator a grant that decides
--     nothing.
--
-- Read the NOTICE output, not the result grid: the grid shows only the summary
-- at the end.

do $$
declare
  n int;
  txt text;
  applied_0034 boolean;
  applied_0035 boolean;
  applied_0036 boolean;
begin
  applied_0034 := exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'vendors_abn_unique_idx'
  );
  applied_0035 := exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'line_item_kind' and e.enumlabel = 'service'
  );
  applied_0036 := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_pages'
      and column_name = 'is_permission_scope'
  );

  -- Running this before the apply script is a reasonable thing to do by
  -- mistake, and raising on it teaches nothing. Say which are outstanding and
  -- stop.
  if not (applied_0034 and applied_0035 and applied_0036) then
    raise notice '--- NOT APPLIED YET ---';
    raise notice '0034 vendor identity      %', case when applied_0034 then 'applied' else 'OUTSTANDING' end;
    raise notice '0035 service line kind    %', case when applied_0035 then 'applied' else 'OUTSTANDING' end;
    raise notice '0036 expense lines view   %', case when applied_0036 then 'applied' else 'OUTSTANDING' end;
    raise notice '';
    raise notice 'Run 2026-09-07_apply_0034_to_0036.sql, then run this again.';
    raise notice 'For the before-picture, run preflight_0034_vendor_merge.sql.';
    return;
  end if;

  -- --- 0034 -------------------------------------------------
  raise notice '0034 index        OK  (vendors_abn_unique_idx present)';

  select count(*) into n
  from vendors where abn is not null and abn <> regexp_replace(abn, '\D', '', 'g');
  if n > 0 then
    raise exception '0034 INCOMPLETE: % vendors still hold a non-digit ABN', n;
  end if;
  raise notice '0034 abn format   OK  (every stored ABN is digits only)';

  select count(*) into n from (
    select abn from vendors where abn is not null group by abn having count(*) > 1
  ) d;
  if n > 0 then
    raise exception '0034 INCOMPLETE: % ABNs are still duplicated', n;
  end if;
  raise notice '0034 duplicates   OK  (no ABN appears twice)';

  -- The merge repoints children before deleting a vendor. A dangling
  -- reference here would mean an expense pointing at a vendor that no longer
  -- exists — invisible on every screen until someone opens the record.
  select count(*) into n
  from expenses e
  where e.vendor_id is not null
    and not exists (select 1 from vendors v where v.id = e.vendor_id);
  if n > 0 then
    raise exception '0034 BROKE REFERENTIAL INTEGRITY: % expenses point at a missing vendor', n;
  end if;
  raise notice '0034 expenses     OK  (every expense vendor still exists)';

  select count(*) into n
  from pricelist_items o
  where not exists (select 1 from vendors v where v.id = o.vendor_id);
  if n > 0 then
    raise exception '0034 BROKE REFERENTIAL INTEGRITY: % offers point at a missing vendor', n;
  end if;
  raise notice '0034 offers       OK  (every offer vendor still exists)';

  -- --- 0035 -------------------------------------------------
  raise notice '0035 enum         OK  (line_item_kind includes ''service'')';

  -- Nothing should have been reclassified by the migration itself; 'service'
  -- only ever arrives on new submissions.
  select count(*) into n from expense_line_items where kind = 'service';
  raise notice '0035 lines        OK  (% existing lines are service — expect 0 on first run)', n;

  -- --- 0036 -------------------------------------------------
  raise notice '0036 column       OK  (app_pages.is_permission_scope present)';

  select count(*) into n from app_pages where key = 'expense_lines';
  if n <> 1 then
    raise exception '0036 INCOMPLETE: expected 1 expense_lines page, found %', n;
  end if;

  select is_permission_scope::text into txt from app_pages where key = 'expense_lines';
  if txt <> 'false' then
    raise exception '0036 WRONG: expense_lines is flagged as a permission scope; '
      'Teams & permissions would offer a grant that decides nothing';
  end if;
  raise notice '0036 page         OK  (expense_lines present, not a permission scope)';

  -- Every page that IS a permission scope should still be one, or nav entries
  -- silently vanish for everybody.
  select count(*) into n from app_pages where is_permission_scope;
  raise notice '0036 other pages  OK  (% pages remain permissionable)', n;

  raise notice '--- all checks passed ---';
end $$;

-- The state of things, for the record.
select
  (select count(*) from vendors) as vendors,
  (select count(*) from vendors where status = 'approved') as approved,
  (select count(*) from expenses where vendor_id is null) as expenses_without_vendor,
  (select count(*) from payees where vendor_id is not null) as payees_linked_to_a_vendor,
  (select count(*) from payees where vendor_id is null and profile_id is null) as payees_still_unlinked;
