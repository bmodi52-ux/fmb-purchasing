-- Vendor matching could create the very duplicates it existed to prevent.
--
-- matchOrCreateVendor looks a vendor up by ABN, then by name, and inserts
-- when neither finds anything. Both lookups used .maybeSingle(), which
-- PostgREST fails when more than one row comes back — and the caller
-- discarded the error:
--
--   const { data } = await admin.from("vendors").select("id").eq("abn", ...)
--   if (data) return { id: data.id, status: "matched" };
--
-- So the moment a vendor existed twice, every later receipt from that vendor
-- found `data === null` and inserted a third, then a fourth. The fault fed
-- itself, and nothing in the schema stopped it: only vendor_number was
-- unique. A submitter would approve a vendor, upload the next receipt from
-- the same shop, and watch it arrive as an unrecognised new one.
--
-- Two things are needed. The application fix (order + limit(1) instead of
-- maybeSingle, so several matches resolve to one rather than to an insert)
-- lives in expense-matching.ts. This migration does the rest: collapse the
-- duplicates already recorded, and make the unambiguous case impossible to
-- repeat.

-- ---------------------------------------------------------------------
-- 1. ABNs are compared digits-only, so store them that way
-- ---------------------------------------------------------------------
-- Both write paths already strip non-digits before saving. Rows predating
-- that, or written by hand in the Supabase dashboard, may carry the spaced
-- form printed on a tax invoice ("37 129 853 041"), which no equality check
-- against a stripped ABN can ever match.
update vendors
set abn = regexp_replace(abn, '\D', '', 'g')
where abn is not null and abn <> regexp_replace(abn, '\D', '', 'g');

-- An ABN that was only punctuation is not an ABN.
update vendors set abn = null where abn = '';

-- ---------------------------------------------------------------------
-- 2. Collapse duplicates
-- ---------------------------------------------------------------------
-- Survivor per group: an approved vendor beats a pending one (somebody
-- reviewed it, and its vendor_number is the one already written on paper),
-- then the oldest, then lowest id so the choice is deterministic and this
-- migration is safe to re-run.
create temporary table vendor_merge (loser uuid primary key, winner uuid not null);

with ranked as (
  select
    id,
    first_value(id) over (
      partition by abn
      order by (status = 'approved') desc, created_at, id
    ) as winner
  from vendors
  where abn is not null
)
insert into vendor_merge (loser, winner)
select id, winner from ranked where id <> winner;

-- Then by name, for vendors recorded before anyone captured an ABN. Losers
-- from the ABN pass are excluded so a chain (a -> b, b -> c) cannot form.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by lower(btrim(name))
      order by (status = 'approved') desc, created_at, id
    ) as winner
  from vendors
  where id not in (select loser from vendor_merge)
)
insert into vendor_merge (loser, winner)
select id, winner from ranked where id <> winner;

-- Repoint everything that references a vendor. Order matters only where a
-- unique constraint could collide once two vendors' children sit together.

update expenses e set vendor_id = m.winner
from vendor_merge m where e.vendor_id = m.loser;

update vendor_collection_addresses a set vendor_id = m.winner
from vendor_merge m where a.vendor_id = m.loser;

update vendor_contacts c set vendor_id = m.winner
from vendor_merge m where c.vendor_id = m.loser;

update payees p set vendor_id = m.winner
from vendor_merge m where p.vendor_id = m.loser;

-- An offer is (vendor, pack size) since 0007 repurposed pricelist_items as
-- the vendor-offer level — matchOrCreateOffer looks one up by exactly that
-- pair. Where the winner already offers the same pack, the loser's row is the
-- same offer said twice, so move its line items onto the survivor and drop it;
-- leaving both would put a duplicate on the Pricelist for someone to reject.
update expense_line_items eli
set pricelist_item_id = keep.id
from pricelist_items dup
join vendor_merge m on m.loser = dup.vendor_id
join pricelist_items keep
  on keep.vendor_id = m.winner
 and keep.pack_size_id = dup.pack_size_id
where eli.pricelist_item_id = dup.id;

delete from pricelist_items dup
using vendor_merge m, pricelist_items keep
where dup.vendor_id = m.loser
  and keep.vendor_id = m.winner
  and keep.pack_size_id = dup.pack_size_id;

update pricelist_items o set vendor_id = m.winner
from vendor_merge m where o.vendor_id = m.loser;

-- vendor_item_descriptions is unique on (item_id, vendor_id, description);
-- same treatment, and here the loser's row carries nothing worth keeping.
delete from vendor_item_descriptions dup
using vendor_merge m, vendor_item_descriptions keep
where dup.vendor_id = m.loser
  and keep.vendor_id = m.winner
  and keep.item_id = dup.item_id
  and keep.description_normalized = dup.description_normalized;

update vendor_item_descriptions d set vendor_id = m.winner
from vendor_merge m where d.vendor_id = m.loser;

-- The winner keeps an ABN if either row had one.
update vendors v
set abn = coalesce(v.abn, l.abn)
from vendor_merge m
join vendors l on l.id = m.loser
where v.id = m.winner and v.abn is null and l.abn is not null;

delete from vendors where id in (select loser from vendor_merge);

drop table vendor_merge;

-- ---------------------------------------------------------------------
-- 3. Make it impossible to say the same ABN twice
-- ---------------------------------------------------------------------
-- An ABN identifies exactly one legal entity, so this is a fact about the
-- world rather than a policy choice, and the index doubles as the lookup
-- matchOrCreateVendor performs on every submission.
--
-- Name is deliberately NOT made unique. Two genuinely separate businesses
-- can share one ("Foodworks Guildford" is a different shop from another
-- franchise of the same brand only by its suburb, and a chain may not spell
-- itself consistently), so a hard constraint there would block a legitimate
-- entry with a database error the UI has no good way to explain. Name
-- collisions are handled where they belong — in matching, which now resolves
-- several candidates to one instead of falling through to an insert.
create unique index vendors_abn_unique_idx on vendors (abn) where abn is not null;
