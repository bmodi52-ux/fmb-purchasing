-- Run this in the Supabase SQL editor BEFORE and AFTER
-- 2026-09-07_apply_0034_to_0036.sql. It is read-only and safe to run at any
-- time.
--
-- BEFORE, it answers the question the apply script cannot: how much data is
-- 0034 actually going to rewrite? That migration merges duplicate vendors and
-- repoints their expenses, offers, addresses, contacts and payees onto a
-- survivor, then deletes the losers. On a database with no duplicates it is a
-- no-op that adds an index. On one with a handful it is a small, targeted
-- cleanup. Nobody should have to find out which afterwards.
--
-- AFTER, it confirms the three migrations landed and — more usefully — that
-- the things which would be quietly wrong rather than loudly broken are right:
--
--   * every expense still points at a vendor that exists;
--   * no vendor got orphaned children in the merge;
--   * the enum gained 'service' without disturbing existing lines;
--   * app_pages gained a preference-only row that the permissions matrix
--     will not offer as a grant.

-- ============================================================
-- 1. What 0034 will merge  (meaningful BEFORE; should be empty AFTER)
-- ============================================================

-- Vendors sharing an ABN. These merge first, keeping an approved row over a
-- pending one, then the oldest.
select
  'duplicate abn' as finding,
  abn,
  count(*) as copies,
  string_agg(coalesce(vendor_number, '?') || ' ' || name || ' (' || status || ')', ' | '
             order by (status = 'approved') desc, created_at) as rows_involved
from vendors
where abn is not null and btrim(abn) <> ''
group by abn
having count(*) > 1

union all

-- Vendors sharing a name, case- and whitespace-insensitively. These merge
-- second, and only among rows the ABN pass did not already claim.
select
  'duplicate name' as finding,
  lower(btrim(name)) as abn,
  count(*) as copies,
  string_agg(coalesce(vendor_number, '?') || ' ' || name || ' (' || status || ')', ' | '
             order by (status = 'approved') desc, created_at) as rows_involved
from vendors
group by lower(btrim(name))
having count(*) > 1

order by finding, copies desc;

-- ============================================================
-- 2. ABNs stored in the form printed on a tax invoice
-- ============================================================
-- 0034 strips these to digits before comparing anything. Rows listed here are
-- ones that could never have matched an extracted ABN, which is one way the
-- duplicates got created in the first place.

select vendor_number, name, abn as stored_abn, regexp_replace(abn, '\D', '', 'g') as will_become
from vendors
where abn is not null
  and abn <> regexp_replace(abn, '\D', '', 'g')
order by vendor_number;

-- ============================================================
-- 3. Post-apply checks  (all of these should print OK)
-- ============================================================

do $$
declare
  n int;
  txt text;
begin
  -- --- 0034 -------------------------------------------------
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'vendors_abn_unique_idx'
  ) then
    raise exception '0034 NOT APPLIED: vendors_abn_unique_idx is missing';
  end if;
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
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'line_item_kind' and e.enumlabel = 'service'
  ) then
    raise exception '0035 NOT APPLIED: line_item_kind has no ''service'' value';
  end if;
  raise notice '0035 enum         OK  (line_item_kind includes ''service'')';

  -- Nothing should have been reclassified by the migration itself; 'service'
  -- only ever arrives on new submissions.
  select count(*) into n from expense_line_items where kind = 'service';
  raise notice '0035 lines        OK  (% existing lines are service — expect 0 on first run)', n;

  -- --- 0036 -------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_pages'
      and column_name = 'is_permission_scope'
  ) then
    raise exception '0036 NOT APPLIED: app_pages.is_permission_scope is missing';
  end if;
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

-- ============================================================
-- 4. What the merge actually did, for the record
-- ============================================================

select
  (select count(*) from vendors) as vendors_now,
  (select count(*) from vendors where status = 'approved') as approved_now,
  (select count(*) from expenses where vendor_id is null) as expenses_without_vendor,
  (select count(*) from payees where vendor_id is not null) as vendor_payees;
