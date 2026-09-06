-- Migrations 0034 to 0036, bundled for one paste into the Supabase SQL editor.
--
-- Generated from supabase/migrations. The individual files remain the source
-- of truth and are what the test suite applies; this is only a convenience so
-- that three files become one action, in the right order, in one transaction.
--
-- Wrapped in a transaction on purpose: if any statement fails, none of it
-- lands, and the database is left exactly as it was rather than half-migrated
-- with no record of how far it got. That matters more here than it did for
-- 0026-0032, because 0034 REWRITES DATA — it merges duplicate vendors and
-- repoints their expenses, offers, addresses, contacts and payees onto the
-- survivor, then deletes the losers.
--
-- READ 0034 BEFORE RUNNING THIS, and take a backup first. Run
-- verify_0034_to_0036.sql beforehand to see exactly which vendors it will
-- merge, and again afterwards to confirm what it did.
--
-- 0035 adds a value to an enum inside this transaction. Postgres 12+ allows
-- that; the new value simply cannot be *used* until the transaction commits,
-- and nothing here uses it.
--
-- Files bundled, in order:
--   0034_vendor_identity.sql
--   0035_service_lines.sql
--   0036_expense_lines_view.sql

begin;

-- ============================================================
-- 0034_vendor_identity.sql
-- ============================================================

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


-- ============================================================
-- 0035_service_lines.sql
-- ============================================================

-- Services were never modelled, so buying one damaged the Pricelist.
--
-- This kitchen pays for cleaning, maintenance, repairs and contractors --
-- there are seeded categories for all of them -- but line_item_kind offered
-- only 'goods' and a set of charge types. A cleaning invoice therefore had to
-- be entered as goods, and goods is the one kind that buildLineRows runs
-- through matchOrCreateOffer. So "Monthly kitchen deep clean - August"
-- created an item, a pack size of 1 ea, a vendor description and a pending
-- offer; next month's invoice, worded differently, created another; and the
-- Pricelist accumulated one dead entry per service invoice, each waiting on a
-- person to approve or reject something that will never be bought again.
--
-- The learned-misreading machinery from 0023 makes that worse rather than
-- better: it exists to converge repeat purchases of one product, and every
-- service invoice is legitimately different text.
--
-- The second harm is quieter. item_paid_unit_costs filters on
-- kind = 'goods' AND quantity > 0, and plenty of service invoices print
-- "Qty 1" -- so a $450 clean would enter the per-unit cost trend as an item
-- nobody will ever buy twice, and "cheapest vendor for this item" would
-- compare things that are not comparable. Intermittently, depending on
-- whether the invoice happened to print a quantity, which is worse than
-- consistently.
--
-- 'service' fixes both by being neither goods nor a charge: it carries a
-- category and a total like any real spend, it reaches reports by vendor and
-- by category exactly as before, and it stays out of the catalogue and out of
-- per-unit costing. No view needs changing -- both already select
-- kind = 'goods' -- which is the point: services were already excluded from
-- everything they should be excluded from, as soon as they stop having to lie
-- about what they are.
--
-- Alone in its own migration because Postgres will not let a newly added enum
-- value be *used* in the transaction that adds it. Anything that needs to
-- write or compare 'service' has to wait for a later one.

alter type line_item_kind add value if not exists 'service';

comment on type line_item_kind is
  '''unallocated'' is the escape hatch for a receipt that cannot be itemised — '
  'torn, illegible, a total with no breakdown. It keeps both invariants true '
  '(the total is right, and the lines sum to it) while marking the ambiguity '
  'explicitly, so the remainder surfaces for a person to resolve instead of '
  'being hidden inside a guessed line. ''service'' is work bought rather than '
  'stock — cleaning, maintenance, a contractor — real spend that belongs to a '
  'category but not to the Pricelist, and never to a per-unit cost.';


-- ============================================================
-- 0036_expense_lines_view.sql
-- ============================================================

-- A second view of All expenses: the line items inside it, as one ledger.
--
-- The expense table answers "what did we pay Foodworks". Nothing answered
-- "what did we buy" in a form that could be scanned, sorted and exported —
-- Reports aggregates lines, but a rollup is not a transaction list, so that
-- question was being answered by exporting and pivoting somewhere else.
--
-- This migration exists only because column visibility is stored per page,
-- and user_column_preferences.page_key is a foreign key into app_pages. The
-- ledger shows a different set of columns from the expense table, so it needs
-- its own preference scope; sharing one would have the two views overwrite
-- each other's chosen columns.
--
-- That is *all* it needs. It is not a new permission: the page it lives on is
-- already gated by all_expenses:view, and anyone who can read an expense can
-- read the lines that make it up. Listing it in Teams & permissions would
-- offer an administrator a switch that controls nothing, so app_pages gains a
-- flag saying which rows are permission boundaries and which are only places
-- to remember column choices.

alter table app_pages
  add column is_permission_scope boolean not null default true;

comment on column app_pages.is_permission_scope is
  'False for pages that exist only as a column-preference scope — a second '
  'view of a page that is already permissioned, such as the expense-lines '
  'ledger inside All expenses. The Teams & permissions matrix lists only '
  'rows where this is true, so an administrator is never shown a grant that '
  'decides nothing.';

insert into app_pages (key, label, sort_order, is_permission_scope) values
  ('expense_lines', 'Expense lines', 35, false)
on conflict (key) do nothing;

commit;
