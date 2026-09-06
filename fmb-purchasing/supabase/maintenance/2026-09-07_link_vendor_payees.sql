-- Attach the bank details already on file to the vendors they belong to.
--
-- NOT a migration. Lives outside supabase/migrations/ on purpose — it is a
-- one-off repair of data written before the app knew how to link a payee to a
-- vendor, and must never be replayed as part of bootstrapping.
--
-- 0027 gave payees a vendor_id for "pay Taj Mart directly" and nothing ever
-- set it, so bank details typed for a vendor became a payee floating free of
-- the vendor record. The consequence is visible in this database: GLOBAL BEST
-- FOODS PTY LTD was entered twice, two hours apart, with the same BSB and
-- account number and the account name missing the second time. Nobody could
-- find the first one, so somebody typed it again — with a fresh chance to
-- transpose a digit, which is exactly what 0027 said reuse was for.
--
-- The application fix only helps vendors entered from now on. Without this,
-- the next submission naming either vendor creates yet another unlinked
-- payee, and "Pay the vendor" reports no details on file for a vendor whose
-- details are sitting right there.
--
-- WHAT IT DOES
--   * Links each payee whose display name matches a vendor's name to that
--     vendor. Members (profile_id set) are never touched.
--   * Where several payees map to one vendor, keeps the most complete —
--     account name present, then full bank details, then oldest — repoints any
--     expense that referenced a loser, folds in any detail only a loser had,
--     and deletes the rest.
--   * Leaves anything ambiguous alone and says so, rather than guessing.
--
-- Safe to re-run: the second run finds nothing left to link.

begin;

-- Survivor per vendor, and the losers that fold into it. A temporary table
-- rather than a CTE chain because several statements need the same decision,
-- and recomputing it between them would risk them disagreeing.
create temporary table payee_link on commit drop as
with matched as (
  select
    p.id as payee_id,
    v.id as vendor_id,
    row_number() over (
      partition by v.id
      order by
        (p.bank_account_name is not null) desc,
        (p.bank_bsb is not null and p.bank_account_number is not null) desc,
        p.created_at,
        p.id
    ) as rank
  from payees p
  join vendors v
    on lower(btrim(v.name)) = lower(btrim(p.display_name))
  -- A member being reimbursed is not the vendor, even if the names collide.
  where p.profile_id is null
    and p.vendor_id is null
)
select payee_id, vendor_id, rank from matched;

do $$
declare
  n int;
begin
  select count(*) into n from payee_link where rank = 1;
  raise notice 'vendors gaining saved bank details: %', n;
  select count(*) into n from payee_link where rank > 1;
  raise notice 'duplicate payees to be folded in:   %', n;
end $$;

-- Fold in any detail that only a loser carried, before the loser goes.
update payees w
set bank_account_name   = coalesce(w.bank_account_name, l.bank_account_name),
    bank_bsb            = coalesce(w.bank_bsb, l.bank_bsb),
    bank_account_number = coalesce(w.bank_account_number, l.bank_account_number),
    notes               = coalesce(w.notes, l.notes),
    updated_at          = now()
from payee_link keep
join payee_link lose on lose.vendor_id = keep.vendor_id and lose.rank > 1
join payees l on l.id = lose.payee_id
where w.id = keep.payee_id and keep.rank = 1;

-- Repoint every expense that was made out to a duplicate. Done before the
-- delete, or the foreign key would refuse it — which is the safe failure, but
-- a failure nonetheless.
update expenses e
set payee_id = keep.payee_id
from payee_link lose
join payee_link keep on keep.vendor_id = lose.vendor_id and keep.rank = 1
where lose.rank > 1 and e.payee_id = lose.payee_id;

delete from payees
where id in (select payee_id from payee_link where rank > 1);

-- The link itself, last, so the unique index on vendor_id meets one row.
update payees p
set vendor_id = keep.vendor_id, updated_at = now()
from payee_link keep
where keep.rank = 1 and p.id = keep.payee_id;

-- Anything a person still has to decide.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select v.vendor_number, v.name
    from vendors v
    where not exists (select 1 from payees p where p.vendor_id = v.id)
    order by v.vendor_number
  loop
    raise notice 'no bank details on file: % %', r.vendor_number, r.name;
    n := n + 1;
  end loop;
  if n = 0 then
    raise notice 'every vendor now has payment details attached';
  end if;
end $$;

commit;
