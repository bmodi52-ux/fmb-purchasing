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
