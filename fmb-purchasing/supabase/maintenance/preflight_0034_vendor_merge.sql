-- Run this BEFORE 2026-09-07_apply_0034_to_0036.sql. Read-only, safe any time.
--
-- Answers the question the apply script cannot: how much data is 0034 actually
-- going to rewrite? That migration merges duplicate vendors and repoints their
-- expenses, offers, addresses, contacts and payees onto a survivor, then
-- deletes the losers. On a database with no duplicates it is a no-op that adds
-- an index; on one with a handful it is a small, targeted cleanup. Nobody
-- should have to find out which afterwards.
--
-- Separate from verify_0034_to_0036.sql on purpose. The Supabase SQL editor
-- shows the result of the last statement only, so a file that mixes SELECTs
-- with assertions shows you the assertions and hides the rows — which is
-- exactly backwards for the run where the rows are the point.
--
-- HOW TO READ IT
--   No rows          -> 0034 will merge nothing. Go ahead and apply.
--   Rows in part 1   -> those vendors collapse into one. The row listed first
--                       in `survivor_first` is the one that survives and keeps
--                       its vendor number; the rest are deleted after their
--                       expenses and offers are moved onto it.
--   Rows in part 2   -> ABNs stored with spaces, which no equality check could
--                       ever have matched. 0034 strips them to digits. This is
--                       one of the ways duplicates arose in the first place.

-- ============================================================
-- 1. Vendors that will be merged
-- ============================================================

select
  'duplicate abn' as finding,
  abn as grouped_by,
  count(*) as copies,
  string_agg(
    coalesce(vendor_number, '?') || ' ' || name || ' (' || status || ')',
    '  |  ' order by (status = 'approved') desc, created_at, id
  ) as survivor_first
from vendors
where abn is not null and btrim(abn) <> ''
group by abn
having count(*) > 1

union all

select
  'duplicate name' as finding,
  lower(btrim(name)) as grouped_by,
  count(*) as copies,
  string_agg(
    coalesce(vendor_number, '?') || ' ' || name || ' (' || status || ')',
    '  |  ' order by (status = 'approved') desc, created_at, id
  ) as survivor_first
from vendors
group by lower(btrim(name))
having count(*) > 1

union all

-- ============================================================
-- 2. ABNs that will be reformatted
-- ============================================================

select
  'abn will be stripped to digits' as finding,
  abn as grouped_by,
  1 as copies,
  coalesce(vendor_number, '?') || ' ' || name || '  ->  ' ||
    regexp_replace(abn, '\D', '', 'g') as survivor_first
from vendors
where abn is not null
  and abn <> regexp_replace(abn, '\D', '', 'g')

order by finding, copies desc;
